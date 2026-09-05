import { PrismaKnowledgeSourceRepository } from './prisma-knowledge-source.repository';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'source-1',
    tenantId: 'tenant-1',
    name: 'Docs',
    originalFilename: 'docs.txt',
    mimeType: 'text/plain',
    fileSizeBytes: 5,
    rawContent: Buffer.from('hello'),
    parser: 'plain_text',
    chunkingStrategy: 'fixed',
    chunkSize: 800,
    chunkOverlap: 100,
    embeddingModel: 'text-embedding-3-small',
    embeddingCredentialRef: null,
    status: 'pending',
    chunkCount: 0,
    errorMessage: null,
    configUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
    lastIndexedAt: null,
    createdBy: 'admin-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('PrismaKnowledgeSourceRepository', () => {
  function makePrisma() {
    return {
      db: {
        knowledgeSource: {
          findMany: jest.fn(),
          findFirst: jest.fn(),
          create: jest.fn(),
          updateMany: jest.fn(),
          deleteMany: jest.fn(),
        },
      },
    };
  }

  describe('create', () => {
    it('persists every field, defaulting sourceType to upload in the mapped record', async () => {
      const prisma = makePrisma();
      prisma.db.knowledgeSource.create.mockResolvedValue(makeRow());
      const repo = new PrismaKnowledgeSourceRepository(prisma as never);

      const input = {
        tenantId: 'tenant-1',
        name: 'Docs',
        originalFilename: 'docs.txt',
        mimeType: 'text/plain',
        fileSizeBytes: 5,
        rawContent: Buffer.from('hello'),
        parser: 'plain_text' as const,
        chunkingStrategy: 'fixed' as const,
        chunkSize: 800,
        chunkOverlap: 100,
        embeddingModel: 'text-embedding-3-small',
        embeddingCredentialRef: null,
        status: 'pending' as const,
        chunkCount: 0,
        createdBy: 'admin-1',
      };
      const result = await repo.create(input);

      expect(prisma.db.knowledgeSource.create).toHaveBeenCalledWith({ data: input });
      expect(result).toMatchObject({ id: 'source-1', sourceType: 'upload' });
      expect(result.rawContent).toEqual(Buffer.from('hello'));
    });
  });

  describe('findById', () => {
    it('scopes the lookup by tenantId', async () => {
      const prisma = makePrisma();
      prisma.db.knowledgeSource.findFirst.mockResolvedValue(makeRow());
      const repo = new PrismaKnowledgeSourceRepository(prisma as never);

      const result = await repo.findById('tenant-1', 'source-1');

      expect(prisma.db.knowledgeSource.findFirst).toHaveBeenCalledWith({ where: { id: 'source-1', tenantId: 'tenant-1' } });
      expect(result?.id).toBe('source-1');
    });

    it('returns null when not found', async () => {
      const prisma = makePrisma();
      prisma.db.knowledgeSource.findFirst.mockResolvedValue(null);
      const repo = new PrismaKnowledgeSourceRepository(prisma as never);
      expect(await repo.findById('tenant-1', 'nope')).toBeNull();
    });
  });

  describe('findMany', () => {
    it('lists every source for a tenant, newest first', async () => {
      const prisma = makePrisma();
      prisma.db.knowledgeSource.findMany.mockResolvedValue([makeRow(), makeRow({ id: 'source-2' })]);
      const repo = new PrismaKnowledgeSourceRepository(prisma as never);

      const result = await repo.findMany('tenant-1');

      expect(prisma.db.knowledgeSource.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('update', () => {
    it('returns "missing" when the row does not exist', async () => {
      const prisma = makePrisma();
      prisma.db.knowledgeSource.findFirst.mockResolvedValue(null);
      const repo = new PrismaKnowledgeSourceRepository(prisma as never);

      const result = await repo.update('tenant-1', 'source-1', new Date(), { name: 'x' });

      expect(result).toBe('missing');
      expect(prisma.db.knowledgeSource.updateMany).not.toHaveBeenCalled();
    });

    it('returns "conflict" when updateMany matches zero rows', async () => {
      const prisma = makePrisma();
      prisma.db.knowledgeSource.findFirst.mockResolvedValue(makeRow());
      prisma.db.knowledgeSource.updateMany.mockResolvedValue({ count: 0 });
      const repo = new PrismaKnowledgeSourceRepository(prisma as never);

      const result = await repo.update('tenant-1', 'source-1', new Date('2020-01-01'), { name: 'x' });

      expect(result).toBe('conflict');
    });

    it('applies only the patched fields, scoped by tenantId + ifMatch, and returns the fresh record', async () => {
      const prisma = makePrisma();
      prisma.db.knowledgeSource.findFirst
        .mockResolvedValueOnce(makeRow())
        .mockResolvedValueOnce(makeRow({ status: 'ready' }));
      prisma.db.knowledgeSource.updateMany.mockResolvedValue({ count: 1 });
      const repo = new PrismaKnowledgeSourceRepository(prisma as never);

      const ifMatch = new Date('2026-01-01T00:00:00.000Z');
      const result = await repo.update('tenant-1', 'source-1', ifMatch, { status: 'ready', errorMessage: null });

      expect(prisma.db.knowledgeSource.updateMany).toHaveBeenCalledWith({
        where: { id: 'source-1', tenantId: 'tenant-1', updatedAt: ifMatch },
        data: { status: 'ready', errorMessage: null },
      });
      expect(result).not.toBe('conflict');
      expect(result).not.toBe('missing');
      expect((result as { status: string }).status).toBe('ready');
    });

    it('allows patching errorMessage/lastIndexedAt back to null explicitly', async () => {
      const prisma = makePrisma();
      prisma.db.knowledgeSource.findFirst.mockResolvedValue(makeRow());
      prisma.db.knowledgeSource.updateMany.mockResolvedValue({ count: 1 });
      const repo = new PrismaKnowledgeSourceRepository(prisma as never);

      await repo.update('tenant-1', 'source-1', new Date(), { errorMessage: null, lastIndexedAt: null });

      expect(prisma.db.knowledgeSource.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { errorMessage: null, lastIndexedAt: null } }),
      );
    });
  });

  describe('delete', () => {
    it('returns true when a row was deleted', async () => {
      const prisma = makePrisma();
      prisma.db.knowledgeSource.deleteMany.mockResolvedValue({ count: 1 });
      const repo = new PrismaKnowledgeSourceRepository(prisma as never);
      expect(await repo.delete('tenant-1', 'source-1')).toBe(true);
      expect(prisma.db.knowledgeSource.deleteMany).toHaveBeenCalledWith({ where: { id: 'source-1', tenantId: 'tenant-1' } });
    });

    it('returns false when no row matched', async () => {
      const prisma = makePrisma();
      prisma.db.knowledgeSource.deleteMany.mockResolvedValue({ count: 0 });
      const repo = new PrismaKnowledgeSourceRepository(prisma as never);
      expect(await repo.delete('tenant-1', 'source-1')).toBe(false);
    });
  });
});
