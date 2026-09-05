import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { ManualToolInvokeRequestSchema } from "@nextbot/contracts";
import { getEscalationDetail } from "@nextbot/escalations";
import { resolveToolPermission, findToolById } from "@nextbot/tool-registry";
import { createSuspendedToolCall } from "@nextbot/orchestration";
import { hasAtLeast } from "@nextbot/iam";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { createAdminMcpEgressPort } from "@/src/lib/mcp-egress";

/**
 * `POST /api/v1/admin/escalations/{id}/tool-calls` (RBAC: escalations=Write, plus
 * `approval_queue=Write` for any tool that resolves to Tier-2/3 — see below) —
 * B.5.2's Tool Panel: the human agent manually triggers a permissioned MCP tool from
 * the takeover panel (FR-ESC-02). **Security review requirement, satisfied**: this
 * still goes through the Phase 6 permission resolver (`resolveToolPermission`) for
 * the acting human agent's own `roleId` — not a bypass path just because a human is
 * initiating it.
 *
 * **QA fix (BE1, blocking)**: this route previously executed *every* resolved tool
 * (Tier-1/2/3 alike) directly, and was gated only on `escalations=Write` — a genuine
 * trust-mechanism bypass of FR-MCP-05/LLD §6.2's "every write tool call, every tier,
 * no exceptions" and of FR-ADM-04's RBAC segregation (a human agent without
 * Approval-Queue access could execute a Tier-3 tool here that they could never
 * approve through the real Approval Queue). Fixed tier-by-tier:
 *
 * - **Tier-1**: still executes directly through the Control-Plane egress port —
 *   unchanged, this tier never required suspension.
 * - **Tier-2/3**: now suspended via the exact same `createSuspendedToolCall`
 *   machinery the AI-initiated path uses (Phase 14/LLD §6.2 steps 6/7) — a manually
 *   triggered Tier-2 tool produces the same customer-confirmation card the AI path
 *   would, and a Tier-3 tool lands in the real Approval Queue for a second human to
 *   approve, instead of executing on the spot. Additionally, any tool resolving to
 *   Tier-2/3 via this route requires `approval_queue=Write` on top of
 *   `escalations=Write` — an agent without Approval Queue access cannot end-run the
 *   approval gate through the takeover panel. Tier-1 tools remain gated on
 *   `escalations=Write` alone.
 *
 * **Egress path decision (disclosed, consistent with Phase 14's existing decision,
 * not a third parallel path):** the Tier-1 execution path reuses
 * `apps/web/src/lib/mcp-egress.ts`'s `createAdminMcpEgressPort` — the same
 * (already-flagged) Control-Plane-side egress implementation Phase 14's Tier-3
 * decision route uses, rather than adding a second distinct admin-side egress
 * implementation or a fresh `apps/gateway` internal-API hop this dispatch didn't
 * have time to build correctly. See that file's own doc comment for the full
 * ADR-0004 deviation rationale.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("escalations", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(ManualToolInvokeRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid tool invocation request.", status: 422 }, { status: 422 });
  }

  const escalation = await getEscalationDetail(guard.ctx, id);
  if (!escalation || escalation.status !== "InProgress") {
    return NextResponse.json(
      { type: "about:blank", title: "This escalation is not currently in progress — take it over first.", status: 409 },
      { status: 409 },
    );
  }

  const tool = await findToolById(guard.ctx, body.toolId);
  if (!tool) {
    return NextResponse.json({ type: "about:blank", title: "Tool not found.", status: 404 }, { status: 404 });
  }

  try {
    const resolution = await resolveToolPermission(guard.ctx, body.toolId, {
      roleId: guard.session.roleIds[0],
      args: body.args,
    });
    if (resolution.effect === "Deny") {
      return NextResponse.json(
        { type: "about:blank", title: "You do not have permission to invoke this tool.", status: 403, code: "PERMISSION_DENIED" },
        { status: 403 },
      );
    }

    // Tier-2/3: no direct execution. Same suspension machinery as the AI-initiated
    // path (LLD §6.2 steps 6/7) — requires `approval_queue=Write` on top of
    // `escalations=Write` so an agent without Approval Queue access cannot bypass
    // the real Approval Queue by triggering the tool manually from this panel.
    if (resolution.tier === "Tier2" || resolution.tier === "Tier3") {
      if (!hasAtLeast(guard.session.permissions, "approval_queue", "Write")) {
        return NextResponse.json(
          {
            type: "about:blank",
            title: "This tool requires human approval and you do not have Approval Queue access.",
            status: 403,
            code: "PERMISSION_DENIED",
          },
          { status: 403 },
        );
      }

      const { toolCall } = await createSuspendedToolCall(guard.ctx, {
        conversationId: escalation.conversationId,
        toolId: tool.id,
        toolName: tool.name,
        connectorId: tool.connectorId,
        args: body.args,
        tier: resolution.tier,
      });

      return NextResponse.json({
        outcome: resolution.tier === "Tier2" ? "AwaitingCustomerConfirmation" : "AwaitingHumanApproval",
        toolCallId: toolCall.id,
        output: null,
        errorMessage: null,
      });
    }

    // Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-01) — `tool.connector_id`
    // is now nullable, because an `AgentAsTool` catalog entry (a specialist agent
    // registered for delegation) has no MCP connector behind it. A human agent
    // cannot hand-invoke a delegation from the takeover panel: only the delegation
    // executor can create a hop, and doing so needs a team run's budget/depth/scope
    // context that does not exist here. Refused explicitly rather than dispatched
    // with an empty connector id.
    if (tool.connectorId === null) {
      return NextResponse.json(
        {
          type: "about:blank",
          title: "This catalog entry is an agent delegation target, not a directly invocable tool.",
          status: 422,
          code: "TOOL_NOT_DIRECTLY_INVOCABLE",
        },
        { status: 422 },
      );
    }

    // Tier-1 (or no tier — always-allowed): execute directly.
    const egress = createAdminMcpEgressPort(guard.ctx);
    const result = await egress.invokeTool({
      toolCallId: crypto.randomUUID(),
      tenantId: guard.ctx.tenantId,
      toolId: tool.id,
      connectorId: tool.connectorId,
      toolName: tool.name,
      args: body.args,
      idempotencyKey: crypto.randomUUID(),
    });

    return NextResponse.json({ outcome: result.outcome, output: "output" in result ? result.output : null, errorMessage: "errorMessage" in result ? result.errorMessage : null });
  } catch (err) {
    return problemResponse(err);
  }
}
