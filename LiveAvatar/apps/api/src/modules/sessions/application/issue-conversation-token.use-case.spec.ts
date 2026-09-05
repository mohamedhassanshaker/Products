import { IssueConversationTokenUseCase } from './issue-conversation-token.use-case';

function makeTenant(overrides: Record<string, unknown> = {}) {
  return { id: 't1', slug: 'acme', name: 'Acme', status: 'active', roomNamespace: 'acme', ...overrides };
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    status: 'published',
    providers: {
      transport: 'livekit',
      stt: 'deepgram',
      llm: 'openai',
      llmFallback: null,
      tts: 'fish-speech',
      avatar: 'bithuman',
    },
    ...overrides,
  };
}

describe('IssueConversationTokenUseCase (FR-AUTH-4)', () => {
  beforeEach(() => {
    process.env.LIVEKIT_URL = 'ws://localhost:7880';
    process.env.AGENT_NAME = 'avatar-agent';
  });

  function make(opts: {
    tenant?: unknown;
    config?: unknown;
    createRoomOutcome?: { kind: string };
    previousPending?: unknown;
  }) {
    const tenants = {
      findById: jest.fn().mockResolvedValue(opts.tenant ?? null),
      findBySlug: jest.fn().mockResolvedValue(opts.tenant ?? null),
    };
    const configs = { findByTenantId: jest.fn().mockResolvedValue(opts.config ?? null) };
    const sessions = {
      create: jest.fn().mockResolvedValue(undefined),
      findPendingByTabKey: jest.fn().mockResolvedValue(opts.previousPending ?? null),
      applyStatus: jest.fn().mockResolvedValue(undefined),
    };
    const residency = {
      read: jest.fn().mockResolvedValue({ sendToRemoteLlm: 'prompt_text_only', retainTranscriptsDays: 90, recordingsEnabled: false }),
    };
    const liveKit = {
      createRoom: jest.fn().mockResolvedValue(opts.createRoomOutcome ?? { kind: 'created' }),
      deleteRoom: jest.fn().mockResolvedValue(undefined),
      mintToken: jest.fn().mockResolvedValue('signed-token'),
      createAgentDispatch: jest.fn().mockResolvedValue(undefined),
    };
    const useCase = new IssueConversationTokenUseCase(
      tenants as never,
      configs as never,
      sessions as never,
      residency as never,
      liveKit as never,
    );
    return { useCase, tenants, configs, sessions, residency, liveKit };
  }

  it('issues a token for a tenant resolved by slug', async () => {
    const { useCase, liveKit } = make({ tenant: makeTenant(), config: makeConfig() });
    const result = await useCase.execute({ slug: 'acme', display_name: 'Alice' });
    expect(result.token).toBe('signed-token');
    expect(result.room_name).toMatch(/^acme_/);
    expect(result.ws_url).toBe('ws://localhost:7880');
    expect(liveKit.createAgentDispatch).toHaveBeenCalled();
  });

  it('issues a token for a tenant resolved by tenant_id', async () => {
    const { useCase, tenants } = make({ tenant: makeTenant(), config: makeConfig() });
    await useCase.execute({ tenant_id: 't1' });
    expect(tenants.findById).toHaveBeenCalledWith('t1');
  });

  it('defaults display_name to Guest when omitted', async () => {
    const { useCase, sessions } = make({ tenant: makeTenant(), config: makeConfig() });
    await useCase.execute({ slug: 'acme' });
    expect(sessions.create).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Guest' }));
  });

  it('resolves to nothing found when neither slug nor tenant_id is given', async () => {
    const { useCase } = make({ tenant: null });
    await expect(useCase.execute({})).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('throws TENANT_NOT_FOUND for an unknown tenant', async () => {
    const { useCase } = make({ tenant: null });
    await expect(useCase.execute({ slug: 'missing' })).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('throws TENANT_PAUSED for a paused tenant', async () => {
    const { useCase } = make({ tenant: makeTenant({ status: 'paused' }), config: makeConfig() });
    await expect(useCase.execute({ slug: 'acme' })).rejects.toMatchObject({ code: 'TENANT_PAUSED' });
  });

  it('throws CONFIG_INCOMPLETE when the config is not published', async () => {
    const { useCase } = make({ tenant: makeTenant(), config: makeConfig({ status: 'draft' }) });
    await expect(useCase.execute({ slug: 'acme' })).rejects.toMatchObject({ code: 'CONFIG_INCOMPLETE' });
  });

  it('throws CONFIG_INCOMPLETE when a required layer is unset despite status=published', async () => {
    const { useCase } = make({
      tenant: makeTenant(),
      config: makeConfig({ providers: { transport: 'livekit', stt: null, llm: 'openai', llmFallback: null, tts: 'fish-speech', avatar: 'bithuman' } }),
    });
    await expect(useCase.execute({ slug: 'acme' })).rejects.toMatchObject({ code: 'CONFIG_INCOMPLETE' });
  });

  it('throws TRANSPORT_UNAVAILABLE when LiveKit room creation fails', async () => {
    const { useCase } = make({ tenant: makeTenant(), config: makeConfig(), createRoomOutcome: { kind: 'unavailable' } });
    await expect(useCase.execute({ slug: 'acme' })).rejects.toMatchObject({ code: 'TRANSPORT_UNAVAILABLE', httpStatus: 503 });
  });

  it('throws TRANSPORT_CAPACITY when LiveKit rejects for capacity', async () => {
    const { useCase } = make({ tenant: makeTenant(), config: makeConfig(), createRoomOutcome: { kind: 'capacity' } });
    await expect(useCase.execute({ slug: 'acme' })).rejects.toMatchObject({ code: 'TRANSPORT_CAPACITY', httpStatus: 503 });
  });

  it('abandons and deletes the previous pending session for the same tab_key (idempotency)', async () => {
    const previous = { id: 'prev-1', roomName: 'acme_prev-1' };
    const { useCase, sessions, liveKit } = make({ tenant: makeTenant(), config: makeConfig(), previousPending: previous });
    await useCase.execute({ slug: 'acme', tab_key: 'tab-1' });
    expect(sessions.applyStatus).toHaveBeenCalledWith('prev-1', expect.objectContaining({ status: 'abandoned' }));
    expect(liveKit.deleteRoom).toHaveBeenCalledWith('acme_prev-1');
  });

  it('does not touch any previous session when no tab_key is given', async () => {
    const { useCase, sessions } = make({ tenant: makeTenant(), config: makeConfig() });
    await useCase.execute({ slug: 'acme' });
    expect(sessions.findPendingByTabKey).not.toHaveBeenCalled();
  });
});
