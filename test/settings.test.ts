import { describe, it, expect } from 'vitest';
import { normalizeSettings, getDefaultSettings } from '../src/config/settings.js';

describe('normalizeSettings', () => {
  it('accepts every known credential source', () => {
    for (const source of ['keychain', 'muse', 'muse-subscription']) {
      expect(normalizeSettings({ credentialSource: source }).credentialSource).toBe(source);
    }
  });

  it('falls back to the default for an unknown credential source', () => {
    expect(normalizeSettings({ credentialSource: 'bogus' }).credentialSource).toBe('keychain');
  });

  it('merges partial aliases over the defaults', () => {
    const settings = normalizeSettings({ selectedModel: 'm', modelAliases: { haiku: 'h' } });
    expect(settings.selectedModel).toBe('m');
    expect(settings.modelAliases).toEqual({ ...getDefaultSettings().modelAliases, haiku: 'h' });
  });

  it('returns defaults for empty input', () => {
    expect(normalizeSettings(null)).toEqual(getDefaultSettings());
  });
});
