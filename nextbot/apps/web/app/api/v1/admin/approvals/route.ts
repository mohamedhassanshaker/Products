import { NextResponse } from "next/server";
import { listPendingApprovalRequests } from "@nextbot/orchestration";
import { findConnectorById } from "@nextbot/connectors";
import { findConversationById } from "@nextbot/conversations";
import { findChannelById } from "@nextbot/channels";
import { requireApi } from "@/src/lib/api-guard";
import type { ApprovalQueueItemDto } from "@nextbot/contracts";

/**
 * `GET /api/v1/admin/approvals` (RBAC: approval_queue=Read) — screen inventory
 * B.3.6's pending Tier-3 approvals list, wait-time sorted oldest-first.
 *
 * **QA fix (D1)**: `backendName`/`channelType` were previously hardcoded to `null` —
 * a literal stub, not a query bug. `orchestration` has no allowed dependency edge to
 * `connectors`/`conversations`/`channels` (LLD §2.3 module boundaries), so this join
 * happens here at the `apps/web` composition-root layer, the same pattern
 * `getEscalationDetail`/`listEscalationsForAdmin` already establish for the
 * Escalation Queue's own channel-type enrichment.
 */
export async function GET() {
  const guard = await requireApi("approval_queue", "Read");
  if (guard instanceof Response) return guard;

  const rows = await listPendingApprovalRequests(guard.ctx);
  const now = Date.now();
  const items: ApprovalQueueItemDto[] = await Promise.all(
    rows.map(async (r) => {
      const [connector, conversation] = await Promise.all([
        r.connectorId ? findConnectorById(guard.ctx, r.connectorId) : Promise.resolve(null),
        findConversationById(guard.ctx, r.conversationId),
      ]);
      const channel = conversation ? await findChannelById(guard.ctx, conversation.channelId) : null;
      return {
        id: r.id,
        toolCallId: r.toolCallId,
        conversationId: r.conversationId,
        toolName: r.toolName,
        backendName: connector?.name ?? null,
        // QA Final Review minor item: B.3.6's own required "requested action"
        // summary column, missing from the previous incomplete fix.
        actionSummary: `Call ${r.toolName}${connector?.name ? ` on ${connector.name}` : ""}`,
        channelType: channel?.type ?? null,
        requestedAt: r.requestedAt.toISOString(),
        waitSeconds: Math.max(0, Math.floor((now - r.requestedAt.getTime()) / 1000)),
        status: r.status,
      };
    }),
  );
  return NextResponse.json({ items });
}
