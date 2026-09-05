import { GetProviderHealthUseCase } from './get-provider-health.use-case';

function definition(overrides: Record<string, unknown> = {}) {
  return { key: 'openai', category: 'llm', displayName: 'OpenAI', hosting: 'remote', interfaceName: 'ILLMProvider', requiresCredential: true, enabled: true, featureGaps: null, ...overrides };
}

function credential(overrides: Record<string, unknown> = {}) {
  return { id: 'c1', tenantId: 't1', providerKey: 'openai', displayLabel: 'default', endpointUrl: 'https://x', credentialRef: 'ref', extra: {}, lastProbeStatus: 'healthy', lastProbeAt: new Date(), lastProbeError: null, createdAt: new Date(), updatedAt: new Date(), ...overrides };
}

describe('GetProviderHealthUseCase', () => {
  function make(definitions: unknown[] = [definition()], credentials: unknown[] = [credential()]) {
    const defRepo = { list: jest.fn().mockResolvedValue(definitions) };
    const credRepo = { listAllActive: jest.fn().mockResolvedValue(credentials) };
    const useCase = new GetProviderHealthUseCase(defRepo as never, credRepo as never);
    return { useCase };
  }

  it('returns gray with no providers for a category with zero configured credentials', async () => {
    const { useCase } = make([], []);
    const result = await useCase.execute();
    const llmCategory = result.categories.find((c) => c.category === 'llm');
    expect(llmCategory?.state).toBe('gray');
    expect(llmCategory?.providers).toEqual([]);
  });

  it('reports green for a healthy, fresh probe', async () => {
    const { useCase } = make();
    const result = await useCase.execute();
    const llmCategory = result.categories.find((c) => c.category === 'llm');
    expect(llmCategory?.state).toBe('green');
    expect(llmCategory?.providers[0]).toMatchObject({ key: 'openai', label: 'OpenAI', state: 'green' });
  });

  it('treats a probe older than 5 minutes as gray/unknown', async () => {
    const stale = new Date(Date.now() - 6 * 60 * 1000);
    const { useCase } = make([definition()], [credential({ lastProbeAt: stale })]);
    const result = await useCase.execute();
    const llmCategory = result.categories.find((c) => c.category === 'llm');
    expect(llmCategory?.providers[0].state).toBe('gray');
  });

  it('a category is amber when any credential is degraded (worst-wins)', async () => {
    const { useCase } = make(
      [definition()],
      [credential({ id: 'c1', lastProbeStatus: 'healthy' }), credential({ id: 'c2', tenantId: 't2', lastProbeStatus: 'degraded' })],
    );
    const result = await useCase.execute();
    const llmCategory = result.categories.find((c) => c.category === 'llm');
    expect(llmCategory?.providers[0].state).toBe('amber');
  });

  it('a category is red when any credential is unreachable, even alongside a healthy one', async () => {
    const { useCase } = make(
      [definition()],
      [credential({ id: 'c1', lastProbeStatus: 'unreachable' }), credential({ id: 'c2', tenantId: 't2', lastProbeStatus: 'healthy' })],
    );
    const result = await useCase.execute();
    const llmCategory = result.categories.find((c) => c.category === 'llm');
    expect(llmCategory?.state).toBe('red');
  });

  it('covers all five categories', async () => {
    const { useCase } = make([], []);
    const result = await useCase.execute();
    expect(result.categories.map((c) => c.category).sort()).toEqual(['avatar', 'llm', 'stt', 'transport', 'tts']);
  });
});
