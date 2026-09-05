import { PrismaResidencyPolicyRepository } from './prisma-residency-policy.repository';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 't1',
    sendToRemoteLlm: 'prompt_text_only',
    retainTranscriptsDays: 90,
    recordingsEnabled: false,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('PrismaResidencyPolicyRepository', () => {
  function makePrisma() {
    return {
      db: {
        dataResidencyPolicy: {
          findUnique: jest.fn(),
          updateMany: jest.fn(),
        },
      },
    };
  }

  it('findByTenantId returns null when no policy row exists', async () => {
    const prisma = makePrisma();
    prisma.db.dataResidencyPolicy.findUnique.mockResolvedValue(null);
    const repo = new PrismaResidencyPolicyRepository(prisma as never);
    expect(await repo.findByTenantId('t1')).toBeNull();
  });

  it('findByTenantId maps a found row', async () => {
    const prisma = makePrisma();
    prisma.db.dataResidencyPolicy.findUnique.mockResolvedValue(makeRow());
    const repo = new PrismaResidencyPolicyRepository(prisma as never);
    const result = await repo.findByTenantId('t1');
    expect(result?.sendToRemoteLlm).toBe('prompt_text_only');
  });

  it('update returns missing when the row does not exist', async () => {
    const prisma = makePrisma();
    prisma.db.dataResidencyPolicy.findUnique.mockResolvedValue(null);
    const repo = new PrismaResidencyPolicyRepository(prisma as never);
    const result = await repo.update('t1', { sendToRemoteLlm: 'none', retainTranscriptsDays: 30, recordingsEnabled: false }, new Date());
    expect(result).toBe('missing');
  });

  it('update returns conflict when updateMany affects zero rows', async () => {
    const prisma = makePrisma();
    prisma.db.dataResidencyPolicy.findUnique.mockResolvedValue(makeRow());
    prisma.db.dataResidencyPolicy.updateMany.mockResolvedValue({ count: 0 });
    const repo = new PrismaResidencyPolicyRepository(prisma as never);
    const result = await repo.update('t1', { sendToRemoteLlm: 'none', retainTranscriptsDays: 30, recordingsEnabled: false }, new Date());
    expect(result).toBe('conflict');
  });

  it('update returns the fresh record on success', async () => {
    const prisma = makePrisma();
    prisma.db.dataResidencyPolicy.findUnique
      .mockResolvedValueOnce(makeRow())
      .mockResolvedValueOnce(makeRow({ sendToRemoteLlm: 'none', retainTranscriptsDays: 30 }));
    prisma.db.dataResidencyPolicy.updateMany.mockResolvedValue({ count: 1 });
    const repo = new PrismaResidencyPolicyRepository(prisma as never);
    const result = await repo.update(
      't1',
      { sendToRemoteLlm: 'none', retainTranscriptsDays: 30, recordingsEnabled: false },
      new Date('2026-01-01T00:00:00.000Z'),
    );
    expect(result).not.toBe('missing');
    expect(result).not.toBe('conflict');
    expect((result as { sendToRemoteLlm: string }).sendToRemoteLlm).toBe('none');
  });
});
