import type { ToolInvocation, ToolResult } from "@nextbot/contracts";

/**
 * The Data-Plane <-> Gateway-Plane egress port (ADR-0004, LLD §2.2/§2.3): the
 * `orchestration` module has **no outbound network egress of its own** — every MCP
 * tool call crosses this port into `apps/gateway`'s `mcp-egress` implementation
 * (`apps/gateway/src/lib/mcp-egress.ts`), which does the PEP re-check, credential
 * vault decryption, and the actual `@nextbot/mcp-client` call. `orchestration` only
 * ever depends on this interface — never on `@nextbot/mcp-client` directly, which
 * stays scoped to `apps/gateway` (the Ajv-in-mcp-client convention).
 */
export interface EgressPort {
  invokeTool(invocation: ToolInvocation): Promise<ToolResult>;
}
