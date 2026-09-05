import type { TenantRepositoryPort } from '../../tenants';
import type { ProviderCredentialRepositoryPort, ProviderDefinitionRepositoryPort } from '../../providers';
import type { ProviderDefinitionRecord } from '../../providers';
import type { ToolDefinitionRepositoryPort } from '../../tools';
import type { KnowledgeSourceRepositoryPort } from '../../knowledge';
import type { SkillRepositoryPort } from '../../skills';
import type { HitlGateRepositoryPort, ReviewerGroupRepositoryPort } from '../../hitl';
import type { DeploymentConfigRecord, DeploymentConfigRepositoryPort } from '../domain/ports';
import { buildSingleLlmNodeGraph } from '../domain/agent-config';
import { ValidateConfigUseCase } from './validate-config.use-case';
import { SaveConfigUseCase } from './save-config.use-case';

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

function makeConfig(overrides: Partial<DeploymentConfigRecord> = {}): DeploymentConfigRecord {
  return {
    id: 'config-1',
    tenantId: 'tenant-1',
    yamlText: '',
    status: 'draft',
    providers: { transport: null, stt: null, llm: null, llmFallback: null, tts: null, avatar: null },
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedBy: null,
    publishedAt: null,
    structured: {},
    pendingRollbackFromVersionId: null,
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

describe('SaveConfigUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let configs: jest.Mocked<DeploymentConfigRepositoryPort>;
  let definitions: jest.Mocked<ProviderDefinitionRepositoryPort>;
  let credentials: jest.Mocked<ProviderCredentialRepositoryPort>;
  let useCase: SaveConfigUseCase;
  const actor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };
  const ifMatch = '2026-01-01T00:00:00.000Z';

  beforeEach(() => {
    tenants = {
      create: jest.fn(),
      findById: jest.fn(),
      findBySlug: jest.fn(),
      count: jest.fn(),
      list: jest.fn(),
      updateName: jest.fn(),
      updateStatus: jest.fn(),
    };
    configs = { findByTenantId: jest.fn(), save: jest.fn() };
    definitions = {
      list: jest.fn().mockResolvedValue([
        def({ key: 'livekit', category: 'transport', hosting: 'self_hosted', interfaceName: 'ITransportProvider' }),
        def({ key: 'deepgram', category: 'stt', hosting: 'self_hosted', interfaceName: 'ISTTProvider' }),
        def({ key: 'openai', category: 'llm', hosting: 'remote' }),
        def({ key: 'fish-speech', category: 'tts', hosting: 'self_hosted', interfaceName: 'ITTSProvider' }),
        def({ key: 'bithuman', category: 'avatar', hosting: 'self_hosted', interfaceName: 'IAvatarProvider' }),
      ]),
      findByKey: jest.fn(),
      countEnabledInCategory: jest.fn(),
      setEnabled: jest.fn(),
    };
    credentials = {
      create: jest.fn(),
      findById: jest.fn(),
      findByLabel: jest.fn(),
      list: jest.fn().mockResolvedValue(
        ['livekit', 'deepgram', 'openai', 'fish-speech', 'bithuman'].map((providerKey) => ({
          id: `cred-${providerKey}`,
          tenantId: 'tenant-1',
          providerKey,
          displayLabel: 'default',
          endpointUrl: 'https://example.com',
          credentialRef: `secrets/${providerKey}`,
          extra: {},
          lastProbeStatus: 'unknown' as const,
          lastProbeAt: null,
          lastProbeError: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      ),
      listAllActive: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      recordProbeResult: jest.fn(),
    };
    const tools: jest.Mocked<ToolDefinitionRepositoryPort> = {
      listByTenant: jest.fn().mockResolvedValue([]),
      listEnabledByApiRefs: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      findByApiRef: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    const knowledgeSources: jest.Mocked<KnowledgeSourceRepositoryPort> = {
      create: jest.fn(),
      findById: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      delete: jest.fn(),
    };
    const skills: jest.Mocked<SkillRepositoryPort> = {
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
    const hitlGates: jest.Mocked<HitlGateRepositoryPort> = {
      listByTenant: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      findByIdAnyTenant: jest.fn(),
      findByAttachment: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    const reviewerGroups: jest.Mocked<ReviewerGroupRepositoryPort> = {
      listByTenant: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      findByName: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    useCase = new SaveConfigUseCase(
      tenants,
      configs,
      new ValidateConfigUseCase(definitions, credentials, tenants, tools, knowledgeSources, skills, hitlGates, reviewerGroups, configs),
    );
    tenants.findById.mockResolvedValue(makeTenant());
  });

  const validConfig = {
    version: 1,
    transport: { provider: 'livekit' },
    stt: { provider: 'deepgram', language: 'en-US' },
    reasoning: buildSingleLlmNodeGraph({ provider: 'openai', model: 'gpt-4o' }),
    tts: { provider: 'fish-speech', voice_id: 'v1' },
    avatar: { provider: 'bithuman', avatar_id: 'a1' },
    agent: { runtime: 'langgraph', system_prompt: 'hi', tools: [], memory: { enabled: true, window_turns: 16 }, rag: { enabled: false } },
    privacy: { send_to_remote_llm: 'prompt_text_only', retain_transcripts_days: 90, recordings_enabled: false },
    alerts: { degraded_mode_message: 'hold on' },
  };

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(
      useCase.execute(actor, 'tenant-1', { config: validConfig, save_as: 'draft' }, ifMatch),
    ).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('403s an unassigned admin', async () => {
    const unassigned = { ...actor, roles: ['admin'], tenantIds: ['other'] };
    await expect(
      useCase.execute(unassigned, 'tenant-1', { config: validConfig, save_as: 'draft' }, ifMatch),
    ).rejects.toMatchObject({ code: 'TENANT_FORBIDDEN' });
  });

  it('never persists a document with a raw secret, even as a draft', async () => {
    await expect(
      useCase.execute(
        actor,
        'tenant-1',
        { config: { version: 1, stt: { provider: 'deepgram', api_key: 'sk-secret' } }, save_as: 'draft' },
        ifMatch,
      ),
    ).rejects.toMatchObject({ code: 'CONFIG_SECRET_IN_YAML', httpStatus: 400 });
    expect(configs.save).not.toHaveBeenCalled();
  });

  it('persists an incomplete draft (422-shaped gaps are allowed to persist)', async () => {
    configs.save.mockResolvedValue(makeConfig());
    await useCase.execute(actor, 'tenant-1', { config: { version: 1 }, save_as: 'draft' }, ifMatch);
    expect(configs.save).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ status: 'draft' }),
      new Date(ifMatch),
    );
  });

  it('rejects publishing an incomplete config with a 422 combination code', async () => {
    await expect(
      useCase.execute(actor, 'tenant-1', { config: { version: 1 }, save_as: 'published' }, ifMatch),
    ).rejects.toMatchObject({ code: 'CONFIG_INCOMPLETE', httpStatus: 422 });
    expect(configs.save).not.toHaveBeenCalled();
  });

  it('publishes Example-A-shaped valid config and stamps published_at', async () => {
    configs.save.mockResolvedValue(makeConfig({ status: 'published', publishedAt: new Date() }));
    await useCase.execute(actor, 'tenant-1', { config: validConfig, save_as: 'published' }, ifMatch);
    expect(configs.save).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        status: 'published',
        providers: expect.objectContaining({ transport: 'livekit', llm: 'openai', tts: 'fish-speech', avatar: 'bithuman' }),
        publishedAt: expect.any(Date),
      }),
      new Date(ifMatch),
    );
  });

  it('overwrites deployment.tenant_id/name and transport.room_namespace from the tenant row regardless of input', async () => {
    tenants.findById.mockResolvedValue(makeTenant({ id: 'tenant-1', slug: 'acme-slug', name: 'Real Name' }));
    configs.save.mockResolvedValue(makeConfig());
    await useCase.execute(
      actor,
      'tenant-1',
      { config: { ...validConfig, deployment: { tenant_id: 'someone-elses-id', name: 'Spoofed' }, transport: { provider: 'livekit', room_namespace: 'spoofed-namespace' } }, save_as: 'draft' },
      ifMatch,
    );
    const savedYaml = (configs.save.mock.calls[0][1] as { yamlText: string }).yamlText;
    expect(savedYaml).toContain('tenant-1');
    expect(savedYaml).toContain('acme-slug');
    expect(savedYaml).not.toContain('spoofed-namespace');
  });

  it('409s on a malformed If-Match', async () => {
    await expect(
      useCase.execute(actor, 'tenant-1', { config: validConfig, save_as: 'draft' }, 'not-a-date'),
    ).rejects.toMatchObject({ code: 'CONFIG_CONFLICT', httpStatus: 409 });
  });

  it('409s on a stale If-Match', async () => {
    configs.save.mockResolvedValue('conflict');
    await expect(
      useCase.execute(actor, 'tenant-1', { config: validConfig, save_as: 'draft' }, ifMatch),
    ).rejects.toMatchObject({ code: 'CONFIG_CONFLICT', httpStatus: 409 });
  });
});
