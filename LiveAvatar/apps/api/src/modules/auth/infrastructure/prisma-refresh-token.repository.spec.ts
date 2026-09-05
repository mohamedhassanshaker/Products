import { PrismaRefreshTokenRepository } from './prisma-refresh-token.repository';

function makePrismaFake() {
  const refreshToken = { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() };
  return { db: { refreshToken }, refreshToken };
}

describe('PrismaRefreshTokenRepository', () => {
  let prisma: ReturnType<typeof makePrismaFake>;
  let repo: PrismaRefreshTokenRepository;

  beforeEach(() => {
    prisma = makePrismaFake();
    repo = new PrismaRefreshTokenRepository(prisma as never);
  });

  it('create writes the row', async () => {
    const input = {
      adminUserId: 'admin-1',
      tokenHash: 'hash',
      familyId: 'family-1',
      expiresAt: new Date(),
    };
    await repo.create(input);
    expect(prisma.refreshToken.create).toHaveBeenCalledWith({ data: input });
  });

  it('findByHash returns the row', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({ id: '1' });
    expect(await repo.findByHash('hash')).toEqual({ id: '1' });
  });

  it('revokeFamily marks all unrevoked rows in the family', async () => {
    await repo.revokeFamily('family-1');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { familyId: 'family-1', revokedAt: null } }),
    );
  });

  it('revokeByHash marks the single row', async () => {
    await repo.revokeByHash('hash');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: 'hash', revokedAt: null } }),
    );
  });
});
