import { PrismaSessionSearchRepository } from './prisma-session-search.repository';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    tenantId: 't1',
    tenant: { slug: 'acme' },
    roomName: 'acme_s1',
    status: 'ended',
    errorCode: null,
    providerStack: { transport: 'livekit', stt: null, llm: null, llmFallback: null, tts: null, avatar: null },
    residencySnapshot: { sendToRemoteLlm: 'prompt_text_only', retainTranscriptsDays: 90, recordingsEnabled: false },
    displayName: 'Guest',
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    endedAt: new Date('2026-01-01T00:05:00.000Z'),
    transcriptPurged: false,
    recordingPresent: false,
    summaryStatus: 'ready',
    ...overrides,
  };
}

describe('PrismaSessionSearchRepository', () => {
  function makePrisma() {
    return {
      db: { session: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findUnique: jest.fn() } },
      withBypass: jest.fn(async (fn: () => Promise<unknown>) => fn()),
    };
  }

  it('search returns an empty page without querying when tenantIds is an explicit empty array', async () => {
    const prisma = makePrisma();
    const repo = new PrismaSessionSearchRepository(prisma as never);
    const result = await repo.search({ tenantIds: [], page: 1, pageSize: 25 });
    expect(result).toEqual({ items: [], total: 0 });
    expect(prisma.db.session.findMany).not.toHaveBeenCalled();
  });

  it('search returns an empty page when sessionIds is an explicit empty array (a q with no matches)', async () => {
    const prisma = makePrisma();
    const repo = new PrismaSessionSearchRepository(prisma as never);
    const result = await repo.search({ tenantIds: null, sessionIds: [], page: 1, pageSize: 25 });
    expect(result).toEqual({ items: [], total: 0 });
  });

  it('search queries with tenant/status/date filters and maps rows', async () => {
    const prisma = makePrisma();
    prisma.db.session.findMany.mockResolvedValue([makeRow()]);
    prisma.db.session.count.mockResolvedValue(1);
    const repo = new PrismaSessionSearchRepository(prisma as never);

    const from = new Date('2026-01-01T00:00:00.000Z');
    const result = await repo.search({ tenantIds: ['t1'], status: 'ended', from, page: 1, pageSize: 25 });

    expect(prisma.db.session.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: { in: ['t1'] }, status: 'ended', startedAt: { gte: from } } }),
    );
    expect(result.total).toBe(1);
    expect(result.items[0].tenantSlug).toBe('acme');
  });

  it('search with no filters at all (operator, no q) omits tenantId from the where clause', async () => {
    const prisma = makePrisma();
    const repo = new PrismaSessionSearchRepository(prisma as never);
    await repo.search({ tenantIds: null, page: 1, pageSize: 25 });
    expect(prisma.db.session.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('findDetail returns null for an unknown id', async () => {
    const prisma = makePrisma();
    const repo = new PrismaSessionSearchRepository(prisma as never);
    expect(await repo.findDetail('missing')).toBeNull();
  });

  it('findDetail maps the extended detail fields', async () => {
    const prisma = makePrisma();
    prisma.db.session.findUnique.mockResolvedValue(makeRow());
    const repo = new PrismaSessionSearchRepository(prisma as never);
    const result = await repo.findDetail('s1');
    expect(result?.roomName).toBe('acme_s1');
    expect(result?.residencySnapshot.sendToRemoteLlm).toBe('prompt_text_only');
  });
});
