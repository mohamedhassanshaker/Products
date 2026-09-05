import { PrismaProviderCredentialRepository } from './prisma-provider-credential.repository';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cred-1',
    tenantId: 'tenant-1',
    providerKey: 'openai',
    displayLabel: 'default',
    endpointUrl: 'https://api.openai.com',
    credentialRef: 'secrets/openai',
    extra: {},
    lastProbeStatus: 'unknown',
    lastProbeAt: null,
    lastProbeError: null,
    createdAt: new Date(),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('PrismaProviderCredentialRepository', () => {
  function makePrisma() {
    return {
      db: {
        providerCredential: {
          create: jest.fn(),
          findFirst: jest.fn(),
          findMany: jest.fn(),
          updateMany: jest.fn(),
          deleteMany: jest.fn(),
        },
      },
      withBypass: jest.fn(async (fn: () => Promise<unknown>) => fn()),
    };
  }

  it('creates a credential', async () => {
    const prisma = makePrisma();
    prisma.db.providerCredential.create.mockResolvedValue(makeRow());
    const repo = new PrismaProviderCredentialRepository(prisma as never);
    const result = await repo.create({
      tenantId: 'tenant-1',
      providerKey: 'openai',
      displayLabel: 'default',
      endpointUrl: 'https://api.openai.com',
      credentialRef: 'secrets/openai',
      extra: {},
    });
    expect(result.id).toBe('cred-1');
  });

  it('findById returns null when not found', async () => {
    const prisma = makePrisma();
    prisma.db.providerCredential.findFirst.mockResolvedValue(null);
    const repo = new PrismaProviderCredentialRepository(prisma as never);
    expect(await repo.findById('tenant-1', 'cred-1')).toBeNull();
  });

  it('findByLabel scopes by tenant/provider/label', async () => {
    const prisma = makePrisma();
    prisma.db.providerCredential.findFirst.mockResolvedValue(makeRow());
    const repo = new PrismaProviderCredentialRepository(prisma as never);
    await repo.findByLabel('tenant-1', 'openai', 'default');
    expect(prisma.db.providerCredential.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', providerKey: 'openai', displayLabel: 'default' },
    });
  });

  it('list applies category and provider_key filters', async () => {
    const prisma = makePrisma();
    prisma.db.providerCredential.findMany.mockResolvedValue([makeRow()]);
    const repo = new PrismaProviderCredentialRepository(prisma as never);
    const result = await repo.list('tenant-1', { category: 'llm', providerKey: 'openai' });
    expect(result).toHaveLength(1);
    expect(prisma.db.providerCredential.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-1', providerKey: 'openai', definition: { category: 'llm' } },
      }),
    );
  });

  it('listAllActive bypasses the tenant guard', async () => {
    const prisma = makePrisma();
    prisma.db.providerCredential.findMany.mockResolvedValue([makeRow()]);
    const repo = new PrismaProviderCredentialRepository(prisma as never);
    const result = await repo.listAllActive();
    expect(prisma.withBypass).toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it('update returns missing when the row does not exist', async () => {
    const prisma = makePrisma();
    prisma.db.providerCredential.findFirst.mockResolvedValue(null);
    const repo = new PrismaProviderCredentialRepository(prisma as never);
    expect(await repo.update('tenant-1', 'cred-1', {}, new Date())).toBe('missing');
  });

  it('update returns conflict on a stale If-Match', async () => {
    const prisma = makePrisma();
    prisma.db.providerCredential.findFirst.mockResolvedValueOnce(makeRow());
    prisma.db.providerCredential.updateMany.mockResolvedValue({ count: 0 });
    const repo = new PrismaProviderCredentialRepository(prisma as never);
    expect(await repo.update('tenant-1', 'cred-1', { displayLabel: 'x' }, new Date())).toBe('conflict');
  });

  it('update succeeds and re-reads the row', async () => {
    const prisma = makePrisma();
    prisma.db.providerCredential.findFirst
      .mockResolvedValueOnce(makeRow())
      .mockResolvedValueOnce(makeRow({ displayLabel: 'lab' }));
    prisma.db.providerCredential.updateMany.mockResolvedValue({ count: 1 });
    const repo = new PrismaProviderCredentialRepository(prisma as never);
    const result = await repo.update(
      'tenant-1',
      'cred-1',
      { displayLabel: 'lab', endpointUrl: 'https://x.com', credentialRef: null, extra: { a: 1 } },
      new Date('2026-01-01T00:00:00.000Z'),
    );
    expect(result).toMatchObject({ displayLabel: 'lab' });
  });

  it('delete reports whether a row was removed', async () => {
    const prisma = makePrisma();
    prisma.db.providerCredential.deleteMany.mockResolvedValue({ count: 1 });
    const repo = new PrismaProviderCredentialRepository(prisma as never);
    expect(await repo.delete('tenant-1', 'cred-1')).toBe(true);
  });

  it('recordProbeResult writes the latest probe outcome', async () => {
    const prisma = makePrisma();
    prisma.db.providerCredential.updateMany.mockResolvedValue({ count: 1 });
    const repo = new PrismaProviderCredentialRepository(prisma as never);
    await repo.recordProbeResult('tenant-1', 'cred-1', { status: 'healthy', error: null, probedAt: new Date() });
    expect(prisma.db.providerCredential.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastProbeStatus: 'healthy' }) }),
    );
  });

  it('toRecord defaults a null extra JSON blob to an empty object', async () => {
    const prisma = makePrisma();
    prisma.db.providerCredential.findFirst.mockResolvedValue(makeRow({ extra: null }));
    const repo = new PrismaProviderCredentialRepository(prisma as never);
    const result = await repo.findById('tenant-1', 'cred-1');
    expect(result?.extra).toEqual({});
  });
});
