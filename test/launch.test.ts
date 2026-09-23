import { describe, it, expect } from 'vitest';
import { buildLaunchEnv } from '../src/commands/launch.js';
import { resolveAliases } from '../src/api/model-resolver.js';

const aliases = resolveAliases('muse-spark-1.3');

describe('buildLaunchEnv', () => {
  it('passes the credential as a bearer token', () => {
    const env = buildLaunchEnv({ PATH: '/bin' }, 'meta-key', 'https://example.test/v1', aliases);
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('meta-key');
    expect(env.PATH).toBe('/bin');
  });

  it('strips /v1 because Claude Code appends /v1/messages itself', () => {
    expect(buildLaunchEnv({}, 'k', 'https://example.test/v1', aliases).ANTHROPIC_BASE_URL).toBe('https://example.test');
    expect(buildLaunchEnv({}, 'k', 'https://example.test/v1/', aliases).ANTHROPIC_BASE_URL).toBe('https://example.test');
    expect(buildLaunchEnv({}, 'k', 'https://example.test', aliases).ANTHROPIC_BASE_URL).toBe('https://example.test');
  });

  it('maps every Claude Code model slot to the selected model', () => {
    const env = buildLaunchEnv({}, 'k', 'https://example.test/v1', resolveAliases('muse-spark-1.3', true));
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('muse-spark-1.3');
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('muse-spark-1.3');
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('muse-spark-1.3-contributor');
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('muse-spark-1.3');
  });

  it('never sets ANTHROPIC_API_KEY, and drops an inherited one', () => {
    const env = buildLaunchEnv({ ANTHROPIC_API_KEY: 'stale' }, 'k', 'https://example.test/v1', aliases);
    expect('ANTHROPIC_API_KEY' in env).toBe(false);
  });

  it('does not modify the inherited environment', () => {
    const base = { ANTHROPIC_API_KEY: 'k' };
    buildLaunchEnv(base, 'meta-key', 'https://example.test/v1', aliases);
    expect(base).toEqual({ ANTHROPIC_API_KEY: 'k' });
  });
});
