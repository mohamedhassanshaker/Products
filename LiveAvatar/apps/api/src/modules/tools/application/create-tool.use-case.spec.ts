import type { TenantRepositoryPort } from '../../tenants';
import type { ToolDefinitionRepositoryPort } from '../domain/ports';
import type { ToolDefinitionRecord } from '../domain/tool-definition';
import { CreateToolUseCase } from './create-tool.use-case';

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

describe('CreateToolUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let tools: jest.Mocked<ToolDefinitionRepositoryPort>;
  let useCase: CreateToolUseCase;
  const actor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };
  const baseInput = { name: 'Lookup order', method: 'GET' as const, url: 'https://api.example.com/orders' };

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
    useCase = new CreateToolUseCase(tenants, tools);
  });

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', baseInput)).rejects.toMatchObject({
      code: 'TENANT_NOT_FOUND',
    });
  });

  it('403s an admin not assigned to the tenant', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    const unassigned = { ...actor, roles: ['admin'], tenantIds: ['other-tenant'] };
    await expect(useCase.execute(unassigned, 'tenant-1', baseInput)).rejects.toMatchObject({
      code: 'TENANT_FORBIDDEN',
    });
  });

  it('rejects an empty name', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    await expect(useCase.execute(actor, 'tenant-1', { ...baseInput, name: '  ' })).rejects.toMatchObject({
      code: 'TOOL_NAME_REQUIRED',
    });
  });

  it('rejects a non-https url', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    await expect(
      useCase.execute(actor, 'tenant-1', { ...baseInput, url: 'http://api.example.com' }),
    ).rejects.toMatchObject({ code: 'TOOL_URL_INVALID' });
  });

  it('rejects requires_credential: true with no credential_ref', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    await expect(
      useCase.execute(actor, 'tenant-1', { ...baseInput, requires_credential: true }),
    ).rejects.toMatchObject({ code: 'TOOL_CREDENTIAL_MISSING' });
    expect(tools.create).not.toHaveBeenCalled();
  });

  it('derives api_ref from the name when not supplied', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    tools.findByApiRef.mockResolvedValue(null);
    tools.create.mockResolvedValue(makeToolRecord());

    await useCase.execute(actor, 'tenant-1', baseInput);

    expect(tools.findByApiRef).toHaveBeenCalledWith('tenant-1', 'lookup_order');
    expect(tools.create).toHaveBeenCalledWith(expect.objectContaining({ apiRef: 'lookup_order' }));
  });

  it('uses a caller-supplied api_ref verbatim', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    tools.findByApiRef.mockResolvedValue(null);
    tools.create.mockResolvedValue(makeToolRecord({ apiRef: 'custom_ref' }));

    await useCase.execute(actor, 'tenant-1', { ...baseInput, api_ref: 'custom_ref' });

    expect(tools.create).toHaveBeenCalledWith(expect.objectContaining({ apiRef: 'custom_ref' }));
  });

  it('rejects a duplicate api_ref for the tenant', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    tools.findByApiRef.mockResolvedValue(makeToolRecord());
    await expect(useCase.execute(actor, 'tenant-1', baseInput)).rejects.toMatchObject({
      code: 'TOOL_API_REF_EXISTS',
      httpStatus: 409,
    });
  });

  it('creates a tool with the given defaults applied', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    tools.findByApiRef.mockResolvedValue(null);
    tools.create.mockResolvedValue(makeToolRecord());

    const result = await useCase.execute(actor, 'tenant-1', baseInput);

    expect(tools.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        name: 'Lookup order',
        enabled: true,
        consequential: false,
        autonomousUseAckText: null,
        lane: 'foreground',
        timeoutMs: 10000,
      }),
    );
    expect(result).toMatchObject({ id: 'tool-1', api_ref: 'lookup_order' });
  });
});
