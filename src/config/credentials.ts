import { readApiKey } from './keychain.js';
import { readMuseApiKey, readMuseSubscriptionToken, getTokenExpiry } from './muse-auth.js';

/**
 * Where claude-muse loads its Meta API credential from.
 * - 'keychain': the dedicated claude-muse entry (`com.claude-muse.meta-api-key`)
 * - 'muse': the API key already stored in Muse's credential store
 */
export type CredentialSource = 'keychain' | 'muse';

/**
 * Every credential source claude-muse can be configured with: the API key
 * sources plus 'muse-subscription', which reuses Muse Code's subscription
 * OAuth token instead of a pay-as-you-go API key.
 */
export type AuthSource = CredentialSource | 'muse-subscription';

/** A resolved API credential plus where it came from. */
export interface ResolvedCredential {
  apiKey: string | null;
  source: CredentialSource | null;
  /** True when the preferred source was empty and the other one was used */
  fellBack: boolean;
}

/** A resolved credential of either kind, ready to send as a bearer token. */
export interface ResolvedAuth {
  /** 'api-key' for Meta API keys, 'oauth' for the Muse subscription token */
  kind: 'api-key' | 'oauth';
  token: string | null;
  source: AuthSource | null;
  /** True when the preferred source was empty and the other one was used */
  fellBack: boolean;
  /** Token expiry (ms since epoch) when known, else null */
  expiresAt: number | null;
  /** True when expiresAt is known and already passed */
  expired: boolean;
}

/**
 * Resolves the Meta API key from the preferred source, falling back to the
 * other source when the preferred one has no key. Readers are injectable
 * for tests.
 */
export function resolveCredential(
  preferred: CredentialSource,
  readers: { keychain?: () => string | null; muse?: () => string | null } = {}
): ResolvedCredential {
  const readKeychain = readers.keychain ?? readApiKey;
  const readMuse = readers.muse ?? readMuseApiKey;

  const primary = preferred === 'muse' ? readMuse() : readKeychain();
  if (primary) return { apiKey: primary, source: preferred, fellBack: false };

  const fallbackSource: CredentialSource = preferred === 'muse' ? 'keychain' : 'muse';
  const fallback = preferred === 'muse' ? readKeychain() : readMuse();
  if (fallback) return { apiKey: fallback, source: fallbackSource, fellBack: true };

  return { apiKey: null, source: null, fellBack: false };
}

/**
 * Resolves the credential for any configured source. API key sources keep
 * resolveCredential's fallback between each other; 'muse-subscription'
 * never falls back to an API key, so a missing subscription login cannot
 * silently switch the user onto pay-as-you-go billing.
 */
export function resolveAuth(
  preferred: AuthSource,
  readers: {
    keychain?: () => string | null;
    muse?: () => string | null;
    subscription?: () => string | null;
  } = {},
  now: number = Date.now()
): ResolvedAuth {
  if (preferred === 'muse-subscription') {
    const token = (readers.subscription ?? readMuseSubscriptionToken)();
    if (!token) {
      return { kind: 'oauth', token: null, source: null, fellBack: false, expiresAt: null, expired: false };
    }
    const expiresAt = getTokenExpiry(token);
    return {
      kind: 'oauth',
      token,
      source: 'muse-subscription',
      fellBack: false,
      expiresAt,
      expired: expiresAt !== null && expiresAt <= now,
    };
  }

  const resolved = resolveCredential(preferred, readers);
  return {
    kind: 'api-key',
    token: resolved.apiKey,
    source: resolved.source,
    fellBack: resolved.fellBack,
    expiresAt: null,
    expired: false,
  };
}

/**
 * Picks the credential source for one run: `--subscription` or `--muse`
 * override the configured source for that run only.
 */
export function preferredSource(
  options: { muse?: boolean; subscription?: boolean },
  configured: AuthSource
): AuthSource {
  if (options.subscription) return 'muse-subscription';
  if (options.muse) return 'muse';
  return configured;
}

/** Human-readable label for a credential source (for CLI notices). */
export function describeSource(source: AuthSource): string {
  if (source === 'muse-subscription') return 'Muse Code subscription';
  return source === 'muse' ? 'Muse credentials' : 'claude-muse Keychain entry';
}
