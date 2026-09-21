import * as readline from 'readline';
import { readApiKey, writeApiKey } from '../config/keychain.js';
import { MetaClient } from '../api/meta-client.js';
import { loadSettings, saveSettings } from '../config/settings.js';
import { resolveAliases } from '../api/model-resolver.js';
import { DEFAULT_MODEL, CLAUDE_BIN, MUSE_BIN } from '../config/constants.js';
import { execSync } from 'child_process';

/**
 * Interactive setup wizard for claude-muse.
 * Configures API credentials, selects default model, and checks dependencies.
 */
export async function setupCommand(): Promise<void> {
  console.log('\x1b[1m\x1b[32m=== Claude Muse Setup ===\x1b[0m\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query: string): Promise<string> =>
    new Promise((resolve) => rl.question(query, resolve));

  try {
    // 1. API Key
    const existingKey = readApiKey();
    if (existingKey) {
      const replace = await question('API key already in Keychain. Replace? (y/N): ');
      if (replace.toLowerCase() === 'y') {
        const newKey = await question('Enter Meta API Key: ');
        if (!newKey.trim()) {
          console.log('No key entered. Keeping existing key.\n');
        } else {
          writeApiKey(newKey.trim());
          console.log('API key updated in Keychain.\n');
        }
      }
    } else {
      const newKey = await question('Enter Meta API Key: ');
      if (!newKey.trim()) throw new Error('API key is required.');
      writeApiKey(newKey.trim());
      console.log('API key saved to Keychain.\n');
    }

    // 2. Test auth
    const apiKey = readApiKey()!;
    const client = new MetaClient(apiKey);

    console.log('Testing authentication...');
    const authOk = await client.testAuth();
    if (authOk) {
      console.log('\x1b[32m✓ Authentication successful\x1b[0m\n');
    } else {
      console.log('\x1b[31m✗ Authentication failed. Check your API key.\x1b[0m\n');
    }

    // 3. List and select model
    console.log('Fetching available models...');
    let models: Awaited<ReturnType<MetaClient['listModels']>> = [];
    try {
      models = await client.listModels();
      if (models.length > 0) {
        console.log('Available Spark models:');
        models.forEach((m, i) => {
          const tag = m.isContributor ? ' \x1b[33m[Contributor]\x1b[0m' : '';
          console.log(`  ${i + 1}. ${m.id}${tag}`);
        });
      } else {
        console.log('\x1b[33m⚠ No Spark models found in API response.\x1b[0m');
      }
    } catch (err: any) {
      console.log(`\x1b[33m⚠ Could not fetch models: ${err.message}\x1b[0m`);
    }

    const modelInput = await question(`\nDefault model [${DEFAULT_MODEL}]: `);
    const selectedModel = modelInput.trim() || DEFAULT_MODEL;

    // 4. Save settings
    const aliases = resolveAliases(selectedModel);
    saveSettings({
      selectedModel,
      modelAliases: aliases,
    });
    console.log(`Saved settings with model: ${selectedModel}\n`);

    // 5. Check dependencies
    console.log('Checking dependencies...');

    try {
      execSync(`which ${CLAUDE_BIN}`, { stdio: 'pipe' });
      console.log(`\x1b[32m✓ ${CLAUDE_BIN} found\x1b[0m`);
    } catch {
      console.log(`\x1b[31m✗ ${CLAUDE_BIN} not found in PATH\x1b[0m`);
    }

    try {
      execSync(`which ${MUSE_BIN}`, { stdio: 'pipe' });
      console.log(`\x1b[32m✓ ${MUSE_BIN} found\x1b[0m`);
    } catch {
      console.log(`\x1b[31m✗ ${MUSE_BIN} not found in PATH\x1b[0m`);
    }

    try {
      execSync('git --version', { stdio: 'pipe' });
      console.log('\x1b[32m✓ git available\x1b[0m');
    } catch (err: any) {
      const errStr = String(err.stderr || err.stdout || err.message);
      if (errStr.includes('Xcode') || errStr.includes('license')) {
        try {
          execSync('git --version', {
            stdio: 'pipe',
            env: { ...process.env, DEVELOPER_DIR: '/Library/Developer/CommandLineTools' },
          });
          console.log('\x1b[32m✓ git available (via CommandLineTools)\x1b[0m');
        } catch {
          console.log('\x1b[33m⚠ Git requires Xcode license. Run: sudo xcodebuild -license accept\x1b[0m');
        }
      } else {
        console.log('\x1b[31m✗ git not found\x1b[0m');
      }
    }

    console.log('\n\x1b[1mSetup complete!\x1b[0m');
    console.log('Run \x1b[1mclaude-muse doctor\x1b[0m to verify everything works.');
  } catch (error: any) {
    console.error(`\n\x1b[31mSetup failed: ${error.message}\x1b[0m`);
  } finally {
    rl.close();
  }
}
