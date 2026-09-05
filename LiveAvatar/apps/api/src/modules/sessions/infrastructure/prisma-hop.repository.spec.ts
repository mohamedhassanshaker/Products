import { PrismaHopRepository } from './prisma-hop.repository';

describe('PrismaHopRepository', () => {
  function makePrisma() {
    return {
      db: {
        latencyHop: {
          upsert: jest.fn().mockResolvedValue({}),
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
      },
      withBypass: jest.fn(async (fn: () => Promise<unknown>) => fn()),
    };
  }

  it('upserts a hop row on the (sessionId, utteranceSeq, hop, nodeId) unique index, defaulting nodeId to \'\' and usedFallback to false', async () => {
    const prisma = makePrisma();
    const repo = new PrismaHopRepository(prisma as never);

    await repo.upsertMany('s1', 't1', [{ utteranceSeq: 1, hop: 'llm', firstTokenMs: 250, totalMs: 900, providerKey: 'openai' }]);

    expect(prisma.db.latencyHop.upsert).toHaveBeenCalledWith({
      where: { sessionId_utteranceSeq_hop_nodeId: { sessionId: 's1', utteranceSeq: 1, hop: 'llm', nodeId: '' } },
      create: {
        sessionId: 's1',
        tenantId: 't1',
        utteranceSeq: 1,
        hop: 'llm',
        firstPartialMs: undefined,
        firstTokenMs: 250,
        firstAudioMs: undefined,
        firstFrameMs: undefined,
        totalMs: 900,
        providerKey: 'openai',
        usedFallback: false,
        errorCode: undefined,
        nodeId: '',
        nodeType: undefined,
        lane: undefined,
      },
      update: {
        firstPartialMs: undefined,
        firstTokenMs: 250,
        firstAudioMs: undefined,
        firstFrameMs: undefined,
        totalMs: 900,
        providerKey: 'openai',
        usedFallback: false,
        errorCode: undefined,
        nodeType: undefined,
        lane: undefined,
      },
    });
  });

  it('preserves an explicit usedFallback: true', async () => {
    const prisma = makePrisma();
    const repo = new PrismaHopRepository(prisma as never);
    await repo.upsertMany('s1', 't1', [{ utteranceSeq: 1, hop: 'llm', usedFallback: true }]);
    expect(prisma.db.latencyHop.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ usedFallback: true }) }),
    );
  });

  it('no-ops on an empty batch', async () => {
    const prisma = makePrisma();
    const repo = new PrismaHopRepository(prisma as never);
    await repo.upsertMany('s1', 't1', []);
    expect(prisma.db.latencyHop.upsert).not.toHaveBeenCalled();
  });

  it('upserts a `node`-kind hop row with a real nodeId/nodeType/lane (Phase 9, BL-039)', async () => {
    const prisma = makePrisma();
    const repo = new PrismaHopRepository(prisma as never);

    await repo.upsertMany('s1', 't1', [
      { utteranceSeq: 1, hop: 'node', nodeId: 'llm-1', nodeType: 'llm', lane: 'foreground', totalMs: 120 },
    ]);

    expect(prisma.db.latencyHop.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId_utteranceSeq_hop_nodeId: { sessionId: 's1', utteranceSeq: 1, hop: 'node', nodeId: 'llm-1' } },
        create: expect.objectContaining({ hop: 'node', nodeId: 'llm-1', nodeType: 'llm', lane: 'foreground', totalMs: 120 }),
        update: expect.objectContaining({ nodeType: 'llm', lane: 'foreground', totalMs: 120 }),
      }),
    );
  });

  it('upserts two distinct `node` rows for the same utterance independently (different nodeId, not overwriting each other)', async () => {
    const prisma = makePrisma();
    const repo = new PrismaHopRepository(prisma as never);

    await repo.upsertMany('s1', 't1', [
      { utteranceSeq: 1, hop: 'node', nodeId: 'router-1', nodeType: 'router', lane: 'foreground', totalMs: 5 },
      { utteranceSeq: 1, hop: 'node', nodeId: 'llm-1', nodeType: 'llm', lane: 'foreground', totalMs: 300 },
    ]);

    expect(prisma.db.latencyHop.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.db.latencyHop.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { sessionId_utteranceSeq_hop_nodeId: { sessionId: 's1', utteranceSeq: 1, hop: 'node', nodeId: 'router-1' } },
      }),
    );
    expect(prisma.db.latencyHop.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { sessionId_utteranceSeq_hop_nodeId: { sessionId: 's1', utteranceSeq: 1, hop: 'node', nodeId: 'llm-1' } },
      }),
    );
  });

  it('listBySession orders by utterance sequence then created_at (FR-SESS-3)', async () => {
    const prisma = makePrisma();
    prisma.db.latencyHop.findMany.mockResolvedValue([
      {
        utteranceSeq: 0,
        hop: 'stt',
        firstPartialMs: 120,
        firstTokenMs: null,
        firstAudioMs: null,
        firstFrameMs: null,
        totalMs: 300,
        providerKey: 'deepgram',
        usedFallback: false,
        errorCode: null,
        nodeId: '',
        nodeType: null,
        lane: null,
      },
    ]);
    const repo = new PrismaHopRepository(prisma as never);
    const rows = await repo.listBySession('s1');
    expect(prisma.db.latencyHop.findMany).toHaveBeenCalledWith({
      where: { sessionId: 's1' },
      orderBy: [{ utteranceSeq: 'asc' }, { createdAt: 'asc' }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].hop).toBe('stt');
    expect(rows[0].nodeId).toBe('');
  });

  it('listBySession maps nodeId/nodeType/lane through for a `node` row', async () => {
    const prisma = makePrisma();
    prisma.db.latencyHop.findMany.mockResolvedValue([
      {
        utteranceSeq: 0,
        hop: 'node',
        firstPartialMs: null,
        firstTokenMs: null,
        firstAudioMs: null,
        firstFrameMs: null,
        totalMs: 120,
        providerKey: null,
        usedFallback: false,
        errorCode: null,
        nodeId: 'llm-1',
        nodeType: 'llm',
        lane: 'foreground',
      },
    ]);
    const repo = new PrismaHopRepository(prisma as never);
    const rows = await repo.listBySession('s1');
    expect(rows[0]).toMatchObject({ hop: 'node', nodeId: 'llm-1', nodeType: 'llm', lane: 'foreground' });
  });

  it('countLlmFailoverStats sums fallback successes + degraded invocations into primaryFailures (FR-ALERT-2)', async () => {
    const prisma = makePrisma();
    prisma.db.latencyHop.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    const repo = new PrismaHopRepository(prisma as never);
    const stats = await repo.countLlmFailoverStats('t1', new Date());
    expect(stats).toEqual({ primaryFailures: 5, fallbackSuccesses: 3, degradedInvocations: 2 });
  });
});
