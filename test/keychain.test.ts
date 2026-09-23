import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFileSync = vi.fn(() => Buffer.from(''));
const execSync = vi.fn(() => Buffer.from(''));

vi.mock('child_process', () => ({ execFileSync, execSync }));

const { writeApiKey, readApiKey, deleteApiKey } = await import('../src/config/keychain.js');
const { KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT } = await import('../src/config/constants.js');

describe('Keychain credential handling', () => {
  beforeEach(() => {
    execFileSync.mockClear();
    execSync.mockClear();
  });

  it('never hands the API key to a shell', () => {
    // A key containing shell metacharacters must be stored verbatim rather
    // than being interpolated into a command string and executed.
    const hostileKey = 'abc"; touch /tmp/pwned; echo "$(whoami)`id`';
    writeApiKey(hostileKey);

    expect(execSync).not.toHaveBeenCalled();
    expect(execFileSync).toHaveBeenCalledTimes(1);

    const [bin, args] = execFileSync.mock.calls[0] as unknown as [string, string[]];
    expect(bin).toBe('security');
    // The key is one discrete argv entry, not spliced into a shell string.
    expect(args).toContain(hostileKey);
    expect(args.filter((a) => a === hostileKey)).toHaveLength(1);
    expect(args).toEqual([
      'add-generic-password',
      '-s', KEYCHAIN_SERVICE,
      '-a', KEYCHAIN_ACCOUNT,
      '-w', hostileKey,
      '-U',
    ]);
  });

  it('reads and deletes without a shell too', () => {
    readApiKey();
    deleteApiKey();

    expect(execSync).not.toHaveBeenCalled();
    expect(execFileSync).toHaveBeenCalledTimes(2);
    for (const call of execFileSync.mock.calls) {
      expect(call[0]).toBe('security');
      expect(Array.isArray(call[1])).toBe(true);
    }
  });

  it('surfaces a write failure instead of swallowing it', () => {
    execFileSync.mockImplementationOnce(() => {
      throw new Error('keychain locked');
    });
    expect(() => writeApiKey('k')).toThrow(/Failed to save API key/);
  });
});
