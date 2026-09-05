import { PrismaInviteRepository } from './prisma-invite.repository';

function makePrismaFake() {
  const adminInvite = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  return { db: { adminInvite }, adminInvite };
}

const row = {
  id: 'invite-1',
  email: 'a@b.com',
  roles: ['admin'],
  tokenHash: 'hash',
  expiresAt: new Date('2026-02-01T00:00:00.000Z'),
  acceptedAt: null,
  createdBy: 'admin-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  tenants: [{ tenantId: 'tenant-1' }],
};

describe('PrismaInviteRepository', () => {
  let prisma: ReturnType<typeof makePrismaFake>;
  let repo: PrismaInviteRepository;

  beforeEach(() => {
    prisma = makePrismaFake();
    repo = new PrismaInviteRepository(prisma as never);
  });

  it('create maps tenantIds into the tenants relation and returns the record', async () => {
    prisma.adminInvite.create.mockResolvedValue(row);
    const result = await repo.create({
      email: 'a@b.com',
      roles: ['admin'],
      tokenHash: 'hash',
      expiresAt: row.expiresAt,
      createdBy: 'admin-1',
      tenantIds: ['tenant-1'],
    });
    expect(result.tenantIds).toEqual(['tenant-1']);
  });

  it('findById returns null when missing', async () => {
    prisma.adminInvite.findUnique.mockResolvedValue(null);
    expect(await repo.findById('missing')).toBeNull();
  });

  it('findByTokenHash returns the mapped record', async () => {
    prisma.adminInvite.findUnique.mockResolvedValue(row);
    expect((await repo.findByTokenHash('hash'))?.id).toBe('invite-1');
  });

  it('list applies pendingOnly filter and paginates', async () => {
    prisma.adminInvite.findMany.mockResolvedValue([row]);
    prisma.adminInvite.count.mockResolvedValue(1);
    const result = await repo.list({ page: 1, pageSize: 25, pendingOnly: true });
    expect(result.total).toBe(1);
    expect(prisma.adminInvite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { acceptedAt: null } }),
    );
  });

  it('list without pendingOnly uses an unfiltered where', async () => {
    prisma.adminInvite.findMany.mockResolvedValue([]);
    prisma.adminInvite.count.mockResolvedValue(0);
    await repo.list({ page: 1, pageSize: 25 });
    expect(prisma.adminInvite.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('markAccepted sets acceptedAt', async () => {
    await repo.markAccepted('invite-1');
    expect(prisma.adminInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'invite-1' } }),
    );
  });

  it('delete removes the row', async () => {
    await repo.delete('invite-1');
    expect(prisma.adminInvite.delete).toHaveBeenCalledWith({ where: { id: 'invite-1' } });
  });
});
