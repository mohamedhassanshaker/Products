import { NextResponse } from "next/server";
import { getConversationDetailForAdmin } from "@nextbot/conversations";
import { requireApi } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/conversations/:id` (RBAC: conversations=Read) — screen inventory
 * B.4.2's transcript + context panel data. `getConversationDetailForAdmin` is already
 * tenant-scoped (`withTenant`), so a conversation id belonging to another tenant
 * resolves to `null` here rather than ever being returned — never a client-supplied-id
 * trust issue. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("conversations", "Read");
  if (guard instanceof Response) return guard;

  const { id } = await params;
  const conversation = await getConversationDetailForAdmin(guard.ctx, id);
  if (!conversation) {
    return NextResponse.json({ type: "about:blank", title: "Conversation not found.", status: 404 }, { status: 404 });
  }
  return NextResponse.json({ conversation });
}
