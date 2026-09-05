import { PrismaPublishedConfigLookup } from './prisma-published-config-lookup';

describe('PrismaPublishedConfigLookup', () => {
  function makePrisma() {
    return { db: { deploymentConfig: { findFirst: jest.fn() } } };
  }

  it('returns false when there is no published config at all', async () => {
    const prisma = makePrisma();
    prisma.db.deploymentConfig.findFirst.mockResolvedValue(null);
    const lookup = new PrismaPublishedConfigLookup(prisma as never);
    expect(await lookup.isProviderInUse('tenant-1', 'openai')).toBe(false);
  });

  it('returns true when the published config references the provider in any layer', async () => {
    const prisma = makePrisma();
    prisma.db.deploymentConfig.findFirst.mockResolvedValue({
      transportProvider: 'livekit',
      sttProvider: 'deepgram',
      llmProvider: 'openai',
      llmFallbackProvider: null,
      ttsProvider: 'fish-speech',
      avatarProvider: 'bithuman',
    });
    const lookup = new PrismaPublishedConfigLookup(prisma as never);
    expect(await lookup.isProviderInUse('tenant-1', 'openai')).toBe(true);
    expect(await lookup.isProviderInUse('tenant-1', 'anthropic')).toBe(false);
  });

  it('checks the fallback LLM slot too', async () => {
    const prisma = makePrisma();
    prisma.db.deploymentConfig.findFirst.mockResolvedValue({
      transportProvider: 'livekit',
      sttProvider: null,
      llmProvider: 'openai',
      llmFallbackProvider: 'anthropic',
      ttsProvider: null,
      avatarProvider: null,
    });
    const lookup = new PrismaPublishedConfigLookup(prisma as never);
    expect(await lookup.isProviderInUse('tenant-1', 'anthropic')).toBe(true);
  });
});
