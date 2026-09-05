import { validateAgainstJsonSchema } from "@nextbot/mcp-client";
import { findCurrentSchemaVersion, findToolById } from "@nextbot/tool-registry";
import type { TenantContext } from "@nextbot/db";
import type { ToolInvocation, ToolResult } from "@nextbot/contracts";

/**
 * **The non-executing egress port** (Target Architecture Blueprint Phase 17, BL-48,
 * ADR-0019 §2.5's first containment, LLD §15.5).
 *
 * A shadow run replays a candidate agent version against real customer conversations
 * through the **real** `runTurnPipeline`. That is the whole point — a lighter simulation
 * would not be evidence about anything — but it means the candidate's model output can ask
 * for any tool in the tenant's registry, including a Tier-1 write tool against a real
 * customer system. This port is what makes honouring that request impossible.
 *
 * **Why this rather than a "read-only tool" mode.** The rejected alternative (ADR-0019 §3)
 * was to let the shadow call real MCP servers but only "safe" tools. That requires the
 * platform to correctly classify every tool in every tenant's registry as read-only,
 * forever, including third-party MCP servers whose semantics it cannot inspect — and a
 * single misclassification is a real write against a real customer system. A port that
 * performs no I/O at all needs no classification to be correct, and has no failure mode
 * of that shape.
 *
 * **Why it is structural, not conventional.** `EgressPort` is the only route out of
 * `orchestration` (ADR-0004). Phase 17 made that literally true rather than merely stated:
 * `.dependency-cruiser.cjs` now carries `no-mcp-client-inside-orchestration` **and**
 * `no-mcp-egress-impl-inside-orchestration` (the second closes the transitive door through
 * `tool-registry`, which is where the real egress implementation has lived since Phase 16).
 * With both in place, a shadow turn cannot reach an MCP server no matter what the model
 * decides, and a future change that tried to open its own connection fails the lint gate
 * rather than shipping.
 *
 * **What it still does.** It validates the invocation against the tool's real, discovered
 * input schema, so "the candidate would have called `issue_refund` with a malformed
 * `amount`" is still a finding rather than a silent success. Only the network call is
 * removed.
 */

/** The synthetic output every shadow tool invocation returns in place of a real result.
 *  Deliberately self-describing: if this value ever leaked into something customer-facing
 *  it would be unmistakable rather than plausible. */
export const SHADOW_NOT_EXECUTED = "ShadowNotExecuted" as const;

/**
 * Builds a shadow `EgressPort` for one tenant.
 *
 * Structurally identical to `orchestration`'s `EgressPort` (a one-method interface),
 * declared structurally here for the same reason `tool-registry`'s `McpEgressPort` is:
 * neither needs an `orchestration` edge for a single method signature, and the two are
 * checked against each other at the `runTurnPipeline` call site that consumes them.
 *
 * @param ctx tenant context — used only for the two RLS-scoped catalog reads below.
 * @returns a port whose `invokeTool` never performs network I/O.
 */
export function createShadowEgressPort(ctx: TenantContext): { invokeTool(invocation: ToolInvocation): Promise<ToolResult> } {
  return {
    async invokeTool(invocation: ToolInvocation): Promise<ToolResult> {
      // A tool that no longer exists is reported the same way the real port reports it,
      // so a shadow run's failure modes match the live ones it is being compared against.
      const tool = await findToolById(ctx, invocation.toolId);
      if (!tool) {
        return { outcome: "Failed", errorMessage: "tool no longer exists" };
      }

      const schemaVersion = await findCurrentSchemaVersion(ctx, invocation.toolId);
      if (!schemaVersion) {
        return { outcome: "Failed", errorMessage: "tool has no discovered schema" };
      }

      // The one real check this port performs. `validateAgainstJsonSchema` is a pure,
      // in-process Ajv compile+validate (`@nextbot/mcp-client`'s only non-networking
      // export) — importing it opens nothing and reaches nothing.
      const validation = validateAgainstJsonSchema(schemaVersion.inputSchema as object, invocation.args);
      if (!validation.valid) {
        return { outcome: "Failed", errorMessage: `shadow: candidate produced invalid tool arguments — ${validation.errors.join("; ")}` };
      }

      // No `callTool`. No transport. No credential decryption (a shadow run never needs a
      // credential, so this port never touches the vault at all — one fewer secret-handling
      // path than the real egress has). No circuit-breaker mutation either: a shadow run
      // must not be able to trip a breaker that governs real customer traffic.
      return {
        outcome: "Succeeded",
        output: {
          [SHADOW_NOT_EXECUTED]: true,
          toolName: invocation.toolName,
          note: "Shadow evaluation: this tool call was recorded but deliberately not executed.",
        },
      };
    },
  };
}
