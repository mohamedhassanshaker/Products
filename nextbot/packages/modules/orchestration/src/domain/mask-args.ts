/**
 * Security review stub (this dispatch) for the eventual PII masking context matrix
 * (`pii/application/masker.ts`, full authoring UI BL-10/Phase 17): a deliberately
 * simple key-name-based redaction applied to tool-call arguments before they are
 * written into any log-shaped record (`domain_event.payload`, `tool_call.input_args`
 * in a later phase) — never applied at the point args are sent to the MCP server
 * itself, only at the persistence/observability boundary. Supersede this with the
 * real masking-context matrix once BL-10 lands; until then this is the one masking
 * gate every failure-path log in this module goes through, so nothing here is a
 * silent bypass waiting to be found in a later security review.
 */
const SENSITIVE_KEY_PATTERN = /password|secret|token|ssn|ccnum|card|otp|pin\b/i;

export function maskArgsForLogging(args: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      masked[key] = "***MASKED***";
    } else if (typeof value === "string" && value.length > 200) {
      masked[key] = `${value.slice(0, 40)}…(truncated)`;
    } else {
      masked[key] = value;
    }
  }
  return masked;
}
