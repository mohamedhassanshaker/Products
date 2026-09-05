import { GetHopsUseCase } from './get-hops.use-case';

function actor(overrides: Record<string, unknown> = {}) {
  return { id: 'a1', email: 'a@x.com', roles: ['admin'], tenantIds: ['t1'], ...overrides };
}

describe('GetHopsUseCase', () => {
  function make(detail: unknown = { id: 's1', tenantId: 't1' }) {
    const search = { findDetail: jest.fn().mockResolvedValue(detail) };
    const hops = {
      listBySession: jest.fn().mockResolvedValue([
        { utteranceSeq: 0, hop: 'stt', firstPartialMs: 120, firstTokenMs: null, firstAudioMs: null, firstFrameMs: null, totalMs: 300, providerKey: 'deepgram', usedFallback: false, errorCode: null },
        { utteranceSeq: 0, hop: 'llm', firstPartialMs: null, firstTokenMs: 250, firstAudioMs: null, firstFrameMs: null, totalMs: 900, providerKey: 'openai', usedFallback: false, errorCode: null },
      ]),
    };
    const useCase = new GetHopsUseCase(search as never, hops as never);
    return { useCase, search, hops };
  }

  it('404s for an unknown or cross-tenant session', async () => {
    const { useCase } = make(null);
    await expect(useCase.execute(actor(), 'missing')).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('groups hop rows into per-utterance cycles, omitting hops that never fired', async () => {
    const { useCase } = make();
    const result = await useCase.execute(actor(), 's1');
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].utterance_seq).toBe(0);
    expect(result.cycles[0].stt?.first_partial_ms).toBe(120);
    expect(result.cycles[0].llm?.first_token_ms).toBe(250);
    expect(result.cycles[0].tts).toBeUndefined();
    expect(result.cycles[0].avatar).toBeUndefined();
  });
});
