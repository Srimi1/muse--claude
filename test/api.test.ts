import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MetaClient, createMetaClient } from '../src/api/meta-client.js';
import { resolveAliases, validateModel, getContributorWarning } from '../src/api/model-resolver.js';
import { startMockMetaServer, type MockServerInfo } from './fixtures/mock-meta-api.js';

describe('MetaClient & Model Resolver', () => {
  let mockServer: MockServerInfo;

  beforeAll(async () => {
    mockServer = await startMockMetaServer();
  });

  afterAll(async () => {
    await mockServer.close();
  });

  it('authenticates successfully with valid key against mock server', async () => {
    const client = new MetaClient('valid-test-key', mockServer.baseUrl);
    const ok = await client.testAuth();
    expect(ok).toBe(true);
  });

  it('fails authentication when token is invalid or missing', async () => {
    const client = new MetaClient('', mockServer.baseUrl);
    const ok = await client.testAuth();
    expect(ok).toBe(false);
  });

  it('lists and filters only Spark coding models', async () => {
    const client = new MetaClient('valid-test-key', mockServer.baseUrl);
    const models = await client.listModels();

    expect(models.length).toBe(2);
    expect(models.map((m) => m.id)).toEqual(['muse-spark-1.3', 'muse-spark-1.3-contributor']);

    const standard = models.find((m) => m.id === 'muse-spark-1.3');
    expect(standard?.isContributor).toBe(false);

    const contributor = models.find((m) => m.id === 'muse-spark-1.3-contributor');
    expect(contributor?.isContributor).toBe(true);
  });

  it('measures streaming latency from Messages API endpoint', async () => {
    const client = new MetaClient('valid-test-key', mockServer.baseUrl);
    const streamResult = await client.testStreaming();
    expect(streamResult.success).toBe(true);
    expect(streamResult.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('resolves model aliases correctly for standard models', () => {
    const aliases = resolveAliases('muse-spark-1.3', false);
    expect(aliases.main).toBe('muse-spark-1.3');
    expect(aliases.opus).toBe('muse-spark-1.3');
    expect(aliases.sonnet).toBe('muse-spark-1.3');
    expect(aliases.haiku).toBe('muse-spark-1.3');
    expect(aliases.subagent).toBe('muse-spark-1.3');
  });

  it('resolves model aliases mapping haiku to contributor variant when requested', () => {
    const aliases = resolveAliases('muse-spark-1.3', true);
    expect(aliases.main).toBe('muse-spark-1.3');
    expect(aliases.haiku).toBe('muse-spark-1.3-contributor');
  });

  it('validates model existence against available models list', () => {
    const mockModels = [
      { id: 'muse-spark-1.3', name: 'Muse Spark 1.3', created: 123, owned_by: 'meta', isContributor: false },
    ];
    expect(validateModel('muse-spark-1.3', mockModels)).not.toBeNull();
    expect(validateModel('unknown-model', mockModels)).toBeNull();
  });

  it('provides a contributor warning with data-training clarification', () => {
    const warning = getContributorWarning();
    expect(warning.toLowerCase()).toContain('contributor');
    expect(warning.toLowerCase()).toContain('training');
  });
});

describe('MetaClient extra headers', () => {
  let mockServer: MockServerInfo;

  beforeAll(async () => {
    mockServer = await startMockMetaServer({ requiredHeaders: { 'x-test-client': 'muse' } });
  });

  afterAll(async () => {
    await mockServer.close();
  });

  it('sends extra headers on every request', async () => {
    const client = new MetaClient('token', mockServer.baseUrl, { 'x-test-client': 'muse' });
    expect(await client.testAuth()).toBe(true);
    expect((await client.testStreaming()).success).toBe(true);
  });

  it('fails when an endpoint needs headers the client does not send', async () => {
    const client = new MetaClient('token', mockServer.baseUrl);
    expect(await client.testAuth()).toBe(false);
  });

  it('reports why the streaming test failed', async () => {
    const result = await new MetaClient('token', mockServer.baseUrl).testStreaming();
    expect(result.success).toBe(false);
    expect(result.error).toContain('401');
  });
});

describe('createMetaClient', () => {
  let mockServer: MockServerInfo;

  beforeAll(async () => {
    mockServer = await startMockMetaServer();
  });

  afterAll(async () => {
    await mockServer.close();
  });

  it('builds a working client for either credential kind', async () => {
    for (const kind of ['api-key', 'oauth'] as const) {
      const client = createMetaClient({ kind, token: 'token' }, mockServer.baseUrl);
      expect(await client.testAuth()).toBe(true);
    }
  });
});
