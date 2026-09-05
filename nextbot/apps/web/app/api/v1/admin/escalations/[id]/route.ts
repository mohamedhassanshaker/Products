import { NextResponse } from "next/server";
import { getEscalationDetail } from "@nextbot/escalations";
import { getConversationDetailForAdmin } from "@nextbot/conversations";
import { findToolCallById } from "@nextbot/orchestration";
import { requireApi } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/escalations/{id}` (RBAC: escalations=Read) — B.5.2's Context
 * Panel data (`TakeoverContextDto`, LLD §5.8). Assembled here rather than inside
 * `@nextbot/escalations` because it joins across `@nextbot/orchestration`'s
 * `tool_call` rows (`aiAttempts`, FR-ESC-02's "AI already tried" view) —
 * `escalations` has no allowed dependency on `orchestration` (LLD §2.3's module
 * allow-list); only an `apps/*` composition root may join the two, the exact
 * pattern Phase 14's Tier-3 decision route already established for a different pair
 * of modules.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("escalations", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const detail = await getEscalationDetail(guard.ctx, id);
  if (!detail) {
    return NextResponse.json({ type: "about:blank", title: "Escalation not found.", status: 404 }, { status: 404 });
  }

  const conversationDetail = await getConversationDetailForAdmin(guard.ctx, detail.conversationId).catch(() => null);
  const customerIdentifier = conversationDetail?.customerIdentifier ?? null;

  const snapshotToolCallIds = Array.isArray((detail.aiContextSnapshot as { toolCallIds?: unknown }).toolCallIds)
    ? ((detail.aiContextSnapshot as { toolCallIds: string[] }).toolCallIds ?? [])
    : [];
  const aiAttempts = (
    await Promise.all(
      snapshotToolCallIds.map(async (toolCallId) => {
        const row = await findToolCallById(guard.ctx, toolCallId);
        if (!row) return null;
        return {
          toolCallId: row.id,
          toolName: row.toolName,
          status: row.status,
          inputArgsMasked: row.inputArgsMasked,
          outputMasked: row.output ?? null,
          errorMessage: row.errorMessage,
        };
      }),
    )
  ).filter((x): x is NonNullable<typeof x> => x !== null);

  return NextResponse.json({
    ...detail,
    row: undefined,
    customerIdentifier: customerIdentifier ? `••••${customerIdentifier.slice(-4)}` : null,
    aiAttempts,
  });
}
