import { execFileSync } from 'child_process';
import { KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT } from './constants.js';

/**
 * Reads the Meta API key from macOS Keychain using the security CLI tool.
 * Returns null if not found.
 *
 * @returns {string | null} The API key, or null if not found.
 */
export function readApiKey(): string | null {
  try {
    const output = execFileSync(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' }
    );
    return output.trim();
  } catch (error) {
    return null;
  }
}

/**
 * Writes or updates the Meta API key in the macOS Keychain.
 *
 * The key is passed as a separate argv entry rather than interpolated into a
 * shell string, so characters that are meaningful to the shell (quotes,
 * backticks, `$(...)`) are stored verbatim instead of being executed.
 *
 * @param {string} key - The API key to store.
 */
export function writeApiKey(key: string): void {
  try {
    // Avoid logging the command or the key
    execFileSync(
      'security',
      ['add-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w', key, '-U'],
      { stdio: 'pipe' }
    );
  } catch (error) {
    throw new Error('Failed to save API key to keychain.');
  }
}

/**
 * Deletes the Meta API key from the macOS Keychain.
 * Ignores errors if the key does not exist.
 */
export function deleteApiKey(): void {
  try {
    execFileSync(
      'security',
      ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT],
      { stdio: 'pipe' }
    );
  } catch (error) {
    // Ignore error if not found
  }
}
