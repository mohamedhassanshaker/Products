import { PROVIDER_CATALOG, seedProviderCatalog } from './seed';

describe('seedProviderCatalog', () => {
  /** Minimal fake satisfying the one Prisma call the seed script makes. */
  function makeFakePrisma() {
    const upsert = jest.fn().mockResolvedValue({});
    return { providerDefinition: { upsert } };
  }

  it('includes all 10 v1 catalog rows named in spec FR-PROVIDER-1, including alibaba-liveavatar', () => {
    const keys = PROVIDER_CATALOG.map((r) => r.key).sort();
    expect(keys).toEqual(
      [
        'alibaba-liveavatar',
        'anthropic',
        'bithuman',
        'deepgram',
        'elevenlabs',
        'faster-whisper',
        'fish-speech',
        'google',
        'livekit',
        'openai',
      ].sort(),
    );
  });

  it('carries the exact FR-AVATAR-2 feature-gap sentence for alibaba-liveavatar', () => {
    const row = PROVIDER_CATALOG.find((r) => r.key === 'alibaba-liveavatar');
    expect(row?.featureGaps).toBe(
      'LiveAvatar: idle motion and custom upload may differ from bitHuman. Lip-sync and LiveKit publish are required.',
    );
  });

  it('upserts every catalog row exactly once per run', async () => {
    const prisma = makeFakePrisma();
    await seedProviderCatalog(prisma as never);
    expect(prisma.providerDefinition.upsert).toHaveBeenCalledTimes(PROVIDER_CATALOG.length);
  });

  it('is idempotent — a second run upserts the same rows without erroring', async () => {
    const prisma = makeFakePrisma();
    await seedProviderCatalog(prisma as never);
    await seedProviderCatalog(prisma as never);
    expect(prisma.providerDefinition.upsert).toHaveBeenCalledTimes(PROVIDER_CATALOG.length * 2);
  });

  it('never sets `enabled` on update — a re-run cannot silently re-enable an operator-disabled provider', async () => {
    const prisma = makeFakePrisma();
    await seedProviderCatalog(prisma as never);
    for (const call of prisma.providerDefinition.upsert.mock.calls) {
      const args = call[0] as { update: Record<string, unknown> };
      expect(args.update).not.toHaveProperty('enabled');
    }
  });

  it('sets enabled: true only on first insert (create branch)', async () => {
    const prisma = makeFakePrisma();
    await seedProviderCatalog(prisma as never);
    for (const call of prisma.providerDefinition.upsert.mock.calls) {
      const args = call[0] as { create: Record<string, unknown> };
      expect(args.create.enabled).toBe(true);
    }
  });
});
