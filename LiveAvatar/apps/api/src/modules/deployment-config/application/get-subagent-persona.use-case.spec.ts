import type { ToolDefinitionRepositoryPort } from '../../tools';
import type { DeploymentConfigRepositoryPort, DeploymentConfigRecord } from '../domain/ports';
import { GetSubAgentPersonaUseCase } from './get-subagent-persona.use-case';

function makeConfig(overrides: Partial<DeploymentConfigRecord> = {}): DeploymentConfigRecord {
  return {
    id: 'config-1',
    tenantId: 'tenant-b',
    yamlText: '',
    status: 'published',
    providers: {},
    updatedAt: new Date(),
    updatedBy: null,
    publishedAt: new Date(),
    structured: { agent: { system_prompt: 'You are a billing specialist.', tools: [{ name: 'Refund', api_ref: 'refund-api', enabled: true }] } },
    ...overrides,
  } as DeploymentConfigRecord;
}

describe('GetSubAgentPersonaUseCase', () => {
  let configs: jest.Mocked<DeploymentConfigRepositoryPort>;
  let toolDefs: jest.Mocked<ToolDefinitionRepositoryPort>;
  let useCase: GetSubAgentPersonaUseCase;

  beforeEach(() => {
    configs = {
      findByTenantId: jest.fn().mockResolvedValue(makeConfig()),
      save: jest.fn(),
    };
    toolDefs = {
      listByTenant: jest.fn(),
      listEnabledByApiRefs: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      findByApiRef: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    useCase = new GetSubAgentPersonaUseCase(configs, toolDefs);
  });

  it('404s when the target tenant has no config at all', async () => {
    configs.findByTenantId.mockResolvedValue(null);
    await expect(useCase.execute('tenant-b')).rejects.toMatchObject({ code: 'CONFIG_SUBAGENT_TENANT_UNKNOWN' });
  });

  it('404s when the target tenant has a draft-only (unpublished) config', async () => {
    configs.findByTenantId.mockResolvedValue(makeConfig({ status: 'draft' }));
    await expect(useCase.execute('tenant-b')).rejects.toMatchObject({ code: 'CONFIG_SUBAGENT_TENANT_UNKNOWN' });
  });

  it('returns the published system prompt and resolves enabled tool definitions', async () => {
    toolDefs.listEnabledByApiRefs.mockResolvedValue([
      { id: 't1', tenantId: 'tenant-b', apiRef: 'refund-api', name: 'Refund', description: 'Issue a refund', method: 'POST', url: 'https://x.example.com', credentialRef: null, requiresCredential: false, argsSchema: {}, enabled: true, consequential: false, autonomousUseAckText: null, lane: 'foreground', perSessionCap: null, perTurnCap: null, timeoutMs: 10000, createdAt: new Date(), updatedAt: new Date() },
    ]);

    const result = await useCase.execute('tenant-b');

    expect(configs.findByTenantId).toHaveBeenCalledWith('tenant-b');
    expect(toolDefs.listEnabledByApiRefs).toHaveBeenCalledWith('tenant-b', ['refund-api']);
    expect(result).toEqual({
      tenant_id: 'tenant-b',
      system_prompt: 'You are a billing specialist.',
      tool_definitions: [
        { api_ref: 'refund-api', name: 'Refund', description: 'Issue a refund', method: 'POST', url: 'https://x.example.com', credential_ref: undefined, args_schema: {} },
      ],
    });
  });

  it('skips the tool-definitions fetch entirely when no tools are enabled', async () => {
    configs.findByTenantId.mockResolvedValue(makeConfig({ structured: { agent: { system_prompt: 'Hi', tools: [] } } }));
    const result = await useCase.execute('tenant-b');
    expect(toolDefs.listEnabledByApiRefs).not.toHaveBeenCalled();
    expect(result.tool_definitions).toEqual([]);
  });

  it('excludes a disabled tool from the resolved persona', async () => {
    configs.findByTenantId.mockResolvedValue(
      makeConfig({ structured: { agent: { system_prompt: 'Hi', tools: [{ name: 'Refund', api_ref: 'refund-api', enabled: false }] } } }),
    );
    await useCase.execute('tenant-b');
    expect(toolDefs.listEnabledByApiRefs).not.toHaveBeenCalled();
  });
});
