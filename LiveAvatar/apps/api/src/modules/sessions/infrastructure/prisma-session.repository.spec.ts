import { PrismaSessionRepository } from './prisma-session.repository';
import type { ProviderStackSnapshot, ResidencySnapshot } from '../domain/session';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    tenantId: 't1',
    roomName: 'acme_s1',
    status: 'pending',
    errorCode: null,
    providerStack: { transport: 'livekit', stt: 'deepgram', llm: 'openai', llmFallback: null, tts: 'fish-speech', avatar: 'bithuman' },
    residencySnapshot: { sendToRemoteLlm: 'prompt_text_only', retainTranscriptsDays: 90, recordingsEnabled: false },
    displayName: 'Guest',
    tabKey: null,
    maxDurationSeconds: 7200,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    joinedAt: null,
    endedAt: null,
    summaryTokenHash: null,
    summaryTokenExpiresAt: null,
    summaryText: null,
    summaryStatus: 'none',
    transcriptPurged: false,
    recordingPresent: false,
    ...overrides,
  };
}

function makePrisma() {
  return {
    db: {
      session: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    },
    withBypass: jest.fn(async (fn: () => Promise<unknown>) => fn()),
  };
}

describe('PrismaSessionRepository', () => {
  it('creates a session with an explicit tenantId (bypasses ALS by design)', async () => {
    const prisma = makePrisma();
    prisma.db.session.create.mockResolvedValue(makeRow());
    const repo = new PrismaSessionRepository(prisma as never);
    const result = await repo.create({
      id: 's1',
      tenantId: 't1',
      roomName: 'acme_s1',
      providerStack: makeRow().providerStack as ProviderStackSnapshot,
      residencySnapshot: makeRow().residencySnapshot as ResidencySnapshot,
      displayName: 'Guest',
      tabKey: null,
      maxDurationSeconds: 7200,
    });
    expect(result.id).toBe('s1');
    expect(prisma.withBypass).toHaveBeenCalled();
  });

  it('findById returns null when the row does not exist', async () => {
    const prisma = makePrisma();
    prisma.db.session.findUnique.mockResolvedValue(null);
    const repo = new PrismaSessionRepository(prisma as never);
    expect(await repo.findById('missing')).toBeNull();
  });

  it('findByRoomName maps a found row', async () => {
    const prisma = makePrisma();
    prisma.db.session.findUnique.mockResolvedValue(makeRow());
    const repo = new PrismaSessionRepository(prisma as never);
    const result = await repo.findByRoomName('acme_s1');
    expect(result?.roomName).toBe('acme_s1');
  });

  it('findPendingByTabKey scopes by tenant + tab_key + pending status', async () => {
    const prisma = makePrisma();
    prisma.db.session.findFirst.mockResolvedValue(makeRow({ tabKey: 'tab-1' }));
    const repo = new PrismaSessionRepository(prisma as never);
    const result = await repo.findPendingByTabKey('t1', 'tab-1');
    expect(prisma.db.session.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', tabKey: 'tab-1', status: 'pending' } }),
    );
    expect(result?.tabKey).toBe('tab-1');
  });

  it('applyStatus updates status/joinedAt/endedAt/errorCode when provided', async () => {
    const prisma = makePrisma();
    prisma.db.session.update.mockResolvedValue(makeRow({ status: 'active' }));
    const repo = new PrismaSessionRepository(prisma as never);
    const joinedAt = new Date();
    const result = await repo.applyStatus('s1', { status: 'active', joinedAt });
    expect(result?.status).toBe('active');
    expect(prisma.db.session.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'active', joinedAt },
    });
  });

  it('applyStatus returns null when the update fails (row vanished)', async () => {
    const prisma = makePrisma();
    prisma.db.session.update.mockRejectedValue(new Error('not found'));
    const repo = new PrismaSessionRepository(prisma as never);
    expect(await repo.applyStatus('missing', { status: 'ended' })).toBeNull();
  });

  it('setSummaryToken writes the hash and expiry', async () => {
    const prisma = makePrisma();
    prisma.db.session.update.mockResolvedValue(makeRow());
    const repo = new PrismaSessionRepository(prisma as never);
    const expiresAt = new Date();
    await repo.setSummaryToken('s1', 'hash', expiresAt);
    expect(prisma.db.session.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { summaryTokenHash: 'hash', summaryTokenExpiresAt: expiresAt },
    });
  });

  it('listAbandonable maps every pending row older than the cutoff', async () => {
    const prisma = makePrisma();
    prisma.db.session.findMany.mockResolvedValue([makeRow(), makeRow({ id: 's2' })]);
    const repo = new PrismaSessionRepository(prisma as never);
    const result = await repo.listAbandonable(new Date());
    expect(result).toHaveLength(2);
  });

  it('listActiveJoined queries active sessions with a non-null joinedAt (QA Phase 3 D-2)', async () => {
    const prisma = makePrisma();
    prisma.db.session.findMany.mockResolvedValue([
      makeRow({ status: 'active', joinedAt: new Date('2026-01-01T01:00:00.000Z') }),
    ]);
    const repo = new PrismaSessionRepository(prisma as never);
    const result = await repo.listActiveJoined();
    expect(prisma.db.session.findMany).toHaveBeenCalledWith({
      where: { status: 'active', joinedAt: { not: null } },
    });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('active');
  });

  it('setSummary writes the agent-generated summary (BL-013..017, HLD §7.3)', async () => {
    const prisma = makePrisma();
    const repo = new PrismaSessionRepository(prisma as never);
    await repo.setSummary('s1', 'ready', 'A short summary.');
    expect(prisma.db.session.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { summaryStatus: 'ready', summaryText: 'A short summary.' },
    });
  });

  it('setSummary writes summary_status=unavailable with a null text', async () => {
    const prisma = makePrisma();
    const repo = new PrismaSessionRepository(prisma as never);
    await repo.setSummary('s1', 'unavailable', null);
    expect(prisma.db.session.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { summaryStatus: 'unavailable', summaryText: null },
    });
  });
});
