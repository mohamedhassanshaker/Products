import { RecordHopsUseCase } from './record-hops.use-case';

describe('RecordHopsUseCase', () => {
  function make(session: unknown) {
    const sessions = { findById: jest.fn().mockResolvedValue(session) };
    const hops = { upsertMany: jest.fn().mockResolvedValue(undefined) };
    const useCase = new RecordHopsUseCase(sessions as never, hops as never);
    return { useCase, sessions, hops };
  }

  it('throws SESSION_NOT_FOUND for an unknown session id', async () => {
    const { useCase } = make(null);
    await expect(useCase.execute('s1', { items: [] })).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('maps wire items (snake_case) to HopInput (camelCase) and upserts with the session tenantId', async () => {
    const { useCase, hops } = make({ id: 's1', tenantId: 't1' });
    await useCase.execute('s1', {
      items: [
        {
          utterance_seq: 1,
          hop: 'llm',
          first_token_ms: 250,
          total_ms: 900,
          provider_key: 'openai',
          used_fallback: false,
        },
        { utterance_seq: 1, hop: 'stt', first_partial_ms: 120, error_code: 'STT_UNAVAILABLE' },
      ],
    });
    expect(hops.upsertMany).toHaveBeenCalledWith('s1', 't1', [
      {
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
      },
      {
        utteranceSeq: 1,
        hop: 'stt',
        firstPartialMs: 120,
        firstTokenMs: undefined,
        firstAudioMs: undefined,
        firstFrameMs: undefined,
        totalMs: undefined,
        providerKey: undefined,
        usedFallback: undefined,
        errorCode: 'STT_UNAVAILABLE',
      },
    ]);
  });
});
