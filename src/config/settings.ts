import fs from 'fs';
import { CONFIG_FILE, CONFIG_DIR, DEFAULT_MODEL } from './constants.js';
import type { ModelAliases } from '../api/model-resolver.js';
import type { AuthSource } from './credentials.js';

/**
 * User settings interface.
 */
export interface Settings {
  selectedModel: string;
  modelAliases: ModelAliases;
  /** Preferred Meta credential source */
  credentialSource: AuthSource;
}

/**
 * Returns the default settings with all alias slots pointing to the default model.
 *
 * @returns Default settings object
 */
export function getDefaultSettings(): Settings {
  return {
    selectedModel: DEFAULT_MODEL,
    modelAliases: {
      main: DEFAULT_MODEL,
      opus: DEFAULT_MODEL,
      sonnet: DEFAULT_MODEL,
      haiku: DEFAULT_MODEL,
      subagent: DEFAULT_MODEL,
    },
    credentialSource: 'keychain',
  };
}

const AUTH_SOURCES: readonly AuthSource[] = ['keychain', 'muse', 'muse-subscription'];

/**
 * Merges parsed config JSON over the defaults, discarding an unknown
 * credential source.
 *
 * @param parsed - Parsed contents of the config file
 * @returns Complete settings object
 */
export function normalizeSettings(parsed: any): Settings {
  const defaults = getDefaultSettings();
  const credentialSource: AuthSource = AUTH_SOURCES.includes(parsed?.credentialSource)
    ? parsed.credentialSource
    : defaults.credentialSource;
  return {
    selectedModel: parsed?.selectedModel ?? defaults.selectedModel,
    modelAliases: { ...defaults.modelAliases, ...parsed?.modelAliases },
    credentialSource,
  };
}

/**
 * Loads settings from the configuration file.
 * Returns default settings if the file does not exist or fails to parse.
 *
 * @returns The loaded settings or defaults
 */
export function loadSettings(): Settings {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return normalizeSettings(JSON.parse(data));
    }
  } catch {
    console.error('Error reading settings, falling back to defaults.');
  }
  return getDefaultSettings();
}

/**
 * Saves settings to the configuration file.
 * Creates the configuration directory if it doesn't exist.
 *
 * @param settings - The settings to save
 */
export function saveSettings(settings: Settings): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}
