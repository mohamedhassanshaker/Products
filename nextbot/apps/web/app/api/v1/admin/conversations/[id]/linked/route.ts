import { NextResponse } from "next/server";
import { findConversationById, resolveLinkedConversations } from "@nextbot/conversations";
import { requireApi } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/conversations/:id/linked` (RBAC: conversations=Read) — Target
 * Architecture Blueprint Phase 19 (BL-50, FR-OC-08). Returns every OTHER conversation
 * in this tenant sharing the same underlying customer identity, per this tenant's own
 * opt-in — always `[]` when the tenant hasn't explicitly enabled cross-channel
 * linking, or when this conversation has no recorded customer identifier at all.
 * `resolveLinkedConversations()` is tenant-scoped (`withTenant`) throughout, so a
 * cross-tenant id can never surface another tenant's conversations here.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("conversations", "Read");
  if (guard instanceof Response) return guard;

  const { id } = await params;
  const existing = await findConversationById(guard.ctx, id);
  if (!existing) {
    return NextResponse.json({ type: "about:blank", title: "Conversation not found.", status: 404 }, { status: 404 });
  }

  const linked = await resolveLinkedConversations(guard.ctx, id);
  return NextResponse.json({ linked });
}
