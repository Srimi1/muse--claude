import { execSync } from 'child_process';
import { resolveAuth, describeSource, preferredSource } from '../config/credentials.js';
import { getMuseAuthStatus } from '../config/muse-auth.js';
import { MetaClient, createMetaClient } from '../api/meta-client.js';
import { loadSettings } from '../config/settings.js';
import { CLAUDE_BIN, MUSE_BIN } from '../config/constants.js';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
/**
 * Runs diagnostic checks for the claude-muse configuration.
 * Reports status of 9 checks covering credentials, API, tools, and streaming.
 *
 * @param options - `subscription` checks the Muse Code subscription login for this run
 */
export async function doctorCommand(options: { subscription?: boolean } = {}): Promise<void> {
  console.log(`${BOLD}Running diagnostics...${RESET}\n`);
  let passed = 0;
  const total = 9;
  // 1. Node.js version
  const nodeVer = process.version;
  const match = nodeVer.match(/^v(\d+)\./);
  const major = match ? parseInt(match[1], 10) : 0;
  if (major >= 26) {
    console.log(`${GREEN}✓ Node.js ${nodeVer}${RESET}`);
    passed++;
  } else {
    console.log(`${RED}✗ Node.js ${nodeVer} — requires >= v26.0.0${RESET}`);
  }
  // 2. Credential resolution (Keychain entry, Muse API key, or Muse subscription)
  const settings = loadSettings();
  const source = preferredSource(options, settings.credentialSource);
  const resolved = resolveAuth(source);
  const apiKey = resolved.token;
  if (apiKey && resolved.source && resolved.expired) {
    console.log(`${RED}✗ Muse Code subscription login expired. Run: muse${RESET}`);
  } else if (apiKey && resolved.source) {
    const what = resolved.kind === 'oauth' ? 'Subscription token' : 'API key';
    console.log(`${GREEN}✓ ${what} found (${describeSource(resolved.source)})${RESET}`);
    passed++;
  } else if (source === 'muse-subscription') {
    console.log(`${RED}✗ No Muse Code subscription login. Run: muse${RESET}`);
  } else {
    console.log(`${RED}✗ No API credential. Run: claude-muse setup${RESET}`);
  }
  // 3. API authentication
  let client: MetaClient | null = null;
  let authOk = false;
  if (apiKey && !resolved.expired) {
    client = createMetaClient({ kind: resolved.kind, token: apiKey });
    try {
      authOk = await client.testAuth();
    } catch {
      authOk = false;
    }
  }
  if (authOk) {
    console.log(`${GREEN}✓ API authentication successful${RESET}`);
    passed++;
  } else {
    console.log(`${RED}✗ API authentication failed${RESET}`);
    if (resolved.kind === 'oauth') {
      console.log(`${YELLOW}  The developer Model API rejects subscription tokens; Muse's subscription endpoint is not wired up yet.${RESET}`);
    }
  }
  // 4. Model availability
  if (authOk && client) {
    try {
      const models = await client.listModels();
      const defaultModel = settings.selectedModel;
      if (models.some((m) => m.id === defaultModel)) {
        console.log(`${GREEN}✓ Model '${defaultModel}' available${RESET}`);
        passed++;
      } else {
        console.log(`${RED}✗ Model '${defaultModel}' not found in API${RESET}`);
      }
    } catch (err: any) {
      console.log(`${RED}✗ Model check failed: ${err.message}${RESET}`);
    }
    // 5. Streaming test
    try {
      const streamResult = await client.testStreaming();
      if (streamResult.success) {
        console.log(`${GREEN}✓ Streaming works (${streamResult.latencyMs}ms)${RESET}`);
        passed++;
      } else {
        console.log(`${RED}✗ Streaming test failed${RESET}`);
      }
    } catch (err: any) {
      console.log(`${RED}✗ Streaming test failed: ${err.message}${RESET}`);
    }
  } else if (client && resolved.kind === 'oauth') {
    // The subscription token may be accepted for inference even though the
    // models listing rejects it, so still try the Messages endpoint.
    console.log(`${RED}✗ Skipping model check (auth failed)${RESET}`);
    const streamResult = await client.testStreaming();
    if (streamResult.success) {
      console.log(`${GREEN}✓ Messages endpoint accepts the subscription token (${streamResult.latencyMs}ms)${RESET}`);
      passed++;
    } else {
      console.log(`${RED}✗ Messages endpoint rejected the subscription token: ${streamResult.error ?? 'unknown error'}${RESET}`);
    }
  } else {
    console.log(`${RED}✗ Skipping model check (auth failed)${RESET}`);
    console.log(`${RED}✗ Skipping streaming test (auth failed)${RESET}`);
  }
  // 6. Claude CLI
  try {
    execSync(`which ${CLAUDE_BIN}`, { stdio: 'pipe' });
    console.log(`${GREEN}✓ ${CLAUDE_BIN} CLI installed${RESET}`);
    passed++;
  } catch {
    console.log(`${RED}✗ ${CLAUDE_BIN} not found in PATH${RESET}`);
  }
  // 7. Muse CLI
  try {
    execSync(`which ${MUSE_BIN}`, { stdio: 'pipe' });
    console.log(`${GREEN}✓ ${MUSE_BIN} CLI installed${RESET}`);
    passed++;
  } catch {
    console.log(`${RED}✗ ${MUSE_BIN} not found in PATH${RESET}`);
  }
  // 8. Git
  try {
    execSync('git --version', { stdio: 'pipe' });
    console.log(`${GREEN}✓ Git available${RESET}`);
    passed++;
  } catch (err: any) {
    const errStr = String(err.stderr || err.stdout || err.message);
    if (errStr.includes('Xcode') || errStr.includes('license')) {
      try {
        execSync('git --version', {
          stdio: 'pipe',
          env: { ...process.env, DEVELOPER_DIR: '/Library/Developer/CommandLineTools' },
        });
        console.log(`${GREEN}✓ Git available (via CommandLineTools)${RESET}`);
        passed++;
      } catch {
        console.log(`${YELLOW}⚠ Git blocked by Xcode license. Run: sudo xcodebuild -license accept${RESET}`);
      }
    } else {
      console.log(`${RED}✗ Git not available${RESET}`);
    }
  }
  // 9. Native Muse auth
  try {
    execSync(`${MUSE_BIN} --version`, { stdio: 'pipe' });
    const museStatus = getMuseAuthStatus();
    const detail = museStatus.configured
      ? ` (login: ${museStatus.mechanism ?? 'unknown'}${museStatus.userEmail ? ` as ${museStatus.userEmail}` : ''}, stored API key: ${museStatus.hasApiKey ? 'yes' : 'no'}, subscription: ${museStatus.hasSubscriptionToken ? 'yes' : 'no'})`
      : ' (not logged in)';
    console.log(`${GREEN}✓ Native Muse auth intact${detail}${RESET}`);
    passed++;
  } catch {
    console.log(`${RED}✗ Muse auth check failed${RESET}`);
  }
  console.log(`\n${BOLD}Result: ${passed}/${total} checks passed.${RESET}`);
}
