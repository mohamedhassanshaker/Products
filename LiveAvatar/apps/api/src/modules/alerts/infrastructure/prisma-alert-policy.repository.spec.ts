import { PrismaAlertPolicyRepository } from './prisma-alert-policy.repository';

function makeRow(overrides: Record<string, unknown> = {}) {
  return { tenantId: 't1', retryMaxAttempts: 3, retryBackoffMs: [200, 400, 800], degradedModeMessage: 'msg', updatedAt: new Date('2026-01-01T00:00:00.000Z'), ...overrides };
}

describe('PrismaAlertPolicyRepository', () => {
  function makePrisma() {
    return { db: { alertPolicy: { findUnique: jest.fn(), updateMany: jest.fn() } } };
  }

  it('findByTenantId returns null when absent', async () => {
    const prisma = makePrisma();
    prisma.db.alertPolicy.findUnique.mockResolvedValue(null);
    const repo = new PrismaAlertPolicyRepository(prisma as never);
    expect(await repo.findByTenantId('t1')).toBeNull();
  });

  it('findByTenantId maps a found row', async () => {
    const prisma = makePrisma();
    prisma.db.alertPolicy.findUnique.mockResolvedValue(makeRow());
    const repo = new PrismaAlertPolicyRepository(prisma as never);
    const result = await repo.findByTenantId('t1');
    expect(result?.retryMaxAttempts).toBe(3);
  });

  it('update returns missing when the row does not exist', async () => {
    const prisma = makePrisma();
    prisma.db.alertPolicy.findUnique.mockResolvedValue(null);
    const repo = new PrismaAlertPolicyRepository(prisma as never);
    expect(await repo.update('t1', { retryMaxAttempts: 3, retryBackoffMs: [1, 2, 3], degradedModeMessage: 'm' }, new Date())).toBe('missing');
  });

  it('update returns conflict on a zero-row update', async () => {
    const prisma = makePrisma();
    prisma.db.alertPolicy.findUnique.mockResolvedValue(makeRow());
    prisma.db.alertPolicy.updateMany.mockResolvedValue({ count: 0 });
    const repo = new PrismaAlertPolicyRepository(prisma as never);
    expect(await repo.update('t1', { retryMaxAttempts: 3, retryBackoffMs: [1, 2, 3], degradedModeMessage: 'm' }, new Date())).toBe('conflict');
  });

  it('update returns the fresh record on success', async () => {
    const prisma = makePrisma();
    prisma.db.alertPolicy.findUnique.mockResolvedValueOnce(makeRow()).mockResolvedValueOnce(makeRow({ degradedModeMessage: 'new' }));
    prisma.db.alertPolicy.updateMany.mockResolvedValue({ count: 1 });
    const repo = new PrismaAlertPolicyRepository(prisma as never);
    const result = await repo.update('t1', { retryMaxAttempts: 3, retryBackoffMs: [1, 2, 3], degradedModeMessage: 'new' }, new Date());
    expect((result as { degradedModeMessage: string }).degradedModeMessage).toBe('new');
  });
});
