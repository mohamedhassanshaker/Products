import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddingsPort, ScoredPoint, VectorStorePort } from '@/server/vector';
import { RetrievalService } from './retrieval.service';

/** `getEnv()` reads real `process.env` — these tests rely entirely on `env.schema.ts`'s own
 * documented defaults (`RETRIEVAL_TOPK_*`/`RETRIEVAL_RELEVANCE_FLOOR`/`RETRIEVAL_HYBRID_*`), matching
 * every other pure-logic test in this app that depends on `getEnv()`'s defaults rather than mocking
 * the config module. */

function fakeEmbeddings(vector: number[] = [1, 0, 0]): EmbeddingsPort {
  return { model: 'fake', dims: vector.length, embed: vi.fn(async (texts: string[]) => texts.map(() => vector)) };
}

function point(id: string, score: number, text: string): ScoredPoint {
  return { id, score, payload: { text, fileName: `${id}.txt`, pageNumber: 1 } };
}

describe('RetrievalService.retrieve', () => {
  let vectorStore: VectorStorePort;

  beforeEach(() => {
    vectorStore = {
      upsertChunks: vi.fn(),
      searchChunks: vi.fn(async () => []),
      scrollChunks: vi.fn(async () => []),
      deleteChunks: vi.fn(),
      upsertFingerprint: vi.fn(),
      searchFingerprint: vi.fn(async () => []),
      upsertQuestions: vi.fn(),
      searchQuestions: vi.fn(async () => []),
      scrollQuestions: vi.fn(async () => []),
      deleteQuestions: vi.fn(),
      purgeTenant: vi.fn(),
      countsForTenant: vi.fn(async () => ({})),
    };
  });

  it('returns [] for an empty/whitespace-only query without ever calling embed (no wasted external call)', async () => {
    const embeddings = fakeEmbeddings();
    const service = new RetrievalService(vectorStore, embeddings);

    expect(await service.retrieve({ tenantId: 't1' }, {}, '   ', 5)).toEqual([]);
    expect(embeddings.embed).not.toHaveBeenCalled();
  });

  it('maps dense search results to RetrievedChunk, passing the TenantScope through to VectorStorePort', async () => {
    vectorStore.searchChunks = vi.fn(async () => [point('a', 0.95, 'mitochondria powerhouse of the cell')]);
    const service = new RetrievalService(vectorStore, fakeEmbeddings());

    const result = await service.retrieve({ tenantId: 't1' }, {}, 'mitochondria powerhouse of the cell', 5);

    expect(vectorStore.searchChunks).toHaveBeenCalledWith({ tenantId: 't1' }, [1, 0, 0], {}, expect.any(Number));
    expect(result).toHaveLength(1);
    expect(result[0].fileName).toBe('a.txt');
  });

  it('a dense-only top-K miss is still surfaced via the lexical scroll channel (the hybrid-search proof)', async () => {
    // Dense channel returns an unrelated top hit; the true match only appears in the (wider) scroll
    // pool with a low dense score of its own, but a strong lexical overlap with the query.
    vectorStore.searchChunks = vi.fn(async () => [point('unrelated', 0.99, 'completely unrelated content about rocks')]);
    vectorStore.scrollChunks = vi.fn(async () => [{ ...point('distinctive', 0.01, 'zephyr zephyr distinctive term'), vector: [0, 1, 0] }]);
    const service = new RetrievalService(vectorStore, fakeEmbeddings([1, 0, 0]));

    const result = await service.retrieve({ tenantId: 't1' }, {}, 'zephyr', 5);

    expect(result.some((r) => r.fileName === 'distinctive.txt')).toBe(true);
  });

  it('excludes chunks below the relevance floor (default 0.15) even if returned by Qdrant', async () => {
    vectorStore.searchChunks = vi.fn(async () => [point('weak', 0.01, 'no meaningful overlap whatsoever xyz')]);
    const service = new RetrievalService(vectorStore, fakeEmbeddings());

    const result = await service.retrieve({ tenantId: 't1' }, {}, 'query with completely different terms', 5);
    expect(result).toEqual([]);
  });

  it('a scroll-only point never fetched by dense search still gets a real cosine-similarity dense component (not unfairly zeroed)', async () => {
    vectorStore.searchChunks = vi.fn(async () => []);
    // Identical vector to the query -> cosine similarity 1 -> definitely clears the relevance floor.
    vectorStore.scrollChunks = vi.fn(async () => [{ ...point('match', 0, 'irrelevant text for lexical purposes'), vector: [1, 0, 0] }]);
    const service = new RetrievalService(vectorStore, fakeEmbeddings([1, 0, 0]));

    const result = await service.retrieve({ tenantId: 't1' }, {}, 'anything', 5);
    expect(result.some((r) => r.fileName === 'match.txt')).toBe(true);
  });

  it('passes curriculumId/documentId scope through to both searchChunks and scrollChunks', async () => {
    const service = new RetrievalService(vectorStore, fakeEmbeddings());
    await service.retrieve({ tenantId: 't1' }, { curriculumId: 'c1', documentId: 'd1' }, 'some query', 5);

    expect(vectorStore.searchChunks).toHaveBeenCalledWith({ tenantId: 't1' }, expect.any(Array), { curriculumId: 'c1', documentId: 'd1' }, expect.any(Number));
    expect(vectorStore.scrollChunks).toHaveBeenCalledWith({ tenantId: 't1' }, { curriculumId: 'c1', documentId: 'd1' }, expect.objectContaining({ withVector: true }));
  });
});
