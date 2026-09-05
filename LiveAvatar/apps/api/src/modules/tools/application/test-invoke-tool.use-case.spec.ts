import type { TenantRepositoryPort } from '../../tenants';
import type { ToolDefinitionRepositoryPort, ToolInvokerPort } from '../domain/ports';
import type { ToolDefinitionRecord } from '../domain/tool-definition';
import { TestInvokeToolUseCase } from './test-invoke-tool.use-case';

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

describe('TestInvokeToolUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let tools: jest.Mocked<ToolDefinitionRepositoryPort>;
  let invoker: jest.Mocked<ToolInvokerPort>;
  let useCase: TestInvokeToolUseCase;
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
    invoker = { invoke: jest.fn() };
    useCase = new TestInvokeToolUseCase(tenants, tools, invoker);
  });

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'tool-1', {})).rejects.toMatchObject({
      code: 'TENANT_NOT_FOUND',
    });
  });

  it('404s an unknown tool', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    tools.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'tool-1', {})).rejects.toMatchObject({
      code: 'TOOL_NOT_FOUND',
    });
  });

  it('invokes the tool and maps a success result to the wire DTO', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    tools.findById.mockResolvedValue(makeToolRecord());
    invoker.invoke.mockResolvedValue({
      ok: true,
      status: 200,
      durationMs: 120,
      body: '{"ok":true}',
      truncated: false,
      credentialUnresolved: false,
    });

    const result = await useCase.execute(actor, 'tenant-1', 'tool-1', { arguments: { order_id: '4821' } });

    expect(invoker.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tool-1', apiRef: 'lookup_order' }),
      { order_id: '4821' },
    );
    expect(result).toEqual({
      ok: true,
      status: 200,
      duration_ms: 120,
      body: '{"ok":true}',
      truncated: false,
      error_code: undefined,
      credential_unresolved: false,
    });
  });

  it('maps a timeout to a non-throwing ok:false result', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    tools.findById.mockResolvedValue(makeToolRecord());
    invoker.invoke.mockResolvedValue({
      ok: false,
      durationMs: 10000,
      errorCode: 'TOOL_TIMEOUT',
      credentialUnresolved: false,
    });

    const result = await useCase.execute(actor, 'tenant-1', 'tool-1', {});

    expect(result.ok).toBe(false);
    expect(result.error_code).toBe('TOOL_TIMEOUT');
  });

  it('defaults arguments to {} when omitted', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    tools.findById.mockResolvedValue(makeToolRecord());
    invoker.invoke.mockResolvedValue({ ok: true, durationMs: 5, credentialUnresolved: false });

    await useCase.execute(actor, 'tenant-1', 'tool-1', {});

    expect(invoker.invoke).toHaveBeenCalledWith(expect.anything(), {});
  });
});
