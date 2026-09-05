import { Injectable, Logger } from '@nestjs/common';
import type { ToolDefinitionRecord } from '../domain/tool-definition';
import type { TestInvokeResult } from '../domain/test-invoke-result';
import type { ToolInvokerPort } from '../domain/ports';

/**
 * Untrusted-response cap (FR-AGENT-5) — matches
 * `apps/agent/src/avatar_agent/orchestration/tools.py`'s `_MAX_RESPONSE_BYTES`
 * exactly, so a test-invoke in the builder shows the same truncation the live
 * runtime would apply.
 */
const MAX_RESPONSE_BYTES = 32 * 1024;

/**
 * NestJS re-implementation of `ToolExecutor.invoke()` (Python) for the
 * synchronous admin-initiated "Test" action (BL-033). Per
 * `docs/v2/ARCHITECTURE_NOTES.md` §6.3's precedent for a deferred-tool
 * invoker, this is not bound by ADR-001's vendor-SDK-isolation rule — it is
 * a plain HTTP call, not a vendor SDK.
 *
 * Never resolves a real secret for `Authorization`: the control plane does
 * not hold resolved credential values (only the live agent process does,
 * from its own `SECRETS_DIR` mount — see `GetRuntimeConfigUseCase`'s
 * docstring). A tool with `credential_ref` set is therefore invoked
 * unauthenticated and the result flags `credentialUnresolved: true` so the
 * admin UI can explain a resulting 401/403 rather than mislabel it a defect.
 */
@Injectable()
export class ToolInvokerService implements ToolInvokerPort {
  private readonly logger = new Logger(ToolInvokerService.name);

  /**
   * @param tool - Resolved `ToolDefinition` row
   * @param args - Sample JSON arguments for the call body
   */
  async invoke(tool: ToolDefinitionRecord, args: Record<string, unknown>): Promise<TestInvokeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), tool.timeoutMs);
    const startedAt = Date.now();
    const hasBody = tool.method !== 'GET' && tool.method !== 'DELETE';

    try {
      const response = await fetch(tool.url, {
        method: tool.method,
        signal: controller.signal,
        headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
        body: hasBody ? JSON.stringify(args) : undefined,
      });
      const durationMs = Date.now() - startedAt;
      const buffer = await response.arrayBuffer();
      const bytes = Buffer.from(buffer);
      const truncated = bytes.byteLength > MAX_RESPONSE_BYTES;
      const body = (truncated ? bytes.subarray(0, MAX_RESPONSE_BYTES) : bytes).toString('utf-8');

      return {
        ok: response.ok,
        status: response.status,
        durationMs,
        body,
        truncated,
        credentialUnresolved: Boolean(tool.credentialRef),
      };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      this.logger.warn(`${isAbort ? 'TOOL_TIMEOUT' : 'TOOL_HTTP_ERROR'} api_ref=${tool.apiRef}`);
      return {
        ok: false,
        durationMs,
        errorCode: isAbort ? 'TOOL_TIMEOUT' : 'TOOL_HTTP_ERROR',
        credentialUnresolved: Boolean(tool.credentialRef),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
