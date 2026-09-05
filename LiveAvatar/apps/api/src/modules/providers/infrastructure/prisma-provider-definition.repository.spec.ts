import { PrismaProviderDefinitionRepository } from './prisma-provider-definition.repository';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    key: 'openai',
    category: 'llm',
    displayName: 'OpenAI',
    hosting: 'remote',
    interfaceName: 'ILLMProvider',
    requiresCredential: true,
    enabled: true,
    featureGaps: null,
    ...overrides,
  };
}

describe('PrismaProviderDefinitionRepository', () => {
  function makePrisma() {
    return {
      db: {
        providerDefinition: {
          findMany: jest.fn(),
          findUnique: jest.fn(),
          count: jest.fn(),
          update: jest.fn(),
        },
      },
    };
  }

  it('lists with optional category/enabled filters', async () => {
    const prisma = makePrisma();
    prisma.db.providerDefinition.findMany.mockResolvedValue([makeRow()]);
    const repo = new PrismaProviderDefinitionRepository(prisma as never);
    const result = await repo.list({ category: 'llm', enabled: true });
    expect(result).toHaveLength(1);
    expect(prisma.db.providerDefinition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { category: 'llm', enabled: true } }),
    );
  });

  it('lists with no filters', async () => {
    const prisma = makePrisma();
    prisma.db.providerDefinition.findMany.mockResolvedValue([]);
    const repo = new PrismaProviderDefinitionRepository(prisma as never);
    await repo.list({});
    expect(prisma.db.providerDefinition.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('findByKey returns null for an unknown key', async () => {
    const prisma = makePrisma();
    prisma.db.providerDefinition.findUnique.mockResolvedValue(null);
    const repo = new PrismaProviderDefinitionRepository(prisma as never);
    expect(await repo.findByKey('nope')).toBeNull();
  });

  it('findByKey maps a found row', async () => {
    const prisma = makePrisma();
    prisma.db.providerDefinition.findUnique.mockResolvedValue(makeRow());
    const repo = new PrismaProviderDefinitionRepository(prisma as never);
    const result = await repo.findByKey('openai');
    expect(result).toMatchObject({ key: 'openai' });
  });

  it('countEnabledInCategory delegates to prisma count', async () => {
    const prisma = makePrisma();
    prisma.db.providerDefinition.count.mockResolvedValue(3);
    const repo = new PrismaProviderDefinitionRepository(prisma as never);
    expect(await repo.countEnabledInCategory('llm')).toBe(3);
  });

  it('setEnabled updates and returns the record', async () => {
    const prisma = makePrisma();
    prisma.db.providerDefinition.update.mockResolvedValue(makeRow({ enabled: false }));
    const repo = new PrismaProviderDefinitionRepository(prisma as never);
    const result = await repo.setEnabled('openai', false);
    expect(result).toMatchObject({ enabled: false });
  });

  it('setEnabled returns null when the update throws (unknown key)', async () => {
    const prisma = makePrisma();
    prisma.db.providerDefinition.update.mockRejectedValue(new Error('not found'));
    const repo = new PrismaProviderDefinitionRepository(prisma as never);
    expect(await repo.setEnabled('nope', false)).toBeNull();
  });
});
