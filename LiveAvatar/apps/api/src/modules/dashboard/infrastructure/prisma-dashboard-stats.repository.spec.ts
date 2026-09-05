import { PrismaDashboardStatsRepository } from './prisma-dashboard-stats.repository';

describe('PrismaDashboardStatsRepository', () => {
  function makePrisma() {
    return {
      db: { tenant: { count: jest.fn().mockResolvedValue(0) }, session: { count: jest.fn().mockResolvedValue(0) } },
      withBypass: jest.fn(async (fn: () => Promise<unknown>) => fn()),
    };
  }

  it('countActiveTenants filters by status + optional tenantIds', async () => {
    const prisma = makePrisma();
    const repo = new PrismaDashboardStatsRepository(prisma as never);
    await repo.countActiveTenants(['t1']);
    expect(prisma.db.tenant.count).toHaveBeenCalledWith({ where: { status: 'active', id: { in: ['t1'] } } });
  });

  it('countActiveTenants omits the id filter when tenantIds is null', async () => {
    const prisma = makePrisma();
    const repo = new PrismaDashboardStatsRepository(prisma as never);
    await repo.countActiveTenants(null);
    expect(prisma.db.tenant.count).toHaveBeenCalledWith({ where: { status: 'active' } });
  });

  it('countSessionsByOutcome returns zeros without querying for an explicit empty tenant scope', async () => {
    const prisma = makePrisma();
    const repo = new PrismaDashboardStatsRepository(prisma as never);
    const result = await repo.countSessionsByOutcome([], new Date(), new Date());
    expect(result).toEqual({ started: 0, ended: 0, failed: 0, abandoned: 0 });
    expect(prisma.db.session.count).not.toHaveBeenCalled();
  });

  it('countSessionsByOutcome issues 4 scoped counts', async () => {
    const prisma = makePrisma();
    prisma.db.session.count.mockResolvedValueOnce(10).mockResolvedValueOnce(6).mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    const repo = new PrismaDashboardStatsRepository(prisma as never);
    const from = new Date();
    const to = new Date();
    const result = await repo.countSessionsByOutcome(['t1'], from, to);
    expect(result).toEqual({ started: 10, ended: 6, failed: 2, abandoned: 1 });
    expect(prisma.db.session.count).toHaveBeenCalledTimes(4);
  });
});
