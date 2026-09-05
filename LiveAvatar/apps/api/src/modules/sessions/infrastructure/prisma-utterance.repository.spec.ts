import { PrismaUtteranceRepository } from './prisma-utterance.repository';

describe('PrismaUtteranceRepository', () => {
  function makePrisma() {
    return {
      db: {
        transcriptUtterance: { upsert: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
        $queryRaw: jest.fn().mockResolvedValue([]),
        $executeRaw: jest.fn().mockResolvedValue(0),
      },
      withBypass: jest.fn(async (fn: () => Promise<unknown>) => fn()),
    };
  }

  it('upserts every item on the (sessionId, seq) unique index', async () => {
    const prisma = makePrisma();
    const repo = new PrismaUtteranceRepository(prisma as never);
    const startedAt = new Date('2026-01-01T00:00:00.000Z');

    await repo.upsertMany('s1', 't1', [{ seq: 1, role: 'user', text: 'hi', startedAt, endedAt: null }]);

    expect(prisma.db.transcriptUtterance.upsert).toHaveBeenCalledWith({
      where: { sessionId_seq: { sessionId: 's1', seq: 1 } },
      create: { sessionId: 's1', tenantId: 't1', seq: 1, role: 'user', text: 'hi', startedAt, endedAt: null },
      update: { role: 'user', text: 'hi', startedAt, endedAt: null },
    });
  });

  it('runs multiple items concurrently, all inside withBypass', async () => {
    const prisma = makePrisma();
    const repo = new PrismaUtteranceRepository(prisma as never);
    const startedAt = new Date();

    await repo.upsertMany('s1', 't1', [
      { seq: 1, role: 'user', text: 'a', startedAt, endedAt: null },
      { seq: 2, role: 'assistant', text: 'b', startedAt, endedAt: null },
    ]);

    expect(prisma.db.transcriptUtterance.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.withBypass).toHaveBeenCalledTimes(1);
  });

  it('no-ops on an empty batch without calling upsert', async () => {
    const prisma = makePrisma();
    const repo = new PrismaUtteranceRepository(prisma as never);
    await repo.upsertMany('s1', 't1', []);
    expect(prisma.db.transcriptUtterance.upsert).not.toHaveBeenCalled();
  });

  it('listBySession returns rows ordered by seq (FR-SESS-2)', async () => {
    const prisma = makePrisma();
    const startedAt = new Date();
    prisma.db.transcriptUtterance.findMany.mockResolvedValue([
      { seq: 0, role: 'user', text: 'hi', startedAt, endedAt: null },
    ]);
    const repo = new PrismaUtteranceRepository(prisma as never);
    const rows = await repo.listBySession('s1');
    expect(prisma.db.transcriptUtterance.findMany).toHaveBeenCalledWith({
      where: { sessionId: 's1' },
      orderBy: { seq: 'asc' },
    });
    expect(rows).toEqual([{ seq: 0, role: 'user', text: 'hi', startedAt, endedAt: null }]);
  });

  it('searchSessionIds scopes by tenant when given', async () => {
    const prisma = makePrisma();
    prisma.db.$queryRaw.mockResolvedValue([{ session_id: 's1' }, { session_id: 's2' }]);
    const repo = new PrismaUtteranceRepository(prisma as never);
    const result = await repo.searchSessionIds('hello', 't1');
    expect(result).toEqual(['s1', 's2']);
    expect(prisma.db.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('searchSessionIds runs unscoped for an operator with no tenant filter', async () => {
    const prisma = makePrisma();
    prisma.db.$queryRaw.mockResolvedValue([{ session_id: 's1' }]);
    const repo = new PrismaUtteranceRepository(prisma as never);
    const result = await repo.searchSessionIds('hello');
    expect(result).toEqual(['s1']);
  });

  it('purgeExpired nulls transcript text only for sessions the raw update actually flipped', async () => {
    const prisma = makePrisma();
    prisma.db.$queryRaw.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
    const repo = new PrismaUtteranceRepository(prisma as never);
    const count = await repo.purgeExpired();
    expect(count).toBe(2);
    expect(prisma.db.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('purgeExpired is a no-op (no second query) when nothing is past retention', async () => {
    const prisma = makePrisma();
    prisma.db.$queryRaw.mockResolvedValue([]);
    const repo = new PrismaUtteranceRepository(prisma as never);
    const count = await repo.purgeExpired();
    expect(count).toBe(0);
    expect(prisma.db.$executeRaw).not.toHaveBeenCalled();
  });
});
