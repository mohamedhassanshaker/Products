import { GetRuntimeConfigUseCase } from './get-runtime-config.use-case';

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    tenantId: 't1',
    roomName: 'acme_s1',
    residencySnapshot: { sendToRemoteLlm: 'prompt_text_only', retainTranscriptsDays: 90, recordingsEnabled: false },
    ...overrides,
  };
}

/** Phase 9 (BL-035) — a single-`llm`-node `reasoning.graph[]`, the R-G1 default shape. */
function makeReasoning(overrides: Record<string, unknown> = {}) {
  return {
    entry_node_id: 'llm-1',
    background_entry_node_ids: [],
    turn_budget_ms: 3000,
    graph: [
      {
        id: 'llm-1',
        type: 'llm',
        name: 'Answer',
        lane: 'foreground',
        on_error: { action: 'degrade' },
        on_deadline: { action: 'degrade' },
        provider: 'openai',
        credential_ref: 'secrets/openai',
        model: 'gpt-4o',
        retry: { max_attempts: 3, backoff_ms: [200, 400, 800] },
        next_node_id: null,
        ...overrides,
      },
    ],
  };
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cfg-1',
    tenantId: 't1',
    yamlText: '',
    status: 'published' as const,
    providers: { transport: 'livekit', stt: 'deepgram', llm: 'openai', llmFallback: null, tts: 'fish-speech', avatar: 'bithuman' },
    updatedAt: new Date(),
    updatedBy: null,
    publishedAt: new Date(),
    structured: {
      version: 1,
      deployment: { tenant_id: 't1', name: 'Example A' },
      transport: { provider: 'livekit', room_namespace: 'acme' },
      stt: { provider: 'deepgram', credential_ref: 'secrets/deepgram', language: 'en-US' },
      reasoning: makeReasoning(),
      tts: { provider: 'fish-speech', credential_ref: 'secrets/fish-speech', voice_id: 'v1' },
      avatar: { provider: 'bithuman', credential_ref: 'secrets/bithuman', avatar_id: 'a1' },
      agent: {
        runtime: 'langgraph',
        system_prompt: 'hi',
        tools: [],
        memory: { enabled: true, window_turns: 16 },
      },
      knowledge: {
        pipeline: {
          rewrite: { enabled: true, context_turns: 3, budget_ms: 150 },
          hybrid_search: { vector_weight: 0.6, keyword_weight: 0.4, candidates: 20, budget_ms: 100 },
          metadata_filter: { enabled: false, budget_ms: 20 },
          rerank: { enabled: false },
          threshold: { min_score: 0.5, budget_ms: 10 },
          inject: { token_cap: 1200, citation_format: 'numbered', budget_ms: 30 },
        },
      },
      privacy: { send_to_remote_llm: 'prompt_text_only', retain_transcripts_days: 90, recordings_enabled: false },
      alerts: { degraded_mode_message: 'hold on' },
    },
    ...overrides,
  };
}

function makeCredential(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cred-1',
    tenantId: 't1',
    providerKey: 'deepgram',
    displayLabel: 'default',
    endpointUrl: 'https://deepgram.internal.example.com',
    credentialRef: 'secrets/deepgram',
    extra: {},
    lastProbeStatus: 'unknown' as const,
    lastProbeAt: null,
    lastProbeError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeToolDefinitionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tool-1',
    tenantId: 't1',
    apiRef: 'weather-api',
    name: 'Weather',
    description: 'Looks up the weather',
    method: 'GET',
    url: 'https://weather.example.com',
    credentialRef: 'secrets/weather',
    argsSchema: { type: 'object' },
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('GetRuntimeConfigUseCase', () => {
  function make(session: unknown, config: unknown, credentials: unknown[] = [], toolDefinitionRecords: unknown[] = []) {
    const sessions = { findById: jest.fn().mockResolvedValue(session) };
    const configs = { findByTenantId: jest.fn().mockResolvedValue(config) };
    const creds = { list: jest.fn().mockResolvedValue(credentials) };
    const toolDefinitions = {
      listByTenant: jest.fn().mockResolvedValue(toolDefinitionRecords),
      listEnabledByApiRefs: jest.fn().mockResolvedValue(toolDefinitionRecords),
    };
    // Phase 13 (BL-049/050/051) — no test in this file exercises a `skills[]`/
    // `skill`-type-node reference, so `findPublishedVersion` is never
    // expected to resolve anything; a bare unconfigured mock is enough.
    const skills = { findPublishedVersion: jest.fn().mockResolvedValue(null) };
    const useCase = new GetRuntimeConfigUseCase(
      sessions as never,
      configs as never,
      creds as never,
      toolDefinitions as never,
      skills as never,
    );
    return { useCase, sessions, configs, creds, toolDefinitions, skills };
  }

  it('throws SESSION_NOT_FOUND for an unknown session id', async () => {
    const { useCase } = make(null, null);
    await expect(useCase.execute('s1')).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('throws CONFIG_INCOMPLETE when the tenant has no deployment config row', async () => {
    const { useCase } = make(makeSession(), null);
    await expect(useCase.execute('s1')).rejects.toMatchObject({ code: 'CONFIG_INCOMPLETE' });
  });

  it('resolves endpoints per provider leg by matching provider + credential_ref', async () => {
    const { useCase } = make(makeSession(), makeConfig(), [
      makeCredential({ providerKey: 'deepgram', credentialRef: 'secrets/deepgram', endpointUrl: 'https://stt.example.com' }),
      makeCredential({ providerKey: 'openai', credentialRef: 'secrets/openai', endpointUrl: 'https://llm.example.com' }),
      makeCredential({ providerKey: 'fish-speech', credentialRef: 'secrets/fish-speech', endpointUrl: 'https://tts.example.com' }),
      makeCredential({ providerKey: 'bithuman', credentialRef: 'secrets/bithuman', endpointUrl: 'https://avatar.example.com' }),
    ]);

    const result = await useCase.execute('s1');

    expect(result.endpoints).toEqual({
      deepgram: 'https://stt.example.com',
      openai: 'https://llm.example.com',
      'fish-speech': 'https://tts.example.com',
      bithuman: 'https://avatar.example.com',
    });
    expect(result.session_id).toBe('s1');
    expect(result.room_name).toBe('acme_s1');
  });

  it('sends the SESSION-START residency snapshot, never a live re-read (FR-PRIV-2)', async () => {
    const { useCase } = make(
      makeSession({ residencySnapshot: { sendToRemoteLlm: 'none', retainTranscriptsDays: 1, recordingsEnabled: true } }),
      makeConfig({ structured: { ...makeConfig().structured, privacy: { send_to_remote_llm: 'prompt_text_only', retain_transcripts_days: 90, recordings_enabled: false } } }),
    );

    const result = await useCase.execute('s1');

    // The session's own snapshot wins, not the (differing) current config value.
    expect(result.privacy).toEqual({ send_to_remote_llm: 'none', retain_transcripts_days: 1, recordings_enabled: true });
  });

  it('passes reasoning through as-is, unchanged (Phase 9: a published config is always schema-complete, no field-by-field reconstruction)', async () => {
    const { useCase } = make(makeSession(), makeConfig());
    const result = await useCase.execute('s1');
    expect(result.reasoning).toEqual(makeReasoning());
  });

  it('resolves endpoints for every llm-type graph node\'s primary AND fallback leg, not just one pair', async () => {
    const config = makeConfig({
      structured: {
        ...makeConfig().structured,
        reasoning: makeReasoning({ fallback: { provider: 'anthropic', credential_ref: 'secrets/anthropic', model: 'claude-3-5-sonnet' } }),
      },
    });
    const { useCase } = make(makeSession(), config, [
      makeCredential({ providerKey: 'openai', credentialRef: 'secrets/openai', endpointUrl: 'https://llm.example.com' }),
      makeCredential({ providerKey: 'anthropic', credentialRef: 'secrets/anthropic', endpointUrl: 'https://fallback.example.com' }),
    ]);
    const result = await useCase.execute('s1');
    expect(result.endpoints.openai).toBe('https://llm.example.com');
    expect(result.endpoints.anthropic).toBe('https://fallback.example.com');
  });

  it('falls back to sensible defaults when the structured config is minimal (defensive path)', async () => {
    const { useCase } = make(makeSession(), makeConfig({ structured: { version: 1 } }));

    const result = await useCase.execute('s1');

    expect(result.deployment).toEqual({ tenant_id: 't1', name: '' });
    expect(result.transport).toEqual({ provider: 'livekit', credential_ref: undefined, room_namespace: '' });
    expect(result.stt).toEqual({ provider: undefined, credential_ref: undefined, language: 'en-US', model: undefined });
    // No defaulting for `reasoning` (Phase 9) — a config this minimal has no
    // `reasoning` block at all, and none is synthesized (mirrors `emptyAgentConfig`'s
    // "brand-new tenant has no LLM chosen" design; this path is defensive only,
    // since a real *published* config is always schema-complete).
    expect(result.reasoning).toBeUndefined();
    expect(result.tts).toEqual({ provider: undefined, credential_ref: undefined, voice_id: '' });
    expect(result.avatar).toEqual({ provider: undefined, credential_ref: undefined, avatar_id: '' });
    expect(result.agent).toEqual({
      runtime: 'langgraph',
      system_prompt: '',
      tools: [],
      memory: { enabled: true, window_turns: 16 },
    });
    // Phase 12b (BL-045/047) — replaces the removed `agent.rag` flag+ref
    // pair; defaulted the same defensive way for a config this minimal.
    expect(result.knowledge).toEqual({
      pipeline: {
        rewrite: { enabled: true, context_turns: 3, budget_ms: 150 },
        hybrid_search: { vector_weight: 0.6, keyword_weight: 0.4, candidates: 20, budget_ms: 100 },
        metadata_filter: { enabled: false, budget_ms: 20 },
        rerank: { enabled: false },
        threshold: { min_score: 0.5, budget_ms: 10 },
        inject: { token_cap: 1200, citation_format: 'numbered', budget_ms: 30 },
      },
    });
    expect(result.alerts).toEqual({ degraded_mode_message: '' });
    expect(result.endpoints).toEqual({});
    expect(result.tool_definitions).toEqual([]);
  });

  it('does not resolve an endpoint when no credential matches the leg\'s provider+credential_ref', async () => {
    const { useCase } = make(makeSession(), makeConfig(), [
      makeCredential({ providerKey: 'deepgram', credentialRef: 'secrets/some-other-ref' }),
    ]);
    const result = await useCase.execute('s1');
    expect(result.endpoints.deepgram).toBeUndefined();
  });

  it('falls back to any credential for the provider when the leg carries no credential_ref', async () => {
    const config = makeConfig();
    (config.structured.stt as Record<string, unknown>).credential_ref = undefined;
    const { useCase } = make(makeSession(), config, [
      makeCredential({ providerKey: 'deepgram', credentialRef: 'secrets/deepgram', endpointUrl: 'https://stt.example.com' }),
    ]);
    const result = await useCase.execute('s1');
    expect(result.endpoints.deepgram).toBe('https://stt.example.com');
  });

  it('maps agent.tools[] through unchanged', async () => {
    const config = makeConfig();
    (config.structured.agent as Record<string, unknown>).tools = [{ name: 'Weather', api_ref: 'weather-api', enabled: true }];
    const { useCase } = make(makeSession(), config);
    const result = await useCase.execute('s1');
    expect(result.agent.tools).toEqual([{ name: 'Weather', api_ref: 'weather-api', enabled: true }]);
  });

  it('resolves enabled tools into tool_definitions with url/method/credential_ref (QA D-2 fix)', async () => {
    const config = makeConfig();
    (config.structured.agent as Record<string, unknown>).tools = [{ name: 'Weather', api_ref: 'weather-api', enabled: true }];
    const { useCase, toolDefinitions } = make(makeSession(), config, [], [makeToolDefinitionRecord()]);

    const result = await useCase.execute('s1');

    expect(toolDefinitions.listEnabledByApiRefs).toHaveBeenCalledWith('t1', ['weather-api']);
    expect(result.tool_definitions).toEqual([
      {
        api_ref: 'weather-api',
        name: 'Weather',
        description: 'Looks up the weather',
        method: 'GET',
        url: 'https://weather.example.com',
        credential_ref: 'secrets/weather',
        args_schema: { type: 'object' },
      },
    ]);
  });

  it('does not look up tool definitions when no tools are configured', async () => {
    const { useCase, toolDefinitions } = make(makeSession(), makeConfig());
    const result = await useCase.execute('s1');
    expect(toolDefinitions.listEnabledByApiRefs).not.toHaveBeenCalled();
    expect(result.tool_definitions).toEqual([]);
  });

  it('excludes a disabled tool from the resolved lookup', async () => {
    const config = makeConfig();
    (config.structured.agent as Record<string, unknown>).tools = [
      { name: 'Weather', api_ref: 'weather-api', enabled: false },
    ];
    const { useCase, toolDefinitions } = make(makeSession(), config);
    await useCase.execute('s1');
    expect(toolDefinitions.listEnabledByApiRefs).not.toHaveBeenCalled();
  });
});
