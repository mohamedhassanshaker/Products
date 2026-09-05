import { PrismaKnowledgeChunkRepository } from './prisma-knowledge-chunk.repository';

function makeChunkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chunk-1',
    tenantId: 'tenant-1',
    sourceId: 'source-1',
    chunkIndex: 0,
    text: 'hello',
    tokenCount: 2,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('PrismaKnowledgeChunkRepository', () => {
  function makeTx() {
    return {
      knowledgeChunk: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
  }

  function makePrisma(tx: ReturnType<typeof makeTx>) {
    return {
      db: { $executeRaw: jest.fn().mockResolvedValue(undefined), $queryRaw: jest.fn().mockResolvedValue([]) },
      transaction: jest.fn(async (fn: (tx: ReturnType<typeof makeTx>) => unknown) => fn(tx)),
    };
  }

  describe('replaceForSource', () => {
    it('deletes existing chunks then creates the new ones, both scoped by tenantId + sourceId, inside PrismaService.transaction', async () => {
      const tx = makeTx();
      tx.knowledgeChunk.findMany.mockResolvedValue([
        makeChunkRow({ id: 'chunk-1', chunkIndex: 0, text: 'a' }),
        makeChunkRow({ id: 'chunk-2', chunkIndex: 1, text: 'b' }),
      ]);
      const prisma = makePrisma(tx);
      const repo = new PrismaKnowledgeChunkRepository(prisma as never);

      const result = await repo.replaceForSource('tenant-1', 'source-1', [
        { chunkIndex: 0, text: 'a', tokenCount: 1 },
        { chunkIndex: 1, text: 'b', tokenCount: 1 },
      ]);

      expect(prisma.transaction).toHaveBeenCalledTimes(1);
      expect(tx.knowledgeChunk.deleteMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1', sourceId: 'source-1' } });
      expect(tx.knowledgeChunk.createMany).toHaveBeenCalledWith({
        data: [
          { tenantId: 'tenant-1', sourceId: 'source-1', chunkIndex: 0, text: 'a', tokenCount: 1 },
          { tenantId: 'tenant-1', sourceId: 'source-1', chunkIndex: 1, text: 'b', tokenCount: 1 },
        ],
      });
      expect(tx.knowledgeChunk.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', sourceId: 'source-1' },
        orderBy: { chunkIndex: 'asc' },
      });
      expect(result).toEqual([
        { id: 'chunk-1', chunkIndex: 0, text: 'a', tokenCount: 2 },
        { id: 'chunk-2', chunkIndex: 1, text: 'b', tokenCount: 2 },
      ]);
    });

    it('deletes existing chunks but skips createMany/findMany when the new set is empty', async () => {
      const tx = makeTx();
      const prisma = makePrisma(tx);
      const repo = new PrismaKnowledgeChunkRepository(prisma as never);

      const result = await repo.replaceForSource('tenant-1', 'source-1', []);

      expect(tx.knowledgeChunk.deleteMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1', sourceId: 'source-1' } });
      expect(tx.knowledgeChunk.createMany).not.toHaveBeenCalled();
      expect(tx.knowledgeChunk.findMany).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('writeEmbeddings', () => {
    it('writes one $executeRaw call per item, binding the vector literal and ids as tagged-template parameters', async () => {
      const prisma = makePrisma(makeTx());
      const repo = new PrismaKnowledgeChunkRepository(prisma as never);

      await repo.writeEmbeddings('tenant-1', 'source-1', [
        { chunkId: 'chunk-1', embedding: [0.1, 0.2, 0.3] },
        { chunkId: 'chunk-2', embedding: [-1, 0, 1] },
      ]);

      expect(prisma.db.$executeRaw).toHaveBeenCalledTimes(2);
      const [, literal1, chunkId1, tenantId1, sourceId1] = prisma.db.$executeRaw.mock.calls[0];
      expect(literal1).toBe('[0.1,0.2,0.3]');
      expect(chunkId1).toBe('chunk-1');
      expect(tenantId1).toBe('tenant-1');
      expect(sourceId1).toBe('source-1');
      const [, literal2, chunkId2] = prisma.db.$executeRaw.mock.calls[1];
      expect(literal2).toBe('[-1,0,1]');
      expect(chunkId2).toBe('chunk-2');
    });

    it('throws (never writes) when an embedding contains a non-finite value', async () => {
      const prisma = makePrisma(makeTx());
      const repo = new PrismaKnowledgeChunkRepository(prisma as never);

      await expect(
        repo.writeEmbeddings('tenant-1', 'source-1', [{ chunkId: 'chunk-1', embedding: [0.1, Number.NaN, 0.3] }]),
      ).rejects.toThrow();
      expect(prisma.db.$executeRaw).not.toHaveBeenCalled();
    });

    it('throws on an empty embedding array', async () => {
      const prisma = makePrisma(makeTx());
      const repo = new PrismaKnowledgeChunkRepository(prisma as never);

      await expect(repo.writeEmbeddings('tenant-1', 'source-1', [{ chunkId: 'chunk-1', embedding: [] }])).rejects.toThrow();
    });

    it('does nothing for an empty items array', async () => {
      const prisma = makePrisma(makeTx());
      const repo = new PrismaKnowledgeChunkRepository(prisma as never);
      await repo.writeEmbeddings('tenant-1', 'source-1', []);
      expect(prisma.db.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('hybridSearch', () => {
    function rows() {
      return [
        {
          chunk_id: 'chunk-1',
          source_id: 'source-1',
          source_name: 'Docs',
          text: 'Refunds are available within 30 days.',
          vector_score: 0.81,
          keyword_score: 0.74,
          passed_filter: true,
        },
      ];
    }

    it('returns [] and never queries when sourceRefs is empty (nothing to search)', async () => {
      const prisma = makePrisma(makeTx());
      const repo = new PrismaKnowledgeChunkRepository(prisma as never);
      const result = await repo.hybridSearch({
        tenantId: 'tenant-1',
        sourceRefs: [],
        queryText: 'q',
        queryEmbedding: [0.1],
        vectorWeight: 0.5,
        keywordWeight: 0.5,
        candidates: 10,
      });
      expect(result).toEqual([]);
      expect(prisma.db.$queryRaw).not.toHaveBeenCalled();
    });

    it('throws (never queries) on a non-finite embedding value', async () => {
      const prisma = makePrisma(makeTx());
      const repo = new PrismaKnowledgeChunkRepository(prisma as never);
      await expect(
        repo.hybridSearch({
          tenantId: 'tenant-1',
          sourceRefs: ['source-1'],
          queryText: 'q',
          queryEmbedding: [Number.NaN],
          vectorWeight: 0.5,
          keywordWeight: 0.5,
          candidates: 10,
        }),
      ).rejects.toThrow();
      expect(prisma.db.$queryRaw).not.toHaveBeenCalled();
    });

    it('maps rows to KnowledgeSearchCandidate and computes blendScore from vectorWeight/keywordWeight', async () => {
      const prisma = makePrisma(makeTx());
      prisma.db.$queryRaw.mockResolvedValue(rows());
      const repo = new PrismaKnowledgeChunkRepository(prisma as never);

      const result = await repo.hybridSearch({
        tenantId: 'tenant-1',
        sourceRefs: ['source-1'],
        queryText: 'refund after 30 days',
        queryEmbedding: [0.1, 0.2, 0.3],
        vectorWeight: 0.6,
        keywordWeight: 0.4,
        candidates: 20,
      });

      expect(result).toEqual([
        {
          chunkId: 'chunk-1',
          sourceId: 'source-1',
          sourceName: 'Docs',
          text: 'Refunds are available within 30 days.',
          vectorScore: 0.81,
          keywordScore: 0.74,
          blendScore: 0.6 * 0.81 + 0.4 * 0.74,
          passedFilter: true,
        },
      ]);
    });

    it('security: a metadata-filter field/value are bound query parameters, never concatenated into the SQL text', async () => {
      const prisma = makePrisma(makeTx());
      prisma.db.$queryRaw.mockResolvedValue([]);
      const repo = new PrismaKnowledgeChunkRepository(prisma as never);

      const maliciousValue = "refunds'; DROP TABLE knowledge_chunk; --";
      await repo.hybridSearch({
        tenantId: 'tenant-1',
        sourceRefs: ['source-1'],
        queryText: 'q',
        queryEmbedding: [0.1],
        vectorWeight: 0.5,
        keywordWeight: 0.5,
        candidates: 10,
        filter: { field: 'section', op: 'eq', value: maliciousValue },
      });

      expect(prisma.db.$queryRaw).toHaveBeenCalledTimes(1);
      const [strings, ...values] = prisma.db.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
      // The static SQL text (the tagged-template's `strings` half) must
      // never contain the attacker-supplied value or field name — proof
      // it was bound, not interpolated as raw SQL.
      const sqlText = strings.join('');
      expect(sqlText).not.toContain(maliciousValue);
      expect(sqlText).not.toContain('section');
      // ...and the value/field must appear among the *bound parameters*.
      expect(values).toContain(maliciousValue);
      expect(values).toContain('section');
      expect(sqlText).toContain('metadata ->>');
    });
  });
});
