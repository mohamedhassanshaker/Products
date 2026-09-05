import { PrismaAdminUserRepository } from './prisma-admin-user.repository';

function makePrismaFake() {
  const adminUser = { findUnique: jest.fn(), count: jest.fn(), create: jest.fn() };
  const executeRaw = jest.fn().mockResolvedValue(undefined);
  return {
    db: { adminUser },
    adminUser,
    withBypass: jest.fn((fn: () => unknown) => fn()),
    // Fakes PrismaService#transaction: runs fn against a tx object exposing
    // the same adminUser delegate plus a tagged-template $executeRaw, so the
    // advisory-lock statement in createFirstOperator can be asserted on.
    transaction: jest.fn((fn: (tx: unknown) => unknown) =>
      fn({ adminUser, $executeRaw: executeRaw }),
    ),
    executeRaw,
  };
}

const row = {
  id: 'admin-1',
  email: 'a@b.com',
  passwordHash: 'hash',
  roles: ['admin'],
  disabled: false,
  memberships: [{ tenantId: 'tenant-1' }],
};

describe('PrismaAdminUserRepository', () => {
  let prisma: ReturnType<typeof makePrismaFake>;
  let repo: PrismaAdminUserRepository;

  beforeEach(() => {
    prisma = makePrismaFake();
    repo = new PrismaAdminUserRepository(prisma as never);
  });

  it('findByEmail maps memberships to tenantIds', async () => {
    prisma.adminUser.findUnique.mockResolvedValue(row);
    const identity = await repo.findByEmail('a@b.com');
    expect(identity?.tenantIds).toEqual(['tenant-1']);
  });

  it('findByEmail returns null when not found', async () => {
    prisma.adminUser.findUnique.mockResolvedValue(null);
    expect(await repo.findByEmail('missing@b.com')).toBeNull();
  });

  it('findById returns the identity', async () => {
    prisma.adminUser.findUnique.mockResolvedValue(row);
    expect((await repo.findById('admin-1'))?.id).toBe('admin-1');
  });

  it('findById returns null when not found', async () => {
    prisma.adminUser.findUnique.mockResolvedValue(null);
    expect(await repo.findById('missing')).toBeNull();
  });

  it('countOperators counts users with the operator role', async () => {
    prisma.adminUser.count.mockResolvedValue(1);
    expect(await repo.countOperators()).toBe(1);
    expect(prisma.adminUser.count).toHaveBeenCalledWith({ where: { roles: { has: 'operator' } } });
  });

  it('create writes memberships and returns the identity under bypass', async () => {
    prisma.adminUser.create.mockResolvedValue(row);
    const identity = await repo.create({
      email: 'a@b.com',
      passwordHash: 'hash',
      roles: ['admin'],
      tenantIds: ['tenant-1'],
    });
    expect(identity.tenantIds).toEqual(['tenant-1']);
    expect(prisma.withBypass).toHaveBeenCalled();
  });

  it('emailExists returns true/false', async () => {
    prisma.adminUser.findUnique.mockResolvedValueOnce({ id: 'admin-1' });
    expect(await repo.emailExists('a@b.com')).toBe(true);
    prisma.adminUser.findUnique.mockResolvedValueOnce(null);
    expect(await repo.emailExists('missing@b.com')).toBe(false);
  });

  describe('createFirstOperator (D-4 atomicity)', () => {
    it('acquires the advisory lock, then creates the operator when none exists', async () => {
      prisma.adminUser.count.mockResolvedValue(0);
      prisma.adminUser.create.mockResolvedValue({ ...row, roles: ['operator'], memberships: [] });
      const identity = await repo.createFirstOperator({ email: 'a@b.com', passwordHash: 'hash' });
      expect(prisma.transaction).toHaveBeenCalled();
      expect(prisma.executeRaw).toHaveBeenCalled();
      expect(identity?.roles).toEqual(['operator']);
      expect(prisma.adminUser.create).toHaveBeenCalledWith({
        data: { email: 'a@b.com', passwordHash: 'hash', roles: ['operator'] },
        include: { memberships: true },
      });
    });

    it('returns null instead of creating a second operator when one already exists', async () => {
      prisma.adminUser.count.mockResolvedValue(1);
      const identity = await repo.createFirstOperator({ email: 'a@b.com', passwordHash: 'hash' });
      expect(identity).toBeNull();
      expect(prisma.adminUser.create).not.toHaveBeenCalled();
    });
  });
});
