import { PrismaToolDefinitionRepository } from './prisma-tool-definition.repository';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tool-1',
    tenantId: 'tenant-1',
    apiRef: 'weather',
    name: 'Weather lookup',
    description: null,
    method: 'GET',
    url: 'https://internal.example.com/weather',
    credentialRef: 'secrets/weather',
    requiresCredential: true,
    argsSchema: {},
    enabled: true,
    consequential: false,
    lane: 'foreground',
    perSessionCap: null,
    perTurnCap: null,
    timeoutMs: 10000,
    createdAt: new Date(),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('PrismaToolDefinitionRepository', () => {
  function makePrisma() {
    return {
      db: {
        toolDefinition: {
          findMany: jest.fn(),
          findFirst: jest.fn(),
          create: jest.fn(),
          updateMany: jest.fn(),
          deleteMany: jest.fn(),
        },
      },
    };
  }

  describe('listByTenant', () => {
    it('lists every tool definition for a tenant, enabled or not', async () => {
      const prisma = makePrisma();
      prisma.db.toolDefinition.findMany.mockResolvedValue([makeRow(), makeRow({ id: 'tool-2', enabled: false })]);
      const repo = new PrismaToolDefinitionRepository(prisma as never);

      const result = await repo.listByTenant('tenant-1');

      expect(prisma.db.toolDefinition.findMany).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1' } });
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({ id: 'tool-1', apiRef: 'weather', method: 'GET', enabled: true }),
      );
    });

    it('maps a null argsSchema to an empty object', async () => {
      const prisma = makePrisma();
      prisma.db.toolDefinition.findMany.mockResolvedValue([makeRow({ argsSchema: null })]);
      const repo = new PrismaToolDefinitionRepository(prisma as never);

      const [result] = await repo.listByTenant('tenant-1');

      expect(result.argsSchema).toEqual({});
    });
  });

  describe('listEnabledByApiRefs', () => {
    it('returns [] without querying when apiRefs is empty', async () => {
      const prisma = makePrisma();
      const repo = new PrismaToolDefinitionRepository(prisma as never);

      const result = await repo.listEnabledByApiRefs('tenant-1', []);

      expect(result).toEqual([]);
      expect(prisma.db.toolDefinition.findMany).not.toHaveBeenCalled();
    });

    it('filters by tenantId, enabled=true, and apiRef membership', async () => {
      const prisma = makePrisma();
      prisma.db.toolDefinition.findMany.mockResolvedValue([makeRow()]);
      const repo = new PrismaToolDefinitionRepository(prisma as never);

      const result = await repo.listEnabledByApiRefs('tenant-1', ['weather']);

      expect(prisma.db.toolDefinition.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', enabled: true, apiRef: { in: ['weather'] } },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('scopes the lookup by tenantId', async () => {
      const prisma = makePrisma();
      prisma.db.toolDefinition.findFirst.mockResolvedValue(makeRow());
      const repo = new PrismaToolDefinitionRepository(prisma as never);

      const result = await repo.findById('tenant-1', 'tool-1');

      expect(prisma.db.toolDefinition.findFirst).toHaveBeenCalledWith({ where: { id: 'tool-1', tenantId: 'tenant-1' } });
      expect(result?.id).toBe('tool-1');
    });

    it('returns null when not found', async () => {
      const prisma = makePrisma();
      prisma.db.toolDefinition.findFirst.mockResolvedValue(null);
      const repo = new PrismaToolDefinitionRepository(prisma as never);
      expect(await repo.findById('tenant-1', 'nope')).toBeNull();
    });
  });

  describe('findByApiRef', () => {
    it('scopes the lookup by tenantId + apiRef', async () => {
      const prisma = makePrisma();
      prisma.db.toolDefinition.findFirst.mockResolvedValue(makeRow());
      const repo = new PrismaToolDefinitionRepository(prisma as never);

      await repo.findByApiRef('tenant-1', 'weather');

      expect(prisma.db.toolDefinition.findFirst).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', apiRef: 'weather' },
      });
    });
  });

  describe('create', () => {
    it('persists every field', async () => {
      const prisma = makePrisma();
      prisma.db.toolDefinition.create.mockResolvedValue(makeRow());
      const repo = new PrismaToolDefinitionRepository(prisma as never);

      const input = {
        tenantId: 'tenant-1',
        apiRef: 'weather',
        name: 'Weather lookup',
        description: null,
        method: 'GET',
        url: 'https://internal.example.com/weather',
        credentialRef: 'secrets/weather',
        requiresCredential: true,
        argsSchema: {},
        enabled: true,
        consequential: false,
        autonomousUseAckText: null,
        lane: 'foreground' as const,
        perSessionCap: null,
        perTurnCap: null,
        timeoutMs: 10000,
      };
      await repo.create(input);

      expect(prisma.db.toolDefinition.create).toHaveBeenCalledWith({ data: input });
    });
  });

  describe('update', () => {
    it('returns "missing" when the row does not exist', async () => {
      const prisma = makePrisma();
      prisma.db.toolDefinition.findFirst.mockResolvedValue(null);
      const repo = new PrismaToolDefinitionRepository(prisma as never);

      const result = await repo.update('tenant-1', 'tool-1', { name: 'x' }, new Date());

      expect(result).toBe('missing');
      expect(prisma.db.toolDefinition.updateMany).not.toHaveBeenCalled();
    });

    it('returns "conflict" when updateMany matches zero rows', async () => {
      const prisma = makePrisma();
      prisma.db.toolDefinition.findFirst.mockResolvedValue(makeRow());
      prisma.db.toolDefinition.updateMany.mockResolvedValue({ count: 0 });
      const repo = new PrismaToolDefinitionRepository(prisma as never);

      const result = await repo.update('tenant-1', 'tool-1', { name: 'x' }, new Date('2020-01-01'));

      expect(result).toBe('conflict');
    });

    it('applies only the patched fields and returns the fresh record', async () => {
      const prisma = makePrisma();
      prisma.db.toolDefinition.findFirst.mockResolvedValueOnce(makeRow()).mockResolvedValueOnce(makeRow({ name: 'Renamed' }));
      prisma.db.toolDefinition.updateMany.mockResolvedValue({ count: 1 });
      const repo = new PrismaToolDefinitionRepository(prisma as never);

      const ifMatch = new Date('2026-01-01T00:00:00.000Z');
      const result = await repo.update('tenant-1', 'tool-1', { name: 'Renamed' }, ifMatch);

      expect(prisma.db.toolDefinition.updateMany).toHaveBeenCalledWith({
        where: { id: 'tool-1', tenantId: 'tenant-1', updatedAt: ifMatch },
        data: { name: 'Renamed' },
      });
      expect(result).not.toBe('conflict');
      expect(result).not.toBe('missing');
      expect((result as { name: string }).name).toBe('Renamed');
    });
  });

  describe('delete', () => {
    it('returns true when a row was deleted', async () => {
      const prisma = makePrisma();
      prisma.db.toolDefinition.deleteMany.mockResolvedValue({ count: 1 });
      const repo = new PrismaToolDefinitionRepository(prisma as never);
      expect(await repo.delete('tenant-1', 'tool-1')).toBe(true);
    });

    it('returns false when no row matched', async () => {
      const prisma = makePrisma();
      prisma.db.toolDefinition.deleteMany.mockResolvedValue({ count: 0 });
      const repo = new PrismaToolDefinitionRepository(prisma as never);
      expect(await repo.delete('tenant-1', 'tool-1')).toBe(false);
    });
  });
});
