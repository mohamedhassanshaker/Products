import type { TestInvokeToolResultDto, ToolDto } from '@liveavatar/contracts';
import type { ToolDefinitionRecord } from '../domain/tool-definition';
import type { TestInvokeResult } from '../domain/test-invoke-result';

/** Maps a `ToolDefinition` record to its wire DTO. */
export function toToolDto(record: ToolDefinitionRecord): ToolDto {
  return {
    id: record.id,
    tenant_id: record.tenantId,
    api_ref: record.apiRef,
    name: record.name,
    description: record.description,
    method: record.method,
    url: record.url,
    credential_ref: record.credentialRef,
    requires_credential: record.requiresCredential,
    args_schema: record.argsSchema,
    enabled: record.enabled,
    consequential: record.consequential,
    autonomous_use_ack_text: record.autonomousUseAckText,
    lane: record.lane,
    per_session_cap: record.perSessionCap,
    per_turn_cap: record.perTurnCap,
    timeout_ms: record.timeoutMs,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

/** Maps a domain test-invoke result to its wire DTO. */
export function toTestInvokeResultDto(result: TestInvokeResult): TestInvokeToolResultDto {
  return {
    ok: result.ok,
    status: result.status,
    duration_ms: result.durationMs,
    body: result.body,
    truncated: result.truncated,
    error_code: result.errorCode,
    credential_unresolved: result.credentialUnresolved,
  };
}
