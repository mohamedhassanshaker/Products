import { NextResponse } from "next/server";
import { findToolCallById, listPendingApprovalRequests } from "@nextbot/orchestration";
import { getConversationDetailForAdmin } from "@nextbot/conversations";
import { findConnectorById } from "@nextbot/connectors";
import { requireApi } from "@/src/lib/api-guard";
import type { ApprovalDetailDto } from "@nextbot/contracts";

/** `GET /api/v1/admin/approvals/{id}` (RBAC: approval_queue=Read) — approval detail:
 * full context (transcript excerpt, recognized goal, tool-call args, customer
 * identity if verified) per screen inventory B.3.6. `{id}` is the `approval_request`
 * id (the queue row), not the `tool_call` id. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("approval_queue", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  // No single-row lookup by approval_request.id exists yet (only by tool_call_id) —
  // the queue is small enough this phase that scanning the pending list is an
  // acceptable, disclosed simplification rather than adding a new repository method
  // for a single call site; revisit if the queue grows large enough to matter.
  const pending = await listPendingApprovalRequests(guard.ctx);
  const approval = pending.find((a) => a.id === id);
  if (!approval) {
    return NextResponse.json({ type: "about:blank", title: "Approval not found.", status: 404 }, { status: 404 });
  }

  const toolCall = await findToolCallById(guard.ctx, approval.toolCallId);
  const connector = toolCall?.connectorId ? await findConnectorById(guard.ctx, toolCall.connectorId) : null;
  const conversation = await getConversationDetailForAdmin(guard.ctx, approval.conversationId);
  const transcriptExcerpt = (conversation?.messages ?? []).slice(-10).map((m) => ({
    sender: m.sender,
    text: typeof (m.payload as { text?: unknown })?.text === "string" ? (m.payload as { text: string }).text : JSON.stringify(m.payload).slice(0, 200),
    at: m.createdAt.toISOString(),
  }));

  const detail: ApprovalDetailDto = {
    id: approval.id,
    toolCallId: approval.toolCallId,
    conversationId: approval.conversationId,
    toolName: approval.toolName,
    backendName: connector?.name ?? null,
    actionSummary: `Call ${approval.toolName}${connector?.name ? ` on ${connector.name}` : ""}`,
    channelType: conversation?.channelType ?? null,
    requestedAt: approval.requestedAt.toISOString(),
    waitSeconds: Math.max(0, Math.floor((Date.now() - approval.requestedAt.getTime()) / 1000)),
    status: approval.status,
    inputArgsMasked: toolCall?.inputArgsMasked ?? null,
    riskSummary: approval.riskSummary,
    transcriptExcerpt,
    recognizedGoal: conversation?.recognizedGoal ?? null,
    customerIdentifier: conversation?.customerIdentifier ?? null,
  };
  return NextResponse.json(detail);
}
