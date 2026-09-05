import { PrismaResidencySnapshotReader } from './prisma-residency-snapshot.reader';

describe('PrismaResidencySnapshotReader (FR-PRIV-2 snapshot-at-session-start)', () => {
  function makePrisma(row: unknown) {
    return {
      db: { dataResidencyPolicy: { findUnique: jest.fn().mockResolvedValue(row) } },
      withBypass: jest.fn(async (fn: () => Promise<unknown>) => fn()),
    };
  }

  it('maps the tenant residency policy row', async () => {
    const prisma = makePrisma({ sendToRemoteLlm: 'none', retainTranscriptsDays: 30, recordingsEnabled: true });
    const reader = new PrismaResidencySnapshotReader(prisma as never);
    expect(await reader.read('t1')).toEqual({
      sendToRemoteLlm: 'none',
      retainTranscriptsDays: 30,
      recordingsEnabled: true,
    });
  });

  it('falls back to the platform default when no policy row exists', async () => {
    const prisma = makePrisma(null);
    const reader = new PrismaResidencySnapshotReader(prisma as never);
    expect(await reader.read('t1')).toEqual({
      sendToRemoteLlm: 'prompt_text_only',
      retainTranscriptsDays: 90,
      recordingsEnabled: false,
    });
  });
});
