import type { TenantRepositoryPort } from '../../tenants';
import type { ToolDefinitionRepositoryPort } from '../domain/ports';
import type { ToolDefinitionRecord } from '../domain/tool-definition';
import { UpdateToolUseCase } from './update-tool.use-case';

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

function makeToolRecord(overrides: Partial<ToolDefinitionRecord> = {}): ToolDefinitionRecord {
  return {
    id: 'tool-1',
    tenantId: 'tenant-1',
    apiRef: 'lookup_order',
    name: 'Lookup order',
    description: null,
    method: 'GET',
    url: 'https://api.example.com/orders',
    credentialRef: null,
    requiresCredential: false,
    argsSchema: {},
    enabled: true,
    consequential: false,
    autonomousUseAckText: null,
    lane: 'foreground',
    perSessionCap: null,
    perTurnCap: null,
    timeoutMs: 10000,
    createdAt: new Date(),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('UpdateToolUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let tools: jest.Mocked<ToolDefinitionRepositoryPort>;
  let useCase: UpdateToolUseCase;
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
    tools = {
      listByTenant: jest.fn(),
      listEnabledByApiRefs: jest.fn(),
      findById: jest.fn(),
      findByApiRef: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    useCase = new UpdateToolUseCase(tenants, tools);
  });

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'tool-1', {}, ifMatch)).rejects.toMatchObject({
      code: 'TENANT_NOT_FOUND',
    });
  });

  it('404s an unknown tool', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    tools.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'tool-1', {}, ifMatch)).rejects.toMatchObject({
      code: 'TOOL_NOT_FOUND',
    });
  });

  it('rejects an invalid If-Match value as a conflict', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    tools.findById.mockResolvedValue(makeToolRecord());
    await expect(useCase.execute(actor, 'tenant-1', 'tool-1', {}, 'not-a-date')).rejects.toMatchObject({
      code: 'CONFIG_CONFLICT',
    });
  });

  it('rejects turning on requires_credential without a credential_ref, using the merged result', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    tools.findById.mockResolvedValue(makeToolRecord({ credentialRef: null, requiresCredential: false }));
    await expect(
      useCase.execute(actor, 'tenant-1', 'tool-1', { requires_credential: true }, ifMatch),
    ).rejects.toMatchObject({ code: 'TOOL_CREDENTIAL_MISSING' });
    expect(tools.update).not.toHaveBeenCalled();
  });

  it('allows requires_credential: true when the existing row already has a credential_ref', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    tools.findById.mockResolvedValue(makeToolRecord({ credentialRef: 'secrets/x', requiresCredential: false }));
    tools.update.mockResolvedValue(makeToolRecord({ credentialRef: 'secrets/x', requiresCredential: true }));

    await useCase.execute(actor, 'tenant-1', 'tool-1', { requires_credential: true }, ifMatch);

    expect(tools.update).toHaveBeenCalledWith(
      'tenant-1',
      'tool-1',
      { requiresCredential: true },
      new Date(ifMatch),
    );
  });

  it('propagates a repository conflict as CONFIG_CONFLICT', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    tools.findById.mockResolvedValue(makeToolRecord());
    tools.update.mockResolvedValue('conflict');
    await expect(
      useCase.execute(actor, 'tenant-1', 'tool-1', { name: 'New name' }, ifMatch),
    ).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });
  });

  it('rejects a non-https url on update', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    tools.findById.mockResolvedValue(makeToolRecord());
    await expect(
      useCase.execute(actor, 'tenant-1', 'tool-1', { url: 'http://api.example.com' }, ifMatch),
    ).rejects.toMatchObject({ code: 'TOOL_URL_INVALID' });
  });

  it('updates only the supplied fields', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    tools.findById.mockResolvedValue(makeToolRecord());
    tools.update.mockResolvedValue(makeToolRecord({ name: 'Renamed' }));

    const result = await useCase.execute(actor, 'tenant-1', 'tool-1', { name: 'Renamed' }, ifMatch);

    expect(tools.update).toHaveBeenCalledWith('tenant-1', 'tool-1', { name: 'Renamed' }, new Date(ifMatch));
    expect(result).toMatchObject({ name: 'Renamed' });
  });
});
