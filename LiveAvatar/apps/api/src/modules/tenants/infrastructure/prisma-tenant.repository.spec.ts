import { PrismaTenantRepository } from './prisma-tenant.repository';

/** Builds a minimal PrismaService fake exposing only what the repository calls. */
function makePrismaFake() {
  const tenant = {
    create: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  };
  return { db: { tenant }, tenant };
}

const baseRow = {
  id: 'tenant-1',
  name: 'Acme',
  slug: 'acme',
  status: 'active' as const,
  roomNamespace: 'acme',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  config: null as { status: 'draft' | 'published'; llmProvider: string | null; ttsProvider: string | null; avatarProvider: string | null } | null,
};

describe('PrismaTenantRepository', () => {
  let prisma: ReturnType<typeof makePrismaFake>;
  let repo: PrismaTenantRepository;

  beforeEach(() => {
    prisma = makePrismaFake();
    repo = new PrismaTenantRepository(prisma as never);
  });

  it('creates a tenant with room_namespace = slug', async () => {
    prisma.tenant.create.mockResolvedValue(baseRow);
    const result = await repo.create({ name: 'Acme', slug: 'acme', status: 'active' });
    expect(result.roomNamespace).toBe('acme');
    expect(prisma.tenant.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ roomNamespace: 'acme' }) }),
    );
  });

  it('summarizes an unconfigured deployment as "Not configured"', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      ...baseRow,
      config: { status: 'draft', llmProvider: null, ttsProvider: null, avatarProvider: null },
    });
    const result = await repo.findById('tenant-1');
    expect(result?.providerStackSummary).toBe('Not configured');
  });

  it('summarizes a published deployment with its provider keys', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      ...baseRow,
      config: { status: 'published', llmProvider: 'openai', ttsProvider: 'fish-speech', avatarProvider: 'bithuman' },
    });
    const result = await repo.findById('tenant-1');
    expect(result?.providerStackSummary).toBe('Published — openai, fish-speech, bithuman');
  });

  it('findById returns null for a missing row', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    expect(await repo.findById('missing')).toBeNull();
  });

  it('findBySlug returns null for a missing row', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    expect(await repo.findBySlug('missing')).toBeNull();
  });

  it('count delegates to Prisma', async () => {
    prisma.tenant.count.mockResolvedValue(3);
    expect(await repo.count()).toBe(3);
  });

  it('list applies q, status, and tenantIds scoping and paginates', async () => {
    prisma.tenant.findMany.mockResolvedValue([baseRow]);
    prisma.tenant.count.mockResolvedValue(1);
    const result = await repo.list({
      q: 'Ac',
      status: 'active',
      page: 2,
      pageSize: 10,
      tenantIds: ['tenant-1'],
    });
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(prisma.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'active',
          name: { contains: 'Ac', mode: 'insensitive' },
          id: { in: ['tenant-1'] },
        }),
        skip: 10,
        take: 10,
      }),
    );
  });

  it('list omits the id filter for an operator (tenantIds: null)', async () => {
    prisma.tenant.findMany.mockResolvedValue([]);
    prisma.tenant.count.mockResolvedValue(0);
    await repo.list({ page: 1, pageSize: 25, tenantIds: null });
    const call = prisma.tenant.findMany.mock.calls[0][0];
    expect(call.where.id).toBeUndefined();
  });

  it('updateName returns "missing" when the tenant does not exist', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    const result = await repo.updateName('missing', 'New', new Date());
    expect(result).toBe('missing');
  });

  it('updateName returns "conflict" when the optimistic lock misses', async () => {
    prisma.tenant.findUnique.mockResolvedValue(baseRow);
    prisma.tenant.updateMany.mockResolvedValue({ count: 0 });
    const result = await repo.updateName('tenant-1', 'New', new Date());
    expect(result).toBe('conflict');
  });

  it('updateName returns the updated record on success', async () => {
    prisma.tenant.findUnique
      .mockResolvedValueOnce(baseRow)
      .mockResolvedValueOnce({ ...baseRow, name: 'New' });
    prisma.tenant.updateMany.mockResolvedValue({ count: 1 });
    const result = await repo.updateName('tenant-1', 'New', baseRow.updatedAt);
    expect(result).not.toBe('conflict');
    expect((result as { name: string }).name).toBe('New');
  });

  it('updateStatus returns the updated record', async () => {
    prisma.tenant.update.mockResolvedValue({ ...baseRow, status: 'paused' });
    const result = await repo.updateStatus('tenant-1', 'paused');
    expect(result?.status).toBe('paused');
  });

  it('updateStatus returns null when the update throws (row vanished)', async () => {
    prisma.tenant.update.mockRejectedValue(new Error('not found'));
    const result = await repo.updateStatus('missing', 'paused');
    expect(result).toBeNull();
  });
});
