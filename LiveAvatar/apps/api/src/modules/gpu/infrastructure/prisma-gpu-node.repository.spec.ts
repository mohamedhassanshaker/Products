import { PrismaGpuNodeRepository } from './prisma-gpu-node.repository';

describe('PrismaGpuNodeRepository', () => {
  function makePrisma() {
    return { db: { gpuNodeHeartbeat: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) } } };
  }

  it('recordHeartbeat writes a new row', async () => {
    const prisma = makePrisma();
    const repo = new PrismaGpuNodeRepository(prisma as never);
    const reportedAt = new Date();
    await repo.recordHeartbeat({ hostname: 'gpu-1', role: 'stt', gpuUtilPct: 40, memUtilPct: 30, healthy: true, tenantId: null, reportedAt });
    expect(prisma.db.gpuNodeHeartbeat.create).toHaveBeenCalledWith({
      data: { hostname: 'gpu-1', role: 'stt', gpuUtilPct: 40, memUtilPct: 30, healthy: true, tenantId: null, reportedAt },
    });
  });

  it('listLatestPerHost queries with distinct hostname + filters, converting Decimal fields to number', async () => {
    const prisma = makePrisma();
    prisma.db.gpuNodeHeartbeat.findMany.mockResolvedValue([
      { hostname: 'gpu-1', role: 'stt', gpuUtilPct: { toString: () => '40' }, memUtilPct: { toString: () => '30' }, healthy: true, autoscalerNote: 'not_configured', reportedAt: new Date() },
    ]);
    const repo = new PrismaGpuNodeRepository(prisma as never);
    const rows = await repo.listLatestPerHost({ role: 'stt', tenantId: 't1' });
    expect(prisma.db.gpuNodeHeartbeat.findMany).toHaveBeenCalledWith({
      where: { role: 'stt', tenantId: 't1' },
      orderBy: [{ hostname: 'asc' }, { reportedAt: 'desc' }],
      distinct: ['hostname'],
    });
    expect(rows[0].gpuUtilPct).toBe(40);
  });
});
