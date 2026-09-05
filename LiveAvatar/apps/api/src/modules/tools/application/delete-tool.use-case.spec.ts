import type { TenantRepositoryPort } from '../../tenants';
import type { ToolDefinitionRepositoryPort } from '../domain/ports';
import type { ToolDefinitionRecord } from '../domain/tool-definition';
import { DeleteToolUseCase } from './delete-tool.use-case';

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

describe('DeleteToolUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let tools: jest.Mocked<ToolDefinitionRepositoryPort>;
  let useCase: DeleteToolUseCase;
  const actor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };

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
    useCase = new DeleteToolUseCase(tenants, tools);
  });

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'tool-1')).rejects.toMatchObject({
      code: 'TENANT_NOT_FOUND',
    });
  });

  it('403s an admin not assigned to the tenant', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    const unassigned = { ...actor, roles: ['admin'], tenantIds: ['other-tenant'] };
    await expect(useCase.execute(unassigned, 'tenant-1', 'tool-1')).rejects.toMatchObject({
      code: 'TENANT_FORBIDDEN',
    });
  });

  it('404s an unknown tool', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    tools.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'tool-1')).rejects.toMatchObject({ code: 'TOOL_NOT_FOUND' });
  });

  it('deletes the tool', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    tools.findById.mockResolvedValue(makeToolRecord());
    tools.delete.mockResolvedValue(true);
    await useCase.execute(actor, 'tenant-1', 'tool-1');
    expect(tools.delete).toHaveBeenCalledWith('tenant-1', 'tool-1');
  });
});
