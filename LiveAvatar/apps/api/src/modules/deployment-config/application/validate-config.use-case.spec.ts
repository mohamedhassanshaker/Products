import type { ProviderCredentialRepositoryPort, ProviderDefinitionRepositoryPort } from '../../providers';
import type { ProviderCredentialRecord, ProviderDefinitionRecord } from '../../providers';
import type { TenantRepositoryPort } from '../../tenants';
import type { ToolDefinitionRepositoryPort } from '../../tools';
import type { KnowledgeSourceRepositoryPort } from '../../knowledge';
import type { SkillRepositoryPort } from '../../skills';
import type { HitlGateRepositoryPort, ReviewerGroupRepositoryPort } from '../../hitl';
import type { DeploymentConfigRepositoryPort } from '../domain/ports';
import { buildSingleLlmNodeGraph } from '../domain/agent-config';
import { ValidateConfigUseCase } from './validate-config.use-case';

const actor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };

function makeTenant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tenant-1',
    name: 'Acme',
    slug: 'acme',
    status: 'active' as const,
    roomNamespace: 'acme',
    createdAt: new Date(),
    updatedAt: new Date(),
    providerStackSummary: 'Not configured',
    ...overrides,
  };
}

function def(overrides: Partial<ProviderDefinitionRecord>): ProviderDefinitionRecord {
  return {
    key: 'x',
    category: 'llm',
    displayName: 'x',
    hosting: 'remote',
    interfaceName: 'ILLMProvider',
    requiresCredential: true,
    enabled: true,
    featureGaps: null,
    ...overrides,
  };
}

/** v1 catalog matching spec FR-PROVIDER-1, enough for both fixture examples. */
const CATALOG: ProviderDefinitionRecord[] = [
  def({ key: 'livekit', category: 'transport', hosting: 'self_hosted', interfaceName: 'ITransportProvider' }),
  def({ key: 'deepgram', category: 'stt', hosting: 'self_hosted', interfaceName: 'ISTTProvider' }),
  def({
    key: 'faster-whisper',
    category: 'stt',
    hosting: 'self_hosted',
    interfaceName: 'ISTTProvider',
    requiresCredential: false,
  }),
  def({ key: 'openai', category: 'llm', hosting: 'remote' }),
  def({ key: 'anthropic', category: 'llm', hosting: 'remote' }),
  def({ key: 'google', category: 'llm', hosting: 'remote' }),
  def({ key: 'fish-speech', category: 'tts', hosting: 'self_hosted', interfaceName: 'ITTSProvider' }),
  def({ key: 'elevenlabs', category: 'tts', hosting: 'remote', interfaceName: 'ITTSProvider' }),
  def({ key: 'bithuman', category: 'avatar', hosting: 'self_hosted', interfaceName: 'IAvatarProvider' }),
  def({ key: 'alibaba-liveavatar', category: 'avatar', hosting: 'remote', interfaceName: 'IAvatarProvider' }),
];

function credential(providerKey: string, overrides: Partial<ProviderCredentialRecord> = {}): ProviderCredentialRecord {
  return {
    id: `cred-${providerKey}`,
    tenantId: 'tenant-1',
    providerKey,
    displayLabel: 'default',
    endpointUrl: 'https://example.com',
    credentialRef: `secrets/${providerKey}`,
    extra: {},
    lastProbeStatus: 'unknown',
    lastProbeAt: null,
    lastProbeError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const EXAMPLE_A_YAML = `
version: 1
deployment:
  tenant_id: "11111111-1111-1111-1111-111111111111"
  name: "Acme"
transport:
  provider: livekit
  room_namespace: acme
stt:
  provider: deepgram
  credential_ref: secrets/deepgram
  language: en-US
reasoning:
  entry_node_id: llm-1
  background_entry_node_ids: []
  turn_budget_ms: 3000
  graph:
    - id: llm-1
      type: llm
      name: Answer
      lane: foreground
      on_error:
        action: degrade
      on_deadline:
        action: degrade
      provider: openai
      credential_ref: secrets/openai
      model: gpt-4o
      retry:
        max_attempts: 3
        backoff_ms: [200, 400, 800]
      next_node_id: null
tts:
  provider: fish-speech
  credential_ref: secrets/fish-speech
  voice_id: default-voice
avatar:
  provider: bithuman
  credential_ref: secrets/bithuman
  avatar_id: default-avatar
agent:
  runtime: langgraph
  system_prompt: "You are a helpful assistant."
  tools: []
  memory:
    enabled: true
    window_turns: 16
privacy:
  send_to_remote_llm: prompt_text_only
  retain_transcripts_days: 90
  recordings_enabled: false
alerts:
  degraded_mode_message: "One moment please."
`;

const EXAMPLE_B_YAML = `
version: 1
deployment:
  tenant_id: "11111111-1111-1111-1111-111111111111"
  name: "Acme"
transport:
  provider: livekit
  room_namespace: acme
stt:
  provider: faster-whisper
  language: en-US
reasoning:
  entry_node_id: llm-1
  background_entry_node_ids: []
  turn_budget_ms: 3000
  graph:
    - id: llm-1
      type: llm
      name: Answer
      lane: foreground
      on_error:
        action: degrade
      on_deadline:
        action: degrade
      provider: anthropic
      credential_ref: secrets/anthropic
      model: claude-3-5-sonnet
      retry:
        max_attempts: 3
        backoff_ms: [200, 400, 800]
      next_node_id: null
tts:
  provider: elevenlabs
  credential_ref: secrets/elevenlabs
  voice_id: rachel
avatar:
  provider: alibaba-liveavatar
  credential_ref: secrets/alibaba-liveavatar
  avatar_id: avatar-b
agent:
  runtime: pydantic-ai
  system_prompt: "You are a helpful assistant."
  tools: []
  memory:
    enabled: true
    window_turns: 16
privacy:
  send_to_remote_llm: prompt_text_only
  retain_transcripts_days: 90
  recordings_enabled: false
alerts:
  degraded_mode_message: "One moment please."
`;

describe('ValidateConfigUseCase', () => {
  let definitions: jest.Mocked<ProviderDefinitionRepositoryPort>;
  let credentials: jest.Mocked<ProviderCredentialRepositoryPort>;
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let tools: jest.Mocked<ToolDefinitionRepositoryPort>;
  let hitlGates: jest.Mocked<HitlGateRepositoryPort>;
  let reviewerGroups: jest.Mocked<ReviewerGroupRepositoryPort>;
  let deploymentConfigs: jest.Mocked<DeploymentConfigRepositoryPort>;
  let knowledgeSources: jest.Mocked<KnowledgeSourceRepositoryPort>;
  let skills: jest.Mocked<SkillRepositoryPort>;
  let useCase: ValidateConfigUseCase;

  beforeEach(() => {
    definitions = {
      list: jest.fn().mockResolvedValue(CATALOG),
      findByKey: jest.fn(),
      countEnabledInCategory: jest.fn(),
      setEnabled: jest.fn(),
    };
    credentials = {
      create: jest.fn(),
      findById: jest.fn(),
      findByLabel: jest.fn(),
      list: jest.fn().mockResolvedValue([]),
      listAllActive: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      recordProbeResult: jest.fn(),
    };
    tenants = {
      create: jest.fn(),
      findById: jest.fn().mockResolvedValue(makeTenant()),
      findBySlug: jest.fn(),
      count: jest.fn(),
      list: jest.fn(),
      updateName: jest.fn(),
      updateStatus: jest.fn(),
    };
    tools = {
      listByTenant: jest.fn().mockResolvedValue([]),
      listEnabledByApiRefs: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      findByApiRef: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    knowledgeSources = {
      create: jest.fn(),
      findById: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      delete: jest.fn(),
    };
    skills = {
      listByTenant: jest.fn(),
      findById: jest.fn(),
      findBySlug: jest.fn(),
      create: jest.fn(),
      updateDraft: jest.fn(),
      publishDraft: jest.fn(),
      delete: jest.fn(),
      agentUsageCounts: jest.fn().mockResolvedValue(new Map()),
      listPublishedByTenant: jest.fn().mockResolvedValue([]),
      findPublishedVersion: jest.fn(),
      findPublishedVersionBody: jest.fn(),
    };
    hitlGates = {
      listByTenant: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      findByIdAnyTenant: jest.fn(),
      findByAttachment: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    reviewerGroups = {
      listByTenant: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      findByName: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    deploymentConfigs = {
      findByTenantId: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
    };
    useCase = new ValidateConfigUseCase(
      definitions,
      credentials,
      tenants,
      tools,
      knowledgeSources,
      skills,
      hitlGates,
      reviewerGroups,
      deploymentConfigs,
    );
  });

  it('404s an unknown tenant (D-1 fix — was silently returning a 200-shaped body)', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-does-not-exist', { config: {} })).rejects.toMatchObject({
      code: 'TENANT_NOT_FOUND',
    });
  });

  it('404s (not 403, and not a 200-shaped body) an admin not assigned to this tenant (D-1 fix)', async () => {
    const unassigned = { ...actor, roles: ['admin'], tenantIds: ['other-tenant'] };
    await expect(useCase.execute(unassigned, 'tenant-1', { config: {} })).rejects.toMatchObject({
      code: 'TENANT_NOT_FOUND',
    });
  });

  it('Example A (openai + deepgram + fish-speech + bithuman + livekit) is valid given credentials', async () => {
    credentials.list.mockResolvedValue([
      credential('livekit'),
      credential('deepgram'),
      credential('openai'),
      credential('fish-speech'),
      credential('bithuman'),
    ]);
    const result = await useCase.execute(actor, 'tenant-1', { yaml_text: EXAMPLE_A_YAML });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('Example B (anthropic + faster-whisper + elevenlabs + alibaba-liveavatar + livekit) is valid given credentials', async () => {
    credentials.list.mockResolvedValue([
      credential('livekit'),
      credential('anthropic'),
      credential('elevenlabs'),
      credential('alibaba-liveavatar'),
    ]);
    const result = await useCase.execute(actor, 'tenant-1', { yaml_text: EXAMPLE_B_YAML });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('reports CONFIG_INCOMPLETE for every unset layer on a brand-new empty draft', async () => {
    const result = await useCase.execute(actor, 'tenant-1', { config: { version: 1 } });
    expect(result.valid).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes.filter((c) => c === 'CONFIG_INCOMPLETE').length).toBeGreaterThanOrEqual(5);
  });

  it('rejects a document containing a raw secret anywhere (FR-PROVIDER-7 / FR-CONFIG-2)', async () => {
    await expect(
      useCase.execute(actor, 'tenant-1', { config: { stt: { provider: 'deepgram', api_key: 'sk-secret' } } }),
    ).rejects.toMatchObject({ code: 'CONFIG_SECRET_IN_YAML', httpStatus: 400 });
  });

  it('rejects an unknown top-level key', async () => {
    await expect(
      useCase.execute(actor, 'tenant-1', { config: { version: 1, bogus_key: true } }),
    ).rejects.toMatchObject({ code: 'CONFIG_YAML_UNKNOWN_KEY', httpStatus: 400 });
  });

  it('rejects the old top-level `llm` key as unknown (Phase 9 replaced it with `reasoning`)', async () => {
    await expect(
      useCase.execute(actor, 'tenant-1', { config: { version: 1, llm: { primary: { provider: 'openai', model: 'gpt-4o' } } } }),
    ).rejects.toMatchObject({ code: 'CONFIG_YAML_UNKNOWN_KEY', httpStatus: 400 });
  });

  it('rejects unparseable YAML', async () => {
    await expect(useCase.execute(actor, 'tenant-1', { yaml_text: '{ not: [valid' })).rejects.toMatchObject({
      code: 'CONFIG_YAML_PARSE',
      httpStatus: 400,
    });
  });

  it('flags CONFIG_CREDENTIAL_MISSING when a selected provider has no tenant credential', async () => {
    credentials.list.mockResolvedValue([]); // no credentials at all
    const result = await useCase.execute(actor, 'tenant-1', {
      config: {
        version: 1,
        transport: { provider: 'livekit' },
        stt: { provider: 'deepgram', language: 'en-US' },
        reasoning: buildSingleLlmNodeGraph({ provider: 'openai', model: 'gpt-4o' }),
        tts: { provider: 'fish-speech', voice_id: 'v' },
        avatar: { provider: 'bithuman', avatar_id: 'a' },
      },
    });
    expect(result.errors.some((e) => e.code === 'CONFIG_CREDENTIAL_MISSING')).toBe(true);
  });

  it('flags CONFIG_FALLBACK_IDENTICAL when fallback equals primary', async () => {
    credentials.list.mockResolvedValue([credential('openai'), credential('deepgram'), credential('fish-speech'), credential('bithuman')]);
    const result = await useCase.execute(actor, 'tenant-1', {
      config: {
        version: 1,
        transport: { provider: 'livekit' },
        stt: { provider: 'deepgram', language: 'en-US' },
        reasoning: buildSingleLlmNodeGraph({
          provider: 'openai',
          model: 'gpt-4o',
          fallback: { provider: 'openai', model: 'gpt-4o' },
        }),
        tts: { provider: 'fish-speech', voice_id: 'v' },
        avatar: { provider: 'bithuman', avatar_id: 'a' },
      },
    });
    expect(result.errors.some((e) => e.code === 'CONFIG_FALLBACK_IDENTICAL')).toBe(true);
  });

  it('flags CONFIG_RESIDENCY_BLOCKS_LLM when residency none pairs with a remote LLM', async () => {
    credentials.list.mockResolvedValue([credential('openai'), credential('deepgram'), credential('fish-speech'), credential('bithuman')]);
    const result = await useCase.execute(actor, 'tenant-1', {
      config: {
        version: 1,
        transport: { provider: 'livekit' },
        stt: { provider: 'deepgram', language: 'en-US' },
        reasoning: buildSingleLlmNodeGraph({ provider: 'openai', model: 'gpt-4o' }),
        tts: { provider: 'fish-speech', voice_id: 'v' },
        avatar: { provider: 'bithuman', avatar_id: 'a' },
        privacy: { send_to_remote_llm: 'none' },
      },
    });
    expect(result.errors.some((e) => e.code === 'CONFIG_RESIDENCY_BLOCKS_LLM')).toBe(true);
  });

  it('flags CONFIG_PROVIDER_DISABLED for a disabled catalog entry', async () => {
    definitions.list.mockResolvedValue(CATALOG.map((d) => (d.key === 'openai' ? { ...d, enabled: false } : d)));
    credentials.list.mockResolvedValue([credential('openai'), credential('deepgram'), credential('fish-speech'), credential('bithuman')]);
    const result = await useCase.execute(actor, 'tenant-1', {
      config: {
        version: 1,
        transport: { provider: 'livekit' },
        stt: { provider: 'deepgram', language: 'en-US' },
        reasoning: buildSingleLlmNodeGraph({ provider: 'openai', model: 'gpt-4o' }),
        tts: { provider: 'fish-speech', voice_id: 'v' },
        avatar: { provider: 'bithuman', avatar_id: 'a' },
      },
    });
    expect(result.errors.some((e) => e.code === 'CONFIG_PROVIDER_DISABLED')).toBe(true);
  });

  it('requires voice_id/avatar_id when their provider is selected (llm has no top-level flat block anymore)', async () => {
    const result = await useCase.execute(actor, 'tenant-1', {
      config: {
        version: 1,
        tts: { provider: 'fish-speech' },
        avatar: { provider: 'bithuman' },
      },
    });
    const codes = result.errors.map((e) => e.code);
    expect(codes).toEqual(expect.arrayContaining(['CONFIG_VOICE_REQUIRED', 'CONFIG_AVATAR_ID_REQUIRED']));
  });

  it('a graph llm node missing its required `model` field fails Gate A structurally as CONFIG_YAML_PARSE, not CONFIG_MODEL_REQUIRED (Phase 9: the old per-block manual check was removed; TypeBox enforces this per-node instead)', async () => {
    const result = await useCase.execute(actor, 'tenant-1', {
      config: {
        version: 1,
        reasoning: {
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
              // model deliberately omitted
              retry: { max_attempts: 3, backoff_ms: [200, 400, 800] },
              next_node_id: null,
            },
          ],
        },
      },
    });
    expect(result.errors.some((e) => e.code === 'CONFIG_MODEL_REQUIRED')).toBe(false);
    expect(result.errors.some((e) => e.code === 'CONFIG_YAML_PARSE')).toBe(true);
  });

  it('rejects a non-mapping document (e.g. a bare YAML list)', async () => {
    await expect(useCase.execute(actor, 'tenant-1', { config: ['not', 'a', 'mapping'] })).rejects.toMatchObject({
      code: 'CONFIG_YAML_PARSE',
    });
  });

  it('flags CONFIG_PROMPT_TOO_LARGE by UTF-8 byte length, not UTF-16 code units', async () => {
    // Each '🙂' is 2 UTF-16 code units but 4 UTF-8 bytes — this string is
    // under the 32768 *character* count TypeBox's maxLength checks but over
    // the 32768 *byte* count the spec actually requires (LLD §6.1 note).
    const bigPrompt = '🙂'.repeat(9000);
    const result = await useCase.execute(actor, 'tenant-1', { config: { version: 1, agent: { system_prompt: bigPrompt } } });
    expect(result.errors.some((e) => e.code === 'CONFIG_PROMPT_TOO_LARGE')).toBe(true);
  });

  it('no longer flags a backoff_ms/max_attempts length mismatch inside a graph node (Phase 9: the old manual cross-field CONFIG_RETRY_INVALID check was removed, not reimplemented per-node — a documented, deliberate simplification, not a silently dropped rule)', async () => {
    const reasoning = buildSingleLlmNodeGraph({ provider: 'openai', model: 'gpt-4o' });
    (reasoning.graph[0] as unknown as { retry: unknown }).retry = { max_attempts: 3, backoff_ms: [200, 400] };
    const result = await useCase.execute(actor, 'tenant-1', { config: { version: 1, reasoning } });
    expect(result.errors.some((e) => e.code === 'CONFIG_RETRY_INVALID')).toBe(false);
  });

  it('flags CONFIG_RETRIEVAL_BUDGET_EXCEEDED (V-10) when a Retrieve node budget is smaller than its pipeline stage budgets sum', async () => {
    const reasoning = {
      entry_node_id: 'retrieve-1',
      background_entry_node_ids: [],
      turn_budget_ms: 3000,
      graph: [
        {
          id: 'retrieve-1',
          type: 'retrieve',
          name: 'Look up',
          lane: 'foreground',
          on_error: { action: 'degrade' },
          on_deadline: { action: 'degrade' },
          source_refs: [],
          top_k: 5,
          budget_ms: 50,
          next_node_id: null,
        },
      ],
    };
    const knowledge = {
      pipeline: {
        rewrite: { enabled: true, context_turns: 3, budget_ms: 150 },
        hybrid_search: { vector_weight: 0.6, keyword_weight: 0.4, candidates: 20, budget_ms: 100 },
        metadata_filter: { enabled: false, budget_ms: 20 },
        rerank: { enabled: false },
        threshold: { min_score: 0.5, budget_ms: 10 },
        inject: { token_cap: 1200, citation_format: 'numbered', budget_ms: 30 },
      },
    };
    const result = await useCase.execute(actor, 'tenant-1', { config: { version: 1, reasoning, knowledge } });
    expect(result.errors.some((e) => e.code === 'CONFIG_RETRIEVAL_BUDGET_EXCEEDED')).toBe(true);
    // Gate A structural — blocks save, not just publish, so `valid` reflects it too.
    expect(result.valid).toBe(false);
  });

  it('surfaces KNOWLEDGE_SOURCE_STALE (V-9) as a non-blocking warning that does not flip `valid` to false', async () => {
    credentials.list.mockResolvedValue([
      credential('livekit'),
      credential('deepgram'),
      credential('openai'),
      credential('fish-speech'),
      credential('bithuman'),
    ]);
    knowledgeSources.findMany.mockResolvedValue([
      {
        id: 'src-1',
        tenantId: 'tenant-1',
        name: 'Docs',
        sourceType: 'upload',
        originalFilename: 'docs.txt',
        mimeType: 'text/plain',
        fileSizeBytes: 10,
        rawContent: Buffer.from('x'),
        parser: 'plain_text',
        chunkingStrategy: 'fixed',
        chunkSize: 800,
        chunkOverlap: 100,
        embeddingModel: 'text-embedding-3-small',
        embeddingCredentialRef: null,
        status: 'ready',
        chunkCount: 1,
        errorMessage: null,
        configUpdatedAt: new Date('2026-01-02T00:00:00.000Z'),
        lastIndexedAt: new Date('2026-01-01T00:00:00.000Z'),
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const withRetrieveNode = EXAMPLE_A_YAML.replace(
      '      next_node_id: null\ntts:',
      [
        '      next_node_id: retrieve-1',
        '    - id: retrieve-1',
        '      type: retrieve',
        '      name: Look up',
        '      lane: foreground',
        '      on_error: { action: degrade }',
        '      on_deadline: { action: degrade }',
        '      source_refs: ["src-1"]',
        '      top_k: 5',
        '      budget_ms: 400',
        '      next_node_id: null',
        'tts:',
      ].join('\n'),
    );
    const result = await useCase.execute(actor, 'tenant-1', { yaml_text: withRetrieveNode });
    const staleErrors = result.errors.filter((e) => e.code === 'KNOWLEDGE_SOURCE_STALE');
    expect(staleErrors).toHaveLength(1);
    expect(staleErrors[0].severity).toBe('warning');
    expect(result.valid).toBe(true);
  });

  it('a graph llm node whose fallback leg is missing its required `model` field fails Gate A structurally as CONFIG_YAML_PARSE, not CONFIG_MODEL_REQUIRED', async () => {
    const reasoning = buildSingleLlmNodeGraph({ provider: 'openai', model: 'gpt-4o' });
    (reasoning.graph[0] as unknown as { fallback: unknown }).fallback = { provider: 'anthropic' };
    const result = await useCase.execute(actor, 'tenant-1', { config: { version: 1, reasoning } });
    expect(result.errors.some((e) => e.code === 'CONFIG_MODEL_REQUIRED')).toBe(false);
    expect(result.errors.some((e) => e.code === 'CONFIG_YAML_PARSE')).toBe(true);
  });

  it('never puts a secret value in the redacted_yaml preview', async () => {
    const result = await useCase.execute(actor, 'tenant-1', { yaml_text: EXAMPLE_A_YAML });
    expect(result.redacted_yaml).not.toMatch(/api_key|password|secret:/i);
    expect(result.redacted_yaml).toContain('credential_ref');
  });

  describe('graph structural integrity (Gate A, domain/graph-structure.ts, Phase 9 BL-035)', () => {
    it('flags CONFIG_GRAPH_ENTRY_UNKNOWN when entry_node_id does not resolve', async () => {
      const reasoning = buildSingleLlmNodeGraph({ provider: 'openai', model: 'gpt-4o' });
      const result = await useCase.execute(actor, 'tenant-1', {
        config: { version: 1, reasoning: { ...reasoning, entry_node_id: 'does-not-exist' } },
      });
      expect(result.errors.some((e) => e.code === 'CONFIG_GRAPH_ENTRY_UNKNOWN')).toBe(true);
    });

    it('flags CONFIG_GRAPH_NODE_ID_DUPLICATE when two nodes share an id', async () => {
      const reasoning = buildSingleLlmNodeGraph({ provider: 'openai', model: 'gpt-4o' });
      const result = await useCase.execute(actor, 'tenant-1', {
        config: { version: 1, reasoning: { ...reasoning, graph: [reasoning.graph[0], reasoning.graph[0]] } },
      });
      expect(result.errors.some((e) => e.code === 'CONFIG_GRAPH_NODE_ID_DUPLICATE')).toBe(true);
    });
  });

  describe('agent.tools[] resolution (BL-016/FR-AGENT-2, real ToolDefinition repo)', () => {
    it('flags CONFIG_TOOL_UNKNOWN when the tenant has no matching ToolDefinition row', async () => {
      tools.listByTenant.mockResolvedValue([]);
      const result = await useCase.execute(actor, 'tenant-1', {
        config: { version: 1, agent: { tools: [{ name: 'Weather', api_ref: 'weather-api', enabled: true }] } },
      });
      expect(tools.listByTenant).toHaveBeenCalledWith('tenant-1');
      expect(result.errors.some((e) => e.code === 'CONFIG_TOOL_UNKNOWN')).toBe(true);
    });

    it('accepts a tool api_ref that matches a real (even disabled) ToolDefinition row', async () => {
      tools.listByTenant.mockResolvedValue([
        {
          id: 'tool-1',
          tenantId: 'tenant-1',
          apiRef: 'weather-api',
          name: 'Weather',
          description: null,
          method: 'GET',
          url: 'https://internal.example.com/weather',
          credentialRef: null,
          requiresCredential: false,
          argsSchema: {},
          enabled: false,
          consequential: false,
          autonomousUseAckText: null,
          lane: 'foreground',
          perSessionCap: null,
          perTurnCap: null,
          timeoutMs: 10000,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      const result = await useCase.execute(actor, 'tenant-1', {
        config: { version: 1, agent: { tools: [{ name: 'Weather', api_ref: 'weather-api', enabled: true }] } },
      });
      expect(result.errors.some((e) => e.code === 'CONFIG_TOOL_UNKNOWN')).toBe(false);
    });
  });
});
