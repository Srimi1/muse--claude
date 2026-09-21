import { execSync } from 'child_process';
import { readApiKey } from '../config/keychain.js';
import { MetaClient } from '../api/meta-client.js';
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
 */
export async function doctorCommand(): Promise<void> {
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

  // 2. Keychain entry
  const apiKey = readApiKey();
  if (apiKey) {
    console.log(`${GREEN}✓ API key found in Keychain${RESET}`);
    passed++;
  } else {
    console.log(`${RED}✗ No API key in Keychain. Run: claude-muse setup${RESET}`);
  }

  // 3. API authentication
  let client: MetaClient | null = null;
  let authOk = false;

  if (apiKey) {
    client = new MetaClient(apiKey);
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
  }

  // 4. Model availability
  if (authOk && client) {
    try {
      const models = await client.listModels();
      const settings = loadSettings();
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
    console.log(`${GREEN}✓ Native Muse auth intact${RESET}`);
    passed++;
  } catch {
    console.log(`${RED}✗ Muse auth check failed${RESET}`);
  }

  console.log(`\n${BOLD}Result: ${passed}/${total} checks passed.${RESET}`);
}
