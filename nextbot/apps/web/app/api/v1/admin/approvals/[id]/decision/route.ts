import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { Tier3DecisionRequestSchema } from "@nextbot/contracts";
import { decideTier3, findToolCallById } from "@nextbot/orchestration";
import { resolveToolPermission } from "@nextbot/tool-registry";
import { isBreakerOpen } from "@nextbot/mcp-client";
import { insertMessage, publishConversationEvent } from "@nextbot/conversations";
import { createAdminMcpEgressPort } from "../../../../../../../src/lib/mcp-egress.js";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/**
 * `POST /api/v1/admin/approvals/{id}/decision` (RBAC: approval_queue=Write, LLD
 * §6.5/§6.3). `{id}` here is the `tool_call.id` (the same id the Approval Queue's
 * list/detail carry as `toolCallId`) — the CAS-claim inside `decideTier3` is the
 * concurrency-safety mechanism (only the specific tool call is blocked while
 * decided, never the whole conversation, and only one of any concurrent duplicate
 * decision calls actually applies).
 *
 * **Security review**: RBAC-gated at `approval_queue` (a `connectors`-visibility-
 * only role cannot reach this route at all — module-scoped, not just
 * authenticated); `Idempotency-Key` required per LLD §6.3 layer 1 (the CAS-claim is
 * layer 2, independent of this header).
 *
 * **QA fix (BE2, significant)**: a Tier-3 approval can sit pending for up to 24h
 * (LLD §6.5's default timeout) — the connector's circuit breaker could trip, or an
 * admin could add a `Deny` rule, at any point during that window. Previously
 * `Approve` had no live re-check and would execute regardless. This now re-runs
 * `resolveToolPermission` immediately before dispatch on the `Approved` path and
 * fails the approval cleanly (rather than executing anyway) if the tool has since
 * been tripped/denied.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("approval_queue", "Write");
  if (guard instanceof Response) return guard;
  const { id: toolCallId } = await params;

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return NextResponse.json({ type: "about:blank", title: "Idempotency-Key header is required.", status: 422 }, { status: 422 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(Tier3DecisionRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid decision request.", status: 422 }, { status: 422 });
  }

  if (body.decision === "Approved") {
    // Live re-check at the moment of dispatch (QA fix BE2) — both the resolver's own
    // rule state (`resolveToolPermission`, which does NOT itself consult the
    // circuit breaker — see `tool-registry`'s resolver) and the breaker's live state
    // (`isBreakerOpen`, the same shared breaker `mcp-egress` checks) are re-evaluated
    // fresh here, independent of whatever they resolved to at the moment this
    // approval was originally requested.
    const existing = await findToolCallById(guard.ctx, toolCallId);
    if (existing) {
      const liveResolution = await resolveToolPermission(guard.ctx, existing.toolId, {});
      const breakerOpen = await isBreakerOpen(guard.ctx.tenantId, existing.toolId);
      if (liveResolution.effect === "Deny" || breakerOpen) {
        return NextResponse.json(
          {
            type: "about:blank",
            title: "This tool can no longer be executed (it has since been denied or its circuit breaker has tripped). The approval was not applied.",
            status: 409,
            code: "TOOL_NO_LONGER_PERMITTED",
          },
          { status: 409 },
        );
      }
    }
  }

  try {
    const outcome = await decideTier3(
      guard.ctx,
      { egress: createAdminMcpEgressPort(guard.ctx) },
      toolCallId,
      body.decision,
      body.note,
      guard.session.userId,
    );

    if (outcome.resultPayload) {
      const resultMessage = await insertMessage(guard.ctx, {
        conversationId: outcome.toolCall.conversationId,
        sender: "AI",
        contentType: outcome.resultPayload.contentType,
        payload: outcome.resultPayload as unknown as Record<string, unknown>,
      });
      publishConversationEvent(outcome.toolCall.conversationId, {
        event: "message",
        data: {
          message: {
            id: resultMessage.id,
            conversationId: resultMessage.conversationId,
            sequence: resultMessage.sequence,
            sender: resultMessage.sender,
            contentType: resultMessage.contentType,
            payload: resultMessage.payload,
            confidenceScore: resultMessage.confidenceScore,
            createdAt: resultMessage.createdAt.toISOString(),
          },
        },
      });
    }

    // FR-ADM-03 (QA Final Review B4): Tier-3 approve/reject decisions must be
    // audited with the deciding admin as actor, not `system`.
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: `approval.${body.decision.toLowerCase()}`,
      targetType: "ToolCall",
      targetId: toolCallId,
      outcome: "Success",
      details: { decision: body.decision, note: body.note ?? null },
    });

    return NextResponse.json({ toolCallId, status: outcome.toolCall.status });
  } catch (err) {
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: `approval.${body.decision.toLowerCase()}`,
      targetType: "ToolCall",
      targetId: toolCallId,
      outcome: "Failure",
      details: { decision: body.decision, error: err instanceof Error ? err.message : String(err) },
    });
    return problemResponse(err);
  }
}
