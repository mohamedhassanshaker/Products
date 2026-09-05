/**
 * Domain-shaped test-invoke outcome (kept separate from the wire
 * `TestInvokeToolResultDto` so this layer never imports `@liveavatar/contracts`
 * — mapped to the DTO in `application/tool-dto.ts`).
 */
export interface TestInvokeResult {
  ok: boolean;
  status?: number;
  durationMs: number;
  body?: string;
  truncated?: boolean;
  errorCode?: 'TOOL_TIMEOUT' | 'TOOL_HTTP_ERROR';
  credentialUnresolved: boolean;
}
