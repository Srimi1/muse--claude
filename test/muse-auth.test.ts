import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getMuseAuthPath,
  readMuseAuthFile,
  parseMuseKeychainBlob,
  readMuseApiKey,
  readMuseSubscriptionToken,
  getMuseAuthStatus,
  getTokenExpiry,
} from '../src/config/muse-auth.js';

const BLOB = JSON.stringify({
  secret_schema_version: 1,
  api_key: 'test-meta-api-key',
  access_token: 'test-oauth-token',
});

function writeTempAuthFile(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-auth-test-'));
  const file = path.join(dir, 'auth.json');
  fs.writeFileSync(file, content);
  return file;
}

describe('getMuseAuthPath', () => {
  it('prefers $MUSE_AUTH_PATH', () => {
    expect(getMuseAuthPath({ MUSE_AUTH_PATH: '/tmp/custom.json' })).toBe('/tmp/custom.json');
  });

  it('uses $XDG_CONFIG_HOME when set', () => {
    expect(getMuseAuthPath({ XDG_CONFIG_HOME: '/tmp/xdg' })).toBe(
      path.join('/tmp/xdg', 'muse', 'auth.json')
    );
  });

  it('defaults to ~/.config/muse/auth.json', () => {
    expect(getMuseAuthPath({})).toBe(path.join(os.homedir(), '.config', 'muse', 'auth.json'));
  });
});

describe('readMuseAuthFile', () => {
  it('returns null for a missing file', () => {
    expect(readMuseAuthFile(path.join(os.tmpdir(), 'does-not-exist-12345.json'))).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const file = writeTempAuthFile('{not json');
    expect(readMuseAuthFile(file)).toBeNull();
  });

  it('parses a valid auth file', () => {
    const file = writeTempAuthFile(JSON.stringify({ providers: { meta: { mechanism: 'oauth' } } }));
    expect(readMuseAuthFile(file)?.providers?.meta?.mechanism).toBe('oauth');
  });
});

describe('parseMuseKeychainBlob', () => {
  it('extracts api_key and access_token', () => {
    expect(parseMuseKeychainBlob(BLOB)).toEqual({
      apiKey: 'test-meta-api-key',
      accessToken: 'test-oauth-token',
    });
  });

  it('returns empty fields for null or malformed input', () => {
    expect(parseMuseKeychainBlob(null)).toEqual({ apiKey: null, accessToken: null });
    expect(parseMuseKeychainBlob('not-json')).toEqual({ apiKey: null, accessToken: null });
    expect(parseMuseKeychainBlob('')).toEqual({ apiKey: null, accessToken: null });
  });

  it('treats missing or empty fields as null', () => {
    expect(parseMuseKeychainBlob('{}')).toEqual({ apiKey: null, accessToken: null });
    expect(parseMuseKeychainBlob(JSON.stringify({ api_key: '', access_token: 42 }))).toEqual({
      apiKey: null,
      accessToken: null,
    });
  });
});

describe('readMuseApiKey', () => {
  const missing = path.join(os.tmpdir(), 'muse-auth-missing-12345.json');

  it('reads the key from the keychain blob', () => {
    expect(readMuseApiKey({ authPath: missing, keychainEntry: BLOB })).toBe('test-meta-api-key');
  });

  it('falls back to a legacy inline api_key in auth.json', () => {
    const file = writeTempAuthFile(
      JSON.stringify({ providers: { meta: { mechanism: 'oauth', api_key: 'inline-key' } } })
    );
    expect(readMuseApiKey({ authPath: file, keychainEntry: null })).toBe('inline-key');
  });

  it('prefers the keychain blob over the inline key', () => {
    const file = writeTempAuthFile(
      JSON.stringify({ providers: { meta: { api_key: 'inline-key' } } })
    );
    expect(readMuseApiKey({ authPath: file, keychainEntry: BLOB })).toBe('test-meta-api-key');
  });

  it('returns null when neither source has a key', () => {
    expect(readMuseApiKey({ authPath: missing, keychainEntry: null })).toBeNull();
  });
});

describe('readMuseSubscriptionToken', () => {
  const missing = path.join(os.tmpdir(), 'muse-auth-missing-12345.json');

  it('reads the token from the keychain blob', () => {
    expect(readMuseSubscriptionToken({ authPath: missing, keychainEntry: BLOB })).toBe(
      'test-oauth-token'
    );
  });

  it('falls back to a legacy inline access_token in auth.json', () => {
    const file = writeTempAuthFile(
      JSON.stringify({ providers: { meta: { mechanism: 'oauth', access_token: 'inline-token' } } })
    );
    expect(readMuseSubscriptionToken({ authPath: file, keychainEntry: null })).toBe('inline-token');
  });

  it('returns null when no token is stored', () => {
    expect(readMuseSubscriptionToken({ authPath: missing, keychainEntry: null })).toBeNull();
  });
});

describe('getMuseAuthStatus', () => {
  it('summarizes a configured login without exposing secrets', () => {
    const file = writeTempAuthFile(
      JSON.stringify({
        providers: { meta: { mechanism: 'oauth', user_email: 'dev@example.com' } },
      })
    );
    const status = getMuseAuthStatus({ authPath: file, keychainEntry: BLOB });
    expect(status).toEqual({
      configured: true,
      mechanism: 'oauth',
      userEmail: 'dev@example.com',
      hasApiKey: true,
      hasSubscriptionToken: true,
    });
    expect(JSON.stringify(status)).not.toContain('test-meta-api-key');
    expect(JSON.stringify(status)).not.toContain('test-oauth-token');
  });

  it('reports unconfigured when nothing is present', () => {
    const missing = path.join(os.tmpdir(), 'muse-auth-missing-12345.json');
    expect(getMuseAuthStatus({ authPath: missing, keychainEntry: null })).toEqual({
      configured: false,
      mechanism: null,
      userEmail: null,
      hasApiKey: false,
      hasSubscriptionToken: false,
    });
  });
});

describe('getTokenExpiry', () => {
  const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');

  it('reads the exp claim of a JWT in milliseconds', () => {
    expect(getTokenExpiry(`${b64({ alg: 'none' })}.${b64({ exp: 1700000000 })}.sig`)).toBe(1700000000000);
  });

  it('returns null for opaque, malformed, or claim-less tokens', () => {
    expect(getTokenExpiry(null)).toBeNull();
    expect(getTokenExpiry('opaque-token')).toBeNull();
    expect(getTokenExpiry('a.not-base64-json.c')).toBeNull();
    expect(getTokenExpiry(`${b64({})}.${b64({ sub: 'x' })}.sig`)).toBeNull();
  });
});
