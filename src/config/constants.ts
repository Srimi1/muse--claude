import path from 'node:path';
import os from 'node:os';

/** Meta API Base URL */
export const META_API_BASE_URL = 'https://api.meta.ai/v1';

/** Default model to use */
export const DEFAULT_MODEL = 'muse-spark-1.3';

/** Keychain service name */
export const KEYCHAIN_SERVICE = 'com.claude-muse.meta-api-key';

/** Keychain account name */
export const KEYCHAIN_ACCOUNT = 'claude-muse';

/** Configuration directory path */
export const CONFIG_DIR = path.join(os.homedir(), '.claude-muse');

/** Unix socket path for broker */
export const SOCKET_PATH = path.join(CONFIG_DIR, 'talk.sock');

/** Journal database path */
export const JOURNAL_PATH = path.join(CONFIG_DIR, 'talk-journal.db');

/** Config file path */
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/** Max message size in bytes */
export const MAX_MESSAGE_SIZE = 8192;

/** Max exchange messages limit */
export const MAX_EXCHANGE_MESSAGES = 6;

/** Room deadline in milliseconds */
export const ROOM_DEADLINE_MS = 30 * 60 * 1000;

/** Receive timeout in milliseconds */
export const RECEIVE_TIMEOUT_MS = 30 * 1000;

/** Claude binary name */
export const CLAUDE_BIN = 'claude';

/** Muse binary name */
export const MUSE_BIN = 'muse';

/** Model aliases definition */
export type MODEL_ALIASES = {
  main: string;
  opus: string;
  sonnet: string;
  haiku: string;
  subagent: string;
};
