import { spawn } from 'child_process';
import { readApiKey } from '../config/keychain.js';
import { loadSettings } from '../config/settings.js';
import { META_API_BASE_URL } from '../config/constants.js';
import { MetaClient } from '../api/meta-client.js';
import { resolveAliases, getContributorWarning } from '../api/model-resolver.js';

/**
 * Launch Claude Code with Meta Model API credentials.
 * Credentials are passed exclusively via environment variables.
 *
 * @param options - Launch options with optional model override
 */
export async function launchCommand(options: { model?: string }): Promise<void> {
  // 1. Read API key from Keychain
  const apiKey = readApiKey();
  if (!apiKey) {
    console.error('Error: Meta Model API key not found in Keychain.');
    console.error('Please run `claude-muse setup` to configure your credentials.');
    process.exit(1);
  }

  // 2. Load settings
  const settings = loadSettings();
  let selectedModel = options.model ?? settings.selectedModel;

  // 3. Validate model if explicitly specified
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
        console.warn(getContributorWarning());
      }
    } catch (err: any) {
      console.error(`Warning: Could not validate model: ${err.message}`);
      console.error('Proceeding with specified model anyway.');
    }
  }

  // 4. Resolve model aliases
  const aliases = resolveAliases(selectedModel);

  // 5. Build environment — key goes in env vars only, NEVER in args
  const metaEnv = {
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
  child.on('error', (err: any) => {
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
