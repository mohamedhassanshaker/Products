import { NextResponse } from "next/server";
import { listEscalationsForAdmin } from "@nextbot/escalations";
import { getConversationDetailForAdmin } from "@nextbot/conversations";
import { requireApi } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/escalations` (RBAC: escalations=Read) — B.5.1 Escalation Queue
 * list, longest-wait-first, same sort convention the Approval Queue already
 * established. `customerIdentifier` is resolved here (not inside `@nextbot/escalations`
 * itself, which has no allowed dependency on the admin-only conversation query) and
 * masked to its last 4 characters, matching the Conversation List's own convention. */
export async function GET() {
  const guard = await requireApi("escalations", "Read");
  if (guard instanceof Response) return guard;

  const items = await listEscalationsForAdmin(guard.ctx);
  const withCustomer = await Promise.all(
    items.map(async (item) => {
      const detail = await getConversationDetailForAdmin(guard.ctx, item.conversationId).catch(() => null);
      const customer = detail?.customerIdentifier ?? null;
      return {
        ...item,
        customerIdentifier: customer ? `••••${customer.slice(-4)}` : null,
      };
    }),
  );
  // SLA-aware sort: longest wait first (B.5.1's stated priority default; a full
  // priority-override rule set is out of this phase's scope — disclosed).
  withCustomer.sort((a, b) => b.waitSeconds - a.waitSeconds);
  return NextResponse.json({ items: withCustomer });
}
