import { PrismaAlertRepository } from './prisma-alert.repository';

describe('PrismaAlertRepository', () => {
  function makePrisma() {
    return {
      db: {
        alertEvent: {
          create: jest.fn().mockResolvedValue({}),
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
      },
      withBypass: jest.fn(async (fn: () => Promise<unknown>) => fn()),
    };
  }

  it('creates an AlertEvent row', async () => {
    const prisma = makePrisma();
    const repo = new PrismaAlertRepository(prisma as never);

    await repo.create({ tenantId: 't1', type: 'llm_failover', message: 'Failover to anthropic.' });

    expect(prisma.db.alertEvent.create).toHaveBeenCalledWith({
      data: { tenantId: 't1', type: 'llm_failover', message: 'Failover to anthropic.' },
    });
    expect(prisma.withBypass).toHaveBeenCalledTimes(1);
  });

  it('lists alerts scoped by tenant/type/range with pagination (FR-ALERT-4)', async () => {
    const prisma = makePrisma();
    const createdAt = new Date();
    prisma.db.alertEvent.findMany.mockResolvedValue([{ id: 'a1', type: 'gpu_unhealthy', message: 'Node down.', createdAt }]);
    prisma.db.alertEvent.count.mockResolvedValue(1);
    const repo = new PrismaAlertRepository(prisma as never);

    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-08T00:00:00.000Z');
    const result = await repo.list({ tenantId: 't1', type: 'gpu_unhealthy', from, to, page: 1, pageSize: 25 });

    expect(prisma.db.alertEvent.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', type: 'gpu_unhealthy', createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 25,
    });
    expect(result).toEqual({ items: [{ id: 'a1', type: 'gpu_unhealthy', message: 'Node down.', createdAt }], total: 1 });
  });

  it('lists across all tenants when tenantId is omitted (operator view)', async () => {
    const prisma = makePrisma();
    const repo = new PrismaAlertRepository(prisma as never);
    const from = new Date();
    const to = new Date();
    await repo.list({ from, to, page: 1, pageSize: 25 });
    expect(prisma.db.alertEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { createdAt: { gte: from, lte: to } } }),
    );
  });
});
