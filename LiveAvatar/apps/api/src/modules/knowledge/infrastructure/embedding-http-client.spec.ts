import { EmbeddingHttpClient } from './embedding-http-client';

describe('EmbeddingHttpClient', () => {
  const originalFetch = global.fetch;
  const originalServiceUrl = process.env.EMBEDDING_SERVICE_URL;
  const originalToken = process.env.INTERNAL_TOKEN;
  let client: EmbeddingHttpClient;

  beforeEach(() => {
    client = new EmbeddingHttpClient();
    process.env.EMBEDDING_SERVICE_URL = 'http://embed.internal.test';
    process.env.INTERNAL_TOKEN = 'shared-secret';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.EMBEDDING_SERVICE_URL = originalServiceUrl;
    process.env.INTERNAL_TOKEN = originalToken;
    jest.restoreAllMocks();
  });

  it('POSTs to {EMBEDDING_SERVICE_URL}/embed with the X-Internal-Token header and snake_case body', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ model: 'text-embedding-3-small', dimension: 3, embeddings: [[0.1, 0.2, 0.3]] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.embed({
      provider: 'openai',
      model: 'text-embedding-3-small',
      credentialRef: 'secrets/openai',
      inputs: ['hello'],
    });

    expect(fetchMock).toHaveBeenCalledWith('http://embed.internal.test/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': 'shared-secret' },
      body: JSON.stringify({
        provider: 'openai',
        model: 'text-embedding-3-small',
        credential_ref: 'secrets/openai',
        inputs: ['hello'],
      }),
    });
    expect(result).toEqual({ dimension: 3, embeddings: [[0.1, 0.2, 0.3]] });
  });

  it('defaults to http://localhost:8082 when EMBEDDING_SERVICE_URL is unset', async () => {
    delete process.env.EMBEDDING_SERVICE_URL;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ model: 'x', dimension: 1, embeddings: [[1]] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await client.embed({ provider: 'openai', model: 'x', credentialRef: null, inputs: ['a'] });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8082/embed', expect.anything());
  });

  it('rejects an empty inputs array without calling fetch', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(client.embed({ provider: 'openai', model: 'x', credentialRef: null, inputs: [] })).rejects.toMatchObject({
      code: 'KNOWLEDGE_INGEST_FAILED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects more than 96 inputs without calling fetch', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      client.embed({ provider: 'openai', model: 'x', credentialRef: null, inputs: Array(97).fill('a') }),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_INGEST_FAILED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a non-2xx response to KNOWLEDGE_INGEST_FAILED without leaking the response body', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'super secret vendor stack trace with an api key sk-abc123',
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    try {
      await client.embed({ provider: 'openai', model: 'x', credentialRef: null, inputs: ['a'] });
      fail('expected throw');
    } catch (err) {
      expect((err as { code: string }).code).toBe('KNOWLEDGE_INGEST_FAILED');
      expect(JSON.stringify(err)).not.toContain('sk-abc123');
    }
  });

  it('maps a network-level failure (fetch rejecting) to KNOWLEDGE_INGEST_FAILED', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

    await expect(client.embed({ provider: 'openai', model: 'x', credentialRef: null, inputs: ['a'] })).rejects.toMatchObject({
      code: 'KNOWLEDGE_INGEST_FAILED',
    });
  });
});
