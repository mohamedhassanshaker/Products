import { Type, type Static } from "@sinclair/typebox";

/**
 * Phase 12 (BL-05) — the `ToolInvocation`/`ToolResult` contract carried over the
 * `orchestration` module's `ports/egress.ts` port into `apps/gateway`'s `mcp-egress`
 * (LLD §2.2/ADR-0004: `apps/runtime`/orchestration has no outbound network egress;
 * everything crosses this port). Kept in `@nextbot/contracts` (not private to either
 * side) so both the Data Plane caller and the Gateway Plane implementer type-check
 * against the same shape.
 */
export const ToolInvocationSchema = Type.Object({
  toolCallId: Type.String({ minLength: 1 }),
  tenantId: Type.String({ minLength: 1 }),
  toolId: Type.String({ minLength: 1 }),
  connectorId: Type.String({ minLength: 1 }),
  toolName: Type.String({ minLength: 1 }),
  args: Type.Record(Type.String(), Type.Unknown()),
  /** Server-generated (LLD §6.3) — never derivable/guessable by a client. Injected
   * into the outbound MCP arguments at egress when the tool supports it. */
  idempotencyKey: Type.String({ minLength: 1 }),
});
export type ToolInvocation = Static<typeof ToolInvocationSchema>;

/**
 * `ToolResult` — the outcome of one egress attempt. `Denied` covers the PEP
 * re-check at egress failing even though upstream selection already filtered by
 * policy (defense in depth, LLD §5 failure branches / FR-SEC-06); `Failed` covers a
 * transport/validation failure from the MCP server itself.
 */
export const ToolResultSchema = Type.Union([
  Type.Object({ outcome: Type.Literal("Succeeded"), output: Type.Unknown() }),
  Type.Object({ outcome: Type.Literal("Denied"), reason: Type.String() }),
  Type.Object({ outcome: Type.Literal("Failed"), errorMessage: Type.String() }),
]);
export type ToolResult = Static<typeof ToolResultSchema>;
