import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleEmbeddingsAdapter } from './openai-compatible-embeddings.adapter';

describe('OpenAiCompatibleEmbeddingsAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.EMBEDDINGS_BASE_URL = 'https://api.example.com/v1';
    process.env.EMBEDDINGS_API_KEY = 'test-embed-key';
    process.env.EMBEDDINGS_MODEL = 'text-embedding-3-small';
    process.env.EMBEDDING_DIMS = '3';
    process.env.EMBEDDINGS_BATCH_SIZE = '2';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).__examlandEnv;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ['EMBEDDINGS_BASE_URL', 'EMBEDDINGS_API_KEY', 'EMBEDDINGS_MODEL', 'EMBEDDING_DIMS', 'EMBEDDINGS_BATCH_SIZE']) delete process.env[key];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).__examlandEnv;
  });

  it('model/dims reflect the configured env', () => {
    const adapter = new OpenAiCompatibleEmbeddingsAdapter();
    expect(adapter.model).toBe('text-embedding-3-small');
    expect(adapter.dims).toBe(3);
  });

  it('embed([]) returns [] without calling fetch', async () => {
    const adapter = new OpenAiCompatibleEmbeddingsAdapter();
    expect(await adapter.embed([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs to {EMBEDDINGS_BASE_URL}/embeddings with a Bearer Authorization header and the model/input body', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3], index: 0 }] }), { status: 200 }));
    const adapter = new OpenAiCompatibleEmbeddingsAdapter();

    const [vector] = await adapter.embed(['hello']);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/embeddings',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer test-embed-key' }) }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ model: 'text-embedding-3-small', input: ['hello'] });
    expect(vector).toEqual([1, 2, 3]);
  });

  it('re-orders results to input order using each result\'s own `index` field (API does not guarantee response order)', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [9, 9, 9], index: 1 }, { embedding: [1, 1, 1], index: 0 }] }), { status: 200 }),
    );
    const adapter = new OpenAiCompatibleEmbeddingsAdapter();

    const vectors = await adapter.embed(['first', 'second']);
    expect(vectors[0]).toEqual([1, 1, 1]);
    expect(vectors[1]).toEqual([9, 9, 9]);
  });

  it('batches requests at EMBEDDINGS_BATCH_SIZE, issuing one fetch call per batch', async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { input: string[] };
      return new Response(JSON.stringify({ data: body.input.map((_t, i) => ({ embedding: [i], index: i })) }), { status: 200 });
    });
    const adapter = new OpenAiCompatibleEmbeddingsAdapter();

    const vectors = await adapter.embed(['a', 'b', 'c']); // batch size 2 -> two fetch calls (2 + 1)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vectors).toHaveLength(3);
  });

  it('throws a clear error on a non-2xx response, without leaking the raw response body as the thrown message', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'invalid api key' }), { status: 401 }));
    const adapter = new OpenAiCompatibleEmbeddingsAdapter();

    await expect(adapter.embed(['x'])).rejects.toThrow('Embeddings provider returned 401');
  });

  it('omits the Authorization header entirely when EMBEDDINGS_API_KEY is empty', async () => {
    process.env.EMBEDDINGS_API_KEY = '';
    delete (globalThis as unknown as { __examlandEnv?: unknown }).__examlandEnv;
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ embedding: [1], index: 0 }] }), { status: 200 }));
    const adapter = new OpenAiCompatibleEmbeddingsAdapter();

    await adapter.embed(['x']);
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});
