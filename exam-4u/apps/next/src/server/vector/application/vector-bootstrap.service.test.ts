import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QdrantVectorStoreAdapter } from '@/server/infrastructure/vector';
import { VectorBootstrapService } from './vector-bootstrap.service';
import type { VectorCollectionMetaRepository } from '../infrastructure/vector-collection-meta.repository';

/** Pure-logic unit tests (fake adapter/repository, no real Qdrant/MySQL) for `VectorBootstrapService`'s
 * own dimension/embedding-model drift-guard rules — mirrors `legacy/api/src/vector/application/
 * vector-bootstrap.service.spec.ts`'s own coverage shape. Complements, not replaces,
 * `scripts/ai-smoke.ts`'s real end-to-end bootstrap proof against a genuinely-running Qdrant/MySQL. */

function fakeAdapter(overrides: Partial<QdrantVectorStoreAdapter> = {}): QdrantVectorStoreAdapter {
  return {
    collectionNames: vi.fn(() => ({ chunks: 'p_chunks', fingerprints: 'p_doc_fingerprints', questionBank: 'p_question_bank' })),
    ensureCollection: vi.fn(async () => undefined),
    getCollectionVectorSize: vi.fn(async () => 1536),
    ...overrides,
  } as unknown as QdrantVectorStoreAdapter;
}

function fakeMetaRepo(overrides: Partial<VectorCollectionMetaRepository> = {}): VectorCollectionMetaRepository {
  return {
    findByCollection: vi.fn(async () => null),
    createIfAbsent: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as VectorCollectionMetaRepository;
}

const ORIGINAL_ENV = { ...process.env };

describe('VectorBootstrapService.run', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, EMBEDDINGS_MODEL: 'text-embedding-3-small', EMBEDDING_DIMS: '1536' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).__examlandEnv;
  });

  it('ensures all three collections and records first-boot meta when no row exists yet', async () => {
    const adapter = fakeAdapter();
    const metaRepo = fakeMetaRepo();
    const service = new VectorBootstrapService(adapter, metaRepo);

    await service.run();

    expect(adapter.ensureCollection).toHaveBeenCalledTimes(3);
    expect(adapter.ensureCollection).toHaveBeenCalledWith('p_chunks', 1536, ['curriculumId', 'documentId']);
    expect(adapter.ensureCollection).toHaveBeenCalledWith('p_doc_fingerprints', 1536, ['fileHash']);
    expect(adapter.ensureCollection).toHaveBeenCalledWith('p_question_bank', 1536, ['scopeKey', 'examTypeId']);
    expect(metaRepo.createIfAbsent).toHaveBeenCalledTimes(3);
    expect(metaRepo.createIfAbsent).toHaveBeenCalledWith({ collection: 'p_chunks', embeddingModel: 'text-embedding-3-small', dims: 1536 });
  });

  it('throws with an actionable message when the live Qdrant vector size does not match EMBEDDING_DIMS', async () => {
    const adapter = fakeAdapter({ getCollectionVectorSize: vi.fn(async () => 768) });
    const service = new VectorBootstrapService(adapter, fakeMetaRepo());

    await expect(service.run()).rejects.toThrow(/vector size 768.*EMBEDDING_DIMS=1536/);
  });

  it('throws when platform.vector_collection_meta recorded a different embedding model than the current config', async () => {
    const metaRepo = fakeMetaRepo({ findByCollection: vi.fn(async () => ({ collection: 'p_chunks', embeddingModel: 'old-model', dims: 1536, createdAt: new Date() })) });
    const service = new VectorBootstrapService(fakeAdapter(), metaRepo);

    await expect(service.run()).rejects.toThrow(/built with embedding_model="old-model"/);
  });

  it('throws when platform.vector_collection_meta recorded different dims than the current config', async () => {
    const metaRepo = fakeMetaRepo({ findByCollection: vi.fn(async () => ({ collection: 'p_chunks', embeddingModel: 'text-embedding-3-small', dims: 768, createdAt: new Date() })) });
    const service = new VectorBootstrapService(fakeAdapter(), metaRepo);

    await expect(service.run()).rejects.toThrow(/dims=768/);
  });

  it('does not throw when the recorded meta row matches the current config exactly', async () => {
    const metaRepo = fakeMetaRepo({ findByCollection: vi.fn(async () => ({ collection: 'p_chunks', embeddingModel: 'text-embedding-3-small', dims: 1536, createdAt: new Date() })) });
    const service = new VectorBootstrapService(fakeAdapter(), metaRepo);

    await expect(service.run()).resolves.not.toThrow();
    expect(metaRepo.createIfAbsent).not.toHaveBeenCalled();
  });

  it('tolerates platform.vector_collection_meta not existing yet (ER_NO_SUCH_TABLE) — migrations-ordering, not a drift failure', async () => {
    const missingTableError = Object.assign(new Error('Table does not exist'), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });
    const metaRepo = fakeMetaRepo({ findByCollection: vi.fn(async () => { throw missingTableError; }) });
    const service = new VectorBootstrapService(fakeAdapter(), metaRepo);

    await expect(service.run()).resolves.not.toThrow();
  });

  it('propagates any other database error from findByCollection (a genuine connection/permission failure must still fail boot)', async () => {
    const otherError = Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' });
    const metaRepo = fakeMetaRepo({ findByCollection: vi.fn(async () => { throw otherError; }) });
    const service = new VectorBootstrapService(fakeAdapter(), metaRepo);

    await expect(service.run()).rejects.toThrow('Connection refused');
  });
});
