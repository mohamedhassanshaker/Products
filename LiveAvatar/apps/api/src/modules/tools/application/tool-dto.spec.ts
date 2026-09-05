import type { ToolDefinitionRecord } from '../domain/tool-definition';
import { toTestInvokeResultDto, toToolDto } from './tool-dto';

describe('toToolDto', () => {
  it('maps every field, including the Phase 8 additions', () => {
    const record: ToolDefinitionRecord = {
      id: 'tool-1',
      tenantId: 'tenant-1',
      apiRef: 'lookup_order',
      name: 'Lookup order',
      description: 'Looks up an order by id',
      method: 'GET',
      url: 'https://api.example.com/orders',
      credentialRef: 'secrets/orders',
      requiresCredential: true,
      argsSchema: { type: 'object' },
      enabled: true,
      consequential: true,
      autonomousUseAckText: 'Reviewed and accepted by ops on 2026-01-01.',
      lane: 'background',
      perSessionCap: 5,
      perTurnCap: 1,
      timeoutMs: 8000,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };

    expect(toToolDto(record)).toEqual({
      id: 'tool-1',
      tenant_id: 'tenant-1',
      api_ref: 'lookup_order',
      name: 'Lookup order',
      description: 'Looks up an order by id',
      method: 'GET',
      url: 'https://api.example.com/orders',
      credential_ref: 'secrets/orders',
      requires_credential: true,
      args_schema: { type: 'object' },
      enabled: true,
      consequential: true,
      autonomous_use_ack_text: 'Reviewed and accepted by ops on 2026-01-01.',
      lane: 'background',
      per_session_cap: 5,
      per_turn_cap: 1,
      timeout_ms: 8000,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    });
  });
});

describe('toTestInvokeResultDto', () => {
  it('maps a domain result to the wire DTO', () => {
    expect(
      toTestInvokeResultDto({
        ok: true,
        status: 200,
        durationMs: 42,
        body: '{}',
        truncated: false,
        credentialUnresolved: true,
      }),
    ).toEqual({
      ok: true,
      status: 200,
      duration_ms: 42,
      body: '{}',
      truncated: false,
      error_code: undefined,
      credential_unresolved: true,
    });
  });
});
