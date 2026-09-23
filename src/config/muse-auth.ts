/**
 * Reader for Muse's own credential store, so claude-muse can reuse the
 * Meta API key the user already configured via `muse auth set` instead of
 * requiring it to be entered a second time.
 *
 * Muse keeps a JSON blob in the macOS Keychain holding `api_key` and the
 * subscription OAuth `access_token`, plus metadata (login identity,
 * mechanism) in `~/.config/muse/auth.json`.
 *
 * NOTE: the subscription OAuth token is scoped to Muse's own endpoints and
 * is rejected (401) by the developer Model API, so only `api_key` is used
 * as a claude-muse credential. The OAuth token is exposed for status
 * reporting only.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MUSE_KEYCHAIN_SERVICE, MUSE_KEYCHAIN_ACCOUNT } from './constants.js';

/** Credentials parsed from Muse's keychain blob. */
export interface MuseKeychainBlob {
  apiKey: string | null;
  accessToken: string | null;
}

/** Summary of the Muse login state. */
export interface MuseAuthStatus {
  /** Whether Muse has a meta provider entry in its auth file */
  configured: boolean;
  /** Auth mechanism from the auth file (e.g. 'oauth'), if known */
  mechanism: string | null;
  /** Logged-in user email from the auth file, if known */
  userEmail: string | null;
  /** Whether a usable Meta API key is available in the Muse store */
  hasApiKey: boolean;
  /** Whether a subscription OAuth token is present (status only) */
  hasSubscriptionToken: boolean;
}

/** Overrides for locating/parsing Muse credentials (used by tests). */
export interface MuseAuthOptions {
  /** Explicit path to the Muse auth.json file */
  authPath?: string;
  /**
   * Raw keychain blob to parse instead of reading the real keychain.
   * Pass null to simulate "no keychain entry".
   */
  keychainEntry?: string | null;
  /** Environment used to resolve the default auth path */
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolves the Muse auth.json path, mirroring the `muse` launcher:
 * $MUSE_AUTH_PATH wins, then $XDG_CONFIG_HOME, then ~/.config.
 */
export function getMuseAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MUSE_AUTH_PATH) return env.MUSE_AUTH_PATH;
  const base = env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
  return path.join(base, 'muse', 'auth.json');
}

/**
 * Reads and parses the Muse auth.json file.
 * Returns null when the file is missing or malformed.
 */
export function readMuseAuthFile(authPath: string = getMuseAuthPath()): any | null {
  try {
    if (!fs.existsSync(authPath)) return null;
    return JSON.parse(fs.readFileSync(authPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Reads the raw Muse credential blob from the macOS Keychain.
 * Returns null when the entry is missing or unreadable.
 */
export function readMuseKeychainEntry(): string | null {
  try {
    const output = execFileSync(
      'security',
      ['find-generic-password', '-s', MUSE_KEYCHAIN_SERVICE, '-a', MUSE_KEYCHAIN_ACCOUNT, '-w'],
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' }
    );
    const trimmed = output.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Parses a raw keychain blob into its credential fields.
 * Never throws: malformed input yields an empty blob.
 */
export function parseMuseKeychainBlob(raw: string | null): MuseKeychainBlob {
  const empty: MuseKeychainBlob = { apiKey: null, accessToken: null };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw);
    return {
      apiKey: nonEmptyString(parsed.api_key),
      accessToken: nonEmptyString(parsed.access_token),
    };
  } catch {
    return empty;
  }
}

/**
 * Returns the Meta API key stored in Muse's credential store, if any.
 * Prefers the keychain blob; falls back to a legacy inline `api_key`
 * in auth.json.
 */
export function readMuseApiKey(options: MuseAuthOptions = {}): string | null {
  const blob = parseMuseKeychainBlob(
    options.keychainEntry !== undefined ? options.keychainEntry : readMuseKeychainEntry()
  );
  if (blob.apiKey) return blob.apiKey;
  const auth = readMuseAuthFile(options.authPath ?? getMuseAuthPath(options.env));
  return nonEmptyString(auth?.providers?.meta?.api_key);
}

/**
 * Returns Muse's subscription OAuth token, if present.
 * Used by the 'muse-subscription' credential source; the developer Model
 * API alone rejects it (401), so launch needs Muse's subscription endpoint.
 */
export function readMuseSubscriptionToken(options: MuseAuthOptions = {}): string | null {
  const blob = parseMuseKeychainBlob(
    options.keychainEntry !== undefined ? options.keychainEntry : readMuseKeychainEntry()
  );
  if (blob.accessToken) return blob.accessToken;
  // Legacy schema kept the OAuth token inline in auth.json.
  const auth = readMuseAuthFile(options.authPath ?? getMuseAuthPath(options.env));
  return nonEmptyString(auth?.providers?.meta?.access_token);
}

/**
 * Summarizes the Muse login state without exposing secrets.
 */
export function getMuseAuthStatus(options: MuseAuthOptions = {}): MuseAuthStatus {
  const auth = readMuseAuthFile(options.authPath ?? getMuseAuthPath(options.env));
  const meta = auth?.providers?.meta;
  return {
    configured: meta != null && typeof meta === 'object',
    mechanism: nonEmptyString(meta?.mechanism),
    userEmail: nonEmptyString(meta?.user_email),
    hasApiKey: readMuseApiKey(options) != null,
    hasSubscriptionToken: readMuseSubscriptionToken(options) != null,
  };
}

/**
 * Returns the expiry (ms since epoch) of a JWT-shaped OAuth token, read
 * from its unverified `exp` claim. Returns null for opaque tokens or when
 * the claim is missing; never throws.
 */
export function getTokenExpiry(token: string | null): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
