import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { startMockMetaServer, type MockServerInfo } from './fixtures/mock-meta-api.js';

// Keep the command away from the real Keychain and ~/.claude-muse/config.json.
const auth = vi.hoisted(() => ({ kind: 'api-key' as 'api-key' | 'oauth' }));
const server = vi.hoisted(() => ({ baseUrl: '' }));

vi.mock('../src/config/credentials.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/credentials.js')>();
  return {
    ...actual,
    resolveAuth: () => ({
      kind: auth.kind,
      token: 'test-token',
      source: auth.kind === 'oauth' ? 'muse-subscription' : 'keychain',
      fellBack: false,
      expiresAt: null,
      expired: false,
    }),
  };
});

vi.mock('../src/config/settings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/settings.js')>();
  return { ...actual, loadSettings: () => actual.getDefaultSettings(), saveSettings: vi.fn() };
});

vi.mock('../src/api/meta-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/meta-client.js')>();
  return {
    ...actual,
    createMetaClient: (resolved: { token: string }) => new actual.MetaClient(resolved.token, server.baseUrl),
  };
});

const { modelsCommand } = await import('../src/commands/models.js');

describe('modelsCommand error path', () => {
  let mockServer: MockServerInfo;
  let errors: string[];

  beforeAll(async () => {
    // Requiring a header the client never sends makes every request 401.
    mockServer = await startMockMetaServer({ requiredHeaders: { 'x-never-sent': 'yes' } });
    server.baseUrl = mockServer.baseUrl;
  });

  afterAll(async () => {
    await mockServer.close();
  });

  beforeEach(() => {
    errors = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation((msg: string) => {
      errors.push(String(msg));
    });
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits 1 with a clean message when the API key is rejected', async () => {
    auth.kind = 'api-key';
    await expect(modelsCommand({})).rejects.toThrow('process.exit(1)');
    expect(errors[0]).toContain('Could not fetch models: 401 Unauthorized');
    expect(errors.join('\n')).not.toContain('subscription endpoint');
  });

  it('adds a sign-in hint when the subscription token is rejected', async () => {
    auth.kind = 'oauth';
    await expect(modelsCommand({ subscription: true })).rejects.toThrow('process.exit(1)');
    expect(errors[0]).toContain('Could not fetch models: 401 Unauthorized');
    expect(errors[1]).toContain('subscription endpoint rejected the Muse Code token');
  });
});
