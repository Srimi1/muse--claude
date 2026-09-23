import { describe, it, expect } from 'vitest';
import { resolveCredential, resolveAuth, preferredSource, describeSource } from '../src/config/credentials.js';

describe('resolveCredential', () => {
  it('uses the preferred source when it has a key', () => {
    expect(
      resolveCredential('keychain', { keychain: () => 'kc-key', muse: () => 'muse-key' })
    ).toEqual({ apiKey: 'kc-key', source: 'keychain', fellBack: false });

    expect(resolveCredential('muse', { keychain: () => 'kc-key', muse: () => 'muse-key' })).toEqual({
      apiKey: 'muse-key',
      source: 'muse',
      fellBack: false,
    });
  });

  it('falls back to the other source when preferred is empty', () => {
    expect(resolveCredential('keychain', { keychain: () => null, muse: () => 'muse-key' })).toEqual({
      apiKey: 'muse-key',
      source: 'muse',
      fellBack: true,
    });

    expect(resolveCredential('muse', { keychain: () => 'kc-key', muse: () => null })).toEqual({
      apiKey: 'kc-key',
      source: 'keychain',
      fellBack: true,
    });
  });

  it('returns nulls when neither source has a key', () => {
    expect(resolveCredential('keychain', { keychain: () => null, muse: () => null })).toEqual({
      apiKey: null,
      source: null,
      fellBack: false,
    });
  });
});

describe('describeSource', () => {
  it('labels both sources', () => {
    expect(describeSource('keychain')).toBe('claude-muse Keychain entry');
    expect(describeSource('muse')).toBe('Muse credentials');
  });
});

describe('resolveAuth', () => {
  const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const jwt = (exp: number) => `${b64({ alg: 'none' })}.${b64({ exp })}.sig`;

  it('wraps API key sources with the same fallback as resolveCredential', () => {
    expect(resolveAuth('keychain', { keychain: () => null, muse: () => 'muse-key' })).toEqual({
      kind: 'api-key',
      token: 'muse-key',
      source: 'muse',
      fellBack: true,
      expiresAt: null,
      expired: false,
    });
  });

  it('returns the subscription token for muse-subscription', () => {
    expect(resolveAuth('muse-subscription', { subscription: () => 'opaque-token' })).toEqual({
      kind: 'oauth',
      token: 'opaque-token',
      source: 'muse-subscription',
      fellBack: false,
      expiresAt: null,
      expired: false,
    });
  });

  it('never falls back from the subscription to an API key', () => {
    const resolved = resolveAuth('muse-subscription', {
      subscription: () => null,
      keychain: () => 'kc-key',
      muse: () => 'muse-key',
    });
    expect(resolved.token).toBeNull();
    expect(resolved.source).toBeNull();
    expect(resolved.kind).toBe('oauth');
  });

  it('flags an expired JWT subscription token', () => {
    const now = 2_000_000_000_000;
    const expired = resolveAuth('muse-subscription', { subscription: () => jwt(now / 1000 - 60) }, now);
    expect(expired.expiresAt).toBe(now - 60_000);
    expect(expired.expired).toBe(true);

    const fresh = resolveAuth('muse-subscription', { subscription: () => jwt(now / 1000 + 3600) }, now);
    expect(fresh.expired).toBe(false);
  });

  it('labels the subscription source', () => {
    expect(describeSource('muse-subscription')).toBe('Muse Code subscription');
  });
});

describe('preferredSource', () => {
  it('lets run flags override the configured source', () => {
    expect(preferredSource({ subscription: true }, 'keychain')).toBe('muse-subscription');
    expect(preferredSource({ muse: true }, 'muse-subscription')).toBe('muse');
  });

  it('uses the configured source without flags', () => {
    expect(preferredSource({}, 'muse-subscription')).toBe('muse-subscription');
    expect(preferredSource({}, 'keychain')).toBe('keychain');
  });
});
