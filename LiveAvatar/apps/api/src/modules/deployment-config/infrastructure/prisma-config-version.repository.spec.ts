import { PrismaConfigVersionRepository } from './prisma-config-version.repository';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'version-1',
    tenantId: 'tenant-1',
    versionNumber: 1,
    yamlText: 'version: 1',
    status: 'published',
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdBy: 'admin-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    rolledBackFrom: null,
    ...overrides,
  };
}

describe('PrismaConfigVersionRepository', () => {
  function makePrisma() {
    return {
      db: {
        configVersion: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      },
    };
  }

  describe('listByTenantId', () => {
    it('lists every version for the tenant, newest first', async () => {
      const prisma = makePrisma();
      prisma.db.configVersion.findMany.mockResolvedValue([makeRow({ versionNumber: 2 }), makeRow({ versionNumber: 1 })]);
      const repo = new PrismaConfigVersionRepository(prisma as never);

      const result = await repo.listByTenantId('tenant-1');

      expect(prisma.db.configVersion.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        orderBy: { versionNumber: 'desc' },
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 'version-1', tenantId: 'tenant-1', versionNumber: 2 });
    });

    it('returns an empty array for a tenant with no published versions', async () => {
      const prisma = makePrisma();
      const repo = new PrismaConfigVersionRepository(prisma as never);
      expect(await repo.listByTenantId('tenant-1')).toEqual([]);
    });

    it('maps every field of the row, including rolledBackFrom', async () => {
      const prisma = makePrisma();
      prisma.db.configVersion.findMany.mockResolvedValue([makeRow({ status: 'rolled_back', rolledBackFrom: 'version-0' })]);
      const repo = new PrismaConfigVersionRepository(prisma as never);
      const [result] = await repo.listByTenantId('tenant-1');
      expect(result).toEqual({
        id: 'version-1',
        tenantId: 'tenant-1',
        versionNumber: 1,
        yamlText: 'version: 1',
        status: 'rolled_back',
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        createdBy: 'admin-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        rolledBackFrom: 'version-0',
      });
    });
  });

  describe('findByTenantAndVersion', () => {
    it('returns null when no row matches', async () => {
      const prisma = makePrisma();
      const repo = new PrismaConfigVersionRepository(prisma as never);
      expect(await repo.findByTenantAndVersion('tenant-1', 99)).toBeNull();
    });

    it('finds the row scoped to both tenantId and versionNumber', async () => {
      const prisma = makePrisma();
      prisma.db.configVersion.findFirst.mockResolvedValue(makeRow({ versionNumber: 3 }));
      const repo = new PrismaConfigVersionRepository(prisma as never);

      const result = await repo.findByTenantAndVersion('tenant-1', 3);

      expect(prisma.db.configVersion.findFirst).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1', versionNumber: 3 } });
      expect(result).toMatchObject({ versionNumber: 3 });
    });
  });

  describe('markRolledBack', () => {
    it('sets status to rolled_back, scoped to tenant + versionNumber', async () => {
      const prisma = makePrisma();
      const repo = new PrismaConfigVersionRepository(prisma as never);

      await repo.markRolledBack('tenant-1', 2);

      expect(prisma.db.configVersion.updateMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', versionNumber: 2 },
        data: { status: 'rolled_back' },
      });
    });

    it('never touches yamlText (append-only — this repository only reads or flips status)', async () => {
      const prisma = makePrisma();
      const repo = new PrismaConfigVersionRepository(prisma as never);
      await repo.markRolledBack('tenant-1', 2);
      const dataArg = (prisma.db.configVersion.updateMany.mock.calls[0][0] as { data: Record<string, unknown> }).data;
      expect(dataArg).not.toHaveProperty('yamlText');
      expect(prisma.db.configVersion.findFirst).not.toHaveBeenCalled();
    });
  });
});
