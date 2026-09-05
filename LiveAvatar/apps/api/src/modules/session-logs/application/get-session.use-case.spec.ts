import { GetSessionUseCase } from './get-session.use-case';

function actor(overrides: Record<string, unknown> = {}) {
  return { id: 'a1', email: 'a@x.com', roles: ['admin'], tenantIds: ['t1'], ...overrides };
}

function makeDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    tenantId: 't1',
    tenantSlug: 'acme',
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    endedAt: new Date('2026-01-01T00:05:00.000Z'),
    status: 'ended',
    providerStack: { transport: 'livekit', stt: 'deepgram', llm: 'openai', llmFallback: null, tts: 'fish-speech', avatar: 'bithuman' },
    errorCode: null,
    transcriptPurged: false,
    roomName: 'acme_s1',
    residencySnapshot: { sendToRemoteLlm: 'prompt_text_only', retainTranscriptsDays: 90, recordingsEnabled: false },
    recordingPresent: false,
    summaryStatus: 'ready',
    displayName: 'Guest',
    ...overrides,
  };
}

describe('GetSessionUseCase', () => {
  function make(detail: unknown = makeDetail()) {
    const search = { findDetail: jest.fn().mockResolvedValue(detail) };
    const useCase = new GetSessionUseCase(search as never);
    return { useCase, search };
  }

  it('404s for an unknown session', async () => {
    const { useCase } = make(null);
    await expect(useCase.execute(actor(), 'missing')).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('404s (not 403) for a session belonging to another tenant', async () => {
    const { useCase } = make(makeDetail({ tenantId: 't2' }));
    await expect(useCase.execute(actor({ tenantIds: ['t1'] }), 's1')).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('returns the detail DTO with derived participant identities for an assigned admin', async () => {
    const { useCase } = make();
    const result = await useCase.execute(actor(), 's1');
    expect(result.id).toBe('s1');
    expect(result.room_name).toBe('acme_s1');
    expect(result.participant_identities).toEqual(['user_s1', 'agent_s1']);
    expect(result.residency_snapshot.send_to_remote_llm).toBe('prompt_text_only');
  });

  it('an operator can access any tenant', async () => {
    const { useCase } = make(makeDetail({ tenantId: 't9' }));
    const result = await useCase.execute(actor({ roles: ['operator'], tenantIds: [] }), 's1');
    expect(result.id).toBe('s1');
  });
});
