import { ToolInvokerService } from './tool-invoker.service';
import type { ToolDefinitionRecord } from '../domain/tool-definition';

function makeTool(overrides: Partial<ToolDefinitionRecord> = {}): ToolDefinitionRecord {
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
    updatedAt: new Date(),
    ...overrides,
  };
}

function jsonResponse(body: string, status = 200): Response {
  return {
    ok: status < 400,
    status,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response;
}

describe('ToolInvokerService', () => {
  const service = new ToolInvokerService();
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns ok:true with the response body for a successful call', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse('{"order_id":"4821"}')) as unknown as typeof fetch;

    const result = await service.invoke(makeTool(), {});

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toBe('{"order_id":"4821"}');
    expect(result.truncated).toBe(false);
  });

  it('never sends a body/Content-Type for GET', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse('{}'));
    global.fetch = fetchMock as unknown as typeof fetch;

    await service.invoke(makeTool({ method: 'GET' }), { ignored: true });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
  });

  it('sends a JSON body and Content-Type for POST', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse('{}'));
    global.fetch = fetchMock as unknown as typeof fetch;

    await service.invoke(makeTool({ method: 'POST' }), { order_id: '4821' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(JSON.stringify({ order_id: '4821' }));
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('truncates a response body over 32 KiB and flags truncated', async () => {
    const big = 'x'.repeat(40 * 1024);
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(big)) as unknown as typeof fetch;

    const result = await service.invoke(makeTool(), {});

    expect(result.truncated).toBe(true);
    expect(result.body?.length).toBe(32 * 1024);
  });

  it('flags credential_unresolved when the tool declares a credential_ref', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse('{}')) as unknown as typeof fetch;
    const result = await service.invoke(makeTool({ credentialRef: 'secrets/x' }), {});
    expect(result.credentialUnresolved).toBe(true);
  });

  it('does not flag credential_unresolved when the tool has no credential_ref', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse('{}')) as unknown as typeof fetch;
    const result = await service.invoke(makeTool({ credentialRef: null }), {});
    expect(result.credentialUnresolved).toBe(false);
  });

  it('maps an AbortError to TOOL_TIMEOUT without throwing', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(abortError) as unknown as typeof fetch;

    const result = await service.invoke(makeTool(), {});

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('TOOL_TIMEOUT');
  });

  it('maps a network failure to TOOL_HTTP_ERROR without throwing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

    const result = await service.invoke(makeTool(), {});

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('TOOL_HTTP_ERROR');
  });
});
