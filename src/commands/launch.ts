import { spawn } from 'child_process';
import { loadSettings } from '../config/settings.js';
import { resolveAuth, describeSource, preferredSource } from '../config/credentials.js';
import { META_API_BASE_URL } from '../config/constants.js';
import { MetaClient } from '../api/meta-client.js';
import { resolveAliases, getContributorWarning } from '../api/model-resolver.js';

/**
 * Launch Claude Code with Meta Model API credentials.
 * Credentials are passed exclusively via environment variables.
 *
 * @param options - Launch options with optional model override and credential source flags
 */
export async function launchCommand(options: {
  model?: string;
  muse?: boolean;
  subscription?: boolean;
}): Promise<void> {
  // 1. Load settings and resolve the API credential
  const settings = loadSettings();
  const preferred = preferredSource(options, settings.credentialSource);
  const resolved = resolveAuth(preferred);
  if (!resolved.token || !resolved.source) {
    console.error('Error: No Meta API credential found.');
    console.error('Run `claude-muse setup` to configure one, or store a key in Muse with `muse auth set`.');
    process.exit(1);
  }
  if (resolved.kind === 'oauth') {
    // Pending endpoint discovery: the developer Model API rejects the
    // subscription token, so there is no endpoint to point Claude Code at yet.
    console.error('Error: Launching on the Muse Code subscription is not supported yet.');
    console.error('Switch back to an API key with `claude-muse setup`, or pass `--muse`.');
    process.exit(1);
  }
  if (resolved.source === 'muse' || resolved.fellBack) {
    console.log(`Using Meta API key from ${describeSource(resolved.source)}.`);
  }
  const apiKey = resolved.token;

  // 2. Determine model
  let selectedModel = options.model ?? settings.selectedModel;

  // 3. Validate model if explicitly specified
  let isContributor = false;
  if (options.model) {
    const client = new MetaClient(apiKey);
    try {
      const availableModels = await client.listModels();
      const modelExists = availableModels.some((m) => m.id === options.model);
      if (!modelExists) {
        console.error(`Error: Model '${options.model}' not found.`);
        console.log('Available models:');
        availableModels.forEach((m) => console.log(`  - ${m.id}`));
        process.exit(1);
      }

      // Check if contributor variant
      const matched = availableModels.find((m) => m.id === options.model);
      if (matched?.isContributor) {
        isContributor = true;
        console.warn(getContributorWarning());
      }
    } catch (err: any) {
      console.error(`Warning: Could not validate model: ${err.message}`);
      console.error('Proceeding with specified model anyway.');
    }
  }

  // 4. Resolve model aliases. Pass the contributor flag through so the alias
  // slots match what `models --select` would have written for the same model.
  const aliases = resolveAliases(selectedModel, isContributor);

  // 5. Build environment — key goes in env vars only, NEVER in args
  const metaEnv: Record<string, string> = {
    ANTHROPIC_BASE_URL: META_API_BASE_URL,
    ANTHROPIC_API_KEY: apiKey,
  };

  // 6. Build claude command args
  const args = ['--model', aliases.main];

  console.log(`Launching Claude Code with model: ${aliases.main}`);

  // 7. Spawn claude as child process with inherited terminal
  const child = spawn('claude', args, {
    stdio: 'inherit',
    env: { ...process.env, ...metaEnv },
  });

  // 8. Handle child process events
  child.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') {
      console.error('Error: `claude` command not found.');
      console.error('Ensure Claude Code is installed: npm install -g @anthropic-ai/claude-code');
    } else {
      console.error('Error launching Claude:', err.message);
    }
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  // 9. Forward signals to child process
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}
