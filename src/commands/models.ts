import * as readline from 'readline';
import { loadSettings, saveSettings } from '../config/settings.js';
import { resolveAuth, describeSource, preferredSource } from '../config/credentials.js';
import { createMetaClient, type SparkModel } from '../api/meta-client.js';
import { resolveAliases, getContributorWarning } from '../api/model-resolver.js';

/**
 * Lists available Spark models and optionally prompts for selection.
 *
 * @param options - Command options with optional --select flag and credential source flags
 */
export async function modelsCommand(options: {
  select?: boolean;
  muse?: boolean;
  subscription?: boolean;
}): Promise<void> {
  const settings = loadSettings();
  const preferred = preferredSource(options, settings.credentialSource);
  const resolved = resolveAuth(preferred);
  if (!resolved.token || !resolved.source) {
    console.error('\x1b[31mError: API key not found. Run `claude-muse setup` first.\x1b[0m');
    process.exit(1);
  }
  if (resolved.expired) {
    console.error('\x1b[31mError: Muse Code subscription login has expired. Run `muse` once to sign in again.\x1b[0m');
    process.exit(1);
  }
  if (resolved.source !== 'keychain' || resolved.fellBack) {
    const what = resolved.kind === 'oauth' ? 'Meta credentials' : 'Meta API key';
    console.log(`Using ${what} from ${describeSource(resolved.source)}.`);
  }
  const client = createMetaClient({ kind: resolved.kind, token: resolved.token });
  console.log('Fetching models...');
  let models: SparkModel[];
  try {
    models = await client.listModels();
  } catch (err: any) {
    console.error(`\x1b[31mError: Could not fetch models: ${err.message}\x1b[0m`);
    if (resolved.kind === 'oauth') {
      console.error("The subscription endpoint rejected the Muse Code token. Run `muse` to sign in again if it has expired.");
    }
    process.exit(1);
  }

  if (models.length === 0) {
    console.error('\x1b[31mError: No Spark models found.\x1b[0m');
    process.exit(1);
  }

  const currentModel = settings.selectedModel;

  console.log('\n\x1b[1mAVAILABLE MODELS:\x1b[0m');
  console.log('   ' + 'ID'.padEnd(30) + 'Type');
  console.log('   ' + '-'.repeat(45));

  models.forEach((m, index) => {
    const isCurrent = m.id === currentModel;
    const marker = isCurrent ? '\x1b[32m★ \x1b[0m' : '  ';
    const num = options.select ? `${(index + 1).toString().padStart(2)}. ` : '   ';
    const typeLabel = m.isContributor ? '\x1b[33mContributor\x1b[0m' : 'Standard';
    console.log(`${marker}${num}${m.id.padEnd(30)}${typeLabel}`);
  });
  console.log();

  if (models.some((m) => m.isContributor)) {
    console.log(getContributorWarning());
    console.log();
  }

  if (options.select) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const question = (query: string): Promise<string> => new Promise((resolve) => rl.question(query, resolve));

    try {
      const selection = await question('Select a model number: ');
      const num = parseInt(selection.trim(), 10);

      if (!isNaN(num) && num > 0 && num <= models.length) {
        const selected = models[num - 1];
        const aliases = resolveAliases(selected.id, selected.isContributor);
        saveSettings({
          selectedModel: selected.id,
          modelAliases: aliases,
          credentialSource: settings.credentialSource,
        });
        console.log(`\x1b[32mDefault model set to: ${selected.id}\x1b[0m`);
      } else {
        console.log('\x1b[31mInvalid selection.\x1b[0m');
      }
    } finally {
      rl.close();
    }
  }
}
