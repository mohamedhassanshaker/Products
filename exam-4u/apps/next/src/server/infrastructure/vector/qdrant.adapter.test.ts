import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QdrantVectorStoreAdapter } from './qdrant.adapter';

/**
 * Unit coverage for `QdrantVectorStoreAdapter`'s own logic — filter composition, payload
 * tenant-stamping, point-id namespacing, and the defense-in-depth leak alarm — using a scripted fake
 * `QdrantClient` double (ported/adapted from `legacy/api/src/infrastructure/vector/qdrant.adapter.spec.ts`).
 *
 * Complements, and does not replace, `scripts/ai-smoke.ts`'s real-Qdrant two-tenant isolation proof —
 * that script is the actual chokepoint evidence; this suite exists to hit branches (like the leak
 * alarm) a correctly-functioning real server should never actually trigger, so they'd otherwise be
 * unreachable for coverage purposes.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only fake client double, shape matched to what QdrantVectorStoreAdapter actually calls.
function makeFakeClient(): any {
  return {
    upsert: vi.fn().mockResolvedValue({}),
    query: vi.fn().mockResolvedValue({ points: [] }),
    scroll: vi.fn().mockResolvedValue({ points: [] }),
    delete: vi.fn().mockResolvedValue({}),
    count: vi.fn().mockResolvedValue({ count: 0 }),
    collectionExists: vi.fn().mockResolvedValue({ exists: false }),
    createCollection: vi.fn().mockResolvedValue({}),
    createPayloadIndex: vi.fn().mockResolvedValue({}),
    getCollection: vi.fn().mockResolvedValue({ config: { params: { vectors: { size: 1536 } } } }),
  };
}

describe('QdrantVectorStoreAdapter', () => {
  const scope = { tenantId: 'tenant-a' };

  beforeEach(() => {
    process.env.VECTOR_COLLECTION_PREFIX = 'examland_unit';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).__examlandEnv;
  });

  afterEach(() => {
    delete process.env.VECTOR_COLLECTION_PREFIX;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).__examlandEnv;
  });

  it('upsertChunks stamps payload.tenantId from scope, overriding any caller-supplied value', async () => {
    const client = makeFakeClient();
    const adapter = new QdrantVectorStoreAdapter(client);
    await adapter.upsertChunks(scope, [{ id: 'p1', vector: [0.1], payload: { tenantId: 'attacker-tenant', text: 'x' } }]);
    expect(client.upsert).toHaveBeenCalledWith(
      'examland_unit_chunks',
      expect.objectContaining({ points: [expect.objectContaining({ payload: { tenantId: 'tenant-a', text: 'x' } })] }),
    );
  });

  it('upsertChunks/upsertQuestions no-op on an empty array without calling the client', async () => {
    const client = makeFakeClient();
    const adapter = new QdrantVectorStoreAdapter(client);
    await adapter.upsertChunks(scope, []);
    await adapter.upsertQuestions(scope, []);
    expect(client.upsert).not.toHaveBeenCalled();
  });

  it('searchChunks always prepends the mandatory tenantId must-clause to the filter', async () => {
    const client = makeFakeClient();
    const adapter = new QdrantVectorStoreAdapter(client);
    await adapter.searchChunks(scope, [0.1, 0.2], { curriculumId: 'c1' }, 5, 0.5);
    expect(client.query).toHaveBeenCalledWith(
      'examland_unit_chunks',
      expect.objectContaining({
        filter: { must: [{ key: 'tenantId', match: { value: 'tenant-a' } }, { key: 'curriculumId', match: { value: 'c1' } }] },
        limit: 5,
        score_threshold: 0.5,
      }),
    );
  });

  it('scrollChunks omits an unset optional filter field entirely (no key: undefined leaking into the filter)', async () => {
    const client = makeFakeClient();
    const adapter = new QdrantVectorStoreAdapter(client);
    await adapter.scrollChunks(scope, {}, { limit: 10 });
    expect(client.scroll).toHaveBeenCalledWith(
      'examland_unit_chunks',
      expect.objectContaining({ filter: { must: [{ key: 'tenantId', match: { value: 'tenant-a' } }] }, with_vector: false }),
    );
  });

  it('deleteChunks scopes the delete filter to the tenant plus the caller filter', async () => {
    const client = makeFakeClient();
    const adapter = new QdrantVectorStoreAdapter(client);
    await adapter.deleteChunks(scope, { documentId: 'd1' });
    expect(client.delete).toHaveBeenCalledWith(
      'examland_unit_chunks',
      expect.objectContaining({ filter: { must: [{ key: 'tenantId', match: { value: 'tenant-a' } }, { key: 'documentId', match: { value: 'd1' } }] } }),
    );
  });

  it('upsertFingerprint/searchFingerprint operate against the doc_fingerprints collection', async () => {
    const client = makeFakeClient();
    const adapter = new QdrantVectorStoreAdapter(client);
    await adapter.upsertFingerprint(scope, { id: 'f1', vector: [0.1], payload: { fileHash: 'abc' } });
    await adapter.searchFingerprint(scope, [0.1], 0.97);
    expect(client.upsert).toHaveBeenCalledWith('examland_unit_doc_fingerprints', expect.anything());
    expect(client.query).toHaveBeenCalledWith('examland_unit_doc_fingerprints', expect.objectContaining({ score_threshold: 0.97 }));
  });

  it('deleteQuestions with questionKeys builds a tenant-must + questionKey-should filter (batched key delete)', async () => {
    const client = makeFakeClient();
    const adapter = new QdrantVectorStoreAdapter(client);
    await adapter.deleteQuestions(scope, { questionKeys: ['k1', 'k2'] });
    expect(client.delete).toHaveBeenCalledWith(
      'examland_unit_question_bank',
      expect.objectContaining({
        filter: {
          must: [{ key: 'tenantId', match: { value: 'tenant-a' } }],
          should: [{ key: 'questionKey', match: { value: 'k1' } }, { key: 'questionKey', match: { value: 'k2' } }],
        },
      }),
    );
  });

  it('deleteQuestions without questionKeys falls back to the examTypeId-filtered tenant delete', async () => {
    const client = makeFakeClient();
    const adapter = new QdrantVectorStoreAdapter(client);
    await adapter.deleteQuestions(scope, { examTypeId: 'et1' });
    expect(client.delete).toHaveBeenCalledWith(
      'examland_unit_question_bank',
      expect.objectContaining({ filter: { must: [{ key: 'tenantId', match: { value: 'tenant-a' } }, { key: 'examTypeId', match: { value: 'et1' } }] } }),
    );
  });

  it('purgeTenant deletes from all three collections with a tenant-only filter', async () => {
    const client = makeFakeClient();
    const adapter = new QdrantVectorStoreAdapter(client);
    await adapter.purgeTenant(scope);
    expect(client.delete).toHaveBeenCalledTimes(3);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const call of client.delete.mock.calls as any[]) {
      expect(call[1]).toMatchObject({ filter: { must: [{ key: 'tenantId', match: { value: 'tenant-a' } }] } });
    }
  });

  it('countsForTenant returns a per-collection count map, keyed by real collection name', async () => {
    const client = makeFakeClient();
    client.count.mockResolvedValue({ count: 3 });
    const adapter = new QdrantVectorStoreAdapter(client);
    const counts = await adapter.countsForTenant(scope);
    expect(counts).toEqual({ examland_unit_chunks: 3, examland_unit_doc_fingerprints: 3, examland_unit_question_bank: 3 });
  });

  it('drops and logs a defensive leak alarm for any result whose payload tenant does not match the scope (search)', async () => {
    const client = makeFakeClient();
    client.query.mockResolvedValue({
      points: [
        { id: 'ok', score: 0.9, payload: { tenantId: 'tenant-a' } },
        { id: 'leaked', score: 0.8, payload: { tenantId: 'tenant-b' } },
      ],
    });
    const adapter = new QdrantVectorStoreAdapter(client);
    const results = await adapter.searchChunks(scope, [0.1], {}, 10);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('ok');
  });

  it('drops a leaked point on scroll too', async () => {
    const client = makeFakeClient();
    client.scroll.mockResolvedValue({ points: [{ id: 'leaked', payload: { tenantId: 'tenant-b' }, vector: [0.1] }] });
    const adapter = new QdrantVectorStoreAdapter(client);
    const results = await adapter.scrollChunks(scope, {}, { limit: 10, withVector: true });
    expect(results).toHaveLength(0);
  });

  it('searchQuestions/scrollQuestions operate against the question_bank collection with their own filter fields', async () => {
    const client = makeFakeClient();
    client.query.mockResolvedValue({ points: [{ id: 'q1', score: 0.9, payload: { tenantId: 'tenant-a' }, vector: [0.1, 0.2] }] });
    const adapter = new QdrantVectorStoreAdapter(client);
    const searchResults = await adapter.searchQuestions(scope, [0.1], { scopeKey: 'S1|math', examTypeId: 'et1' }, 3);
    expect(client.query).toHaveBeenCalledWith(
      'examland_unit_question_bank',
      expect.objectContaining({
        filter: {
          must: [
            { key: 'tenantId', match: { value: 'tenant-a' } },
            { key: 'scopeKey', match: { value: 'S1|math' } },
            { key: 'examTypeId', match: { value: 'et1' } },
          ],
        },
      }),
    );
    expect(searchResults[0].vector).toEqual([0.1, 0.2]);
  });

  it('searchQuestions passes an optional scoreThreshold through to Qdrant\'s own score_threshold', async () => {
    const client = makeFakeClient();
    const adapter = new QdrantVectorStoreAdapter(client);
    await adapter.searchQuestions(scope, [0.1], {}, 5, 0.75);
    expect(client.query).toHaveBeenCalledWith('examland_unit_question_bank', expect.objectContaining({ score_threshold: 0.75 }));
  });

  it('pointId is deterministic per (tenant, logicalKey) and differs across tenants for the same logicalKey', () => {
    const adapter = new QdrantVectorStoreAdapter(makeFakeClient());
    const idA1 = adapter.pointId('tenant-a', 'doc1:0');
    const idA2 = adapter.pointId('tenant-a', 'doc1:0');
    const idB1 = adapter.pointId('tenant-b', 'doc1:0');
    expect(idA1).toBe(idA2);
    expect(idA1).not.toBe(idB1);
  });

  it('collectionNames uses the configured prefix', () => {
    const adapter = new QdrantVectorStoreAdapter(makeFakeClient());
    expect(adapter.collectionNames()).toEqual({
      chunks: 'examland_unit_chunks',
      fingerprints: 'examland_unit_doc_fingerprints',
      questionBank: 'examland_unit_question_bank',
    });
  });

  it('ensureCollection creates the collection with the right vector size only when it does not already exist', async () => {
    const client = makeFakeClient();
    client.collectionExists.mockResolvedValueOnce({ exists: false });
    const adapter = new QdrantVectorStoreAdapter(client);
    await adapter.ensureCollection('examland_unit_chunks', 1536, ['curriculumId']);
    expect(client.createCollection).toHaveBeenCalledWith('examland_unit_chunks', { vectors: { size: 1536, distance: 'Cosine' } });
    expect(client.createPayloadIndex).toHaveBeenCalledWith('examland_unit_chunks', { field_name: 'tenantId', field_schema: { type: 'keyword', is_tenant: true } });
    expect(client.createPayloadIndex).toHaveBeenCalledWith('examland_unit_chunks', { field_name: 'curriculumId', field_schema: 'keyword' });
  });

  it('ensureCollection never recreates an already-existing collection', async () => {
    const client = makeFakeClient();
    client.collectionExists.mockResolvedValueOnce({ exists: true });
    const adapter = new QdrantVectorStoreAdapter(client);
    await adapter.ensureCollection('examland_unit_chunks', 1536, []);
    expect(client.createCollection).not.toHaveBeenCalled();
  });

  it('getCollectionVectorSize returns undefined for a non-existent collection', async () => {
    const client = makeFakeClient();
    client.collectionExists.mockResolvedValueOnce({ exists: false });
    const adapter = new QdrantVectorStoreAdapter(client);
    expect(await adapter.getCollectionVectorSize('nope')).toBeUndefined();
  });
});
