import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { SetConversationCustomerIdentifierRequestSchema } from "@nextbot/contracts";
import { findConversationById, updateConversationCustomerIdentifier } from "@nextbot/conversations";
import { requireApi } from "@/src/lib/api-guard";

/**
 * `PATCH /api/v1/admin/conversations/:id/customer-identifier` (RBAC:
 * conversations=Write) — Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08).
 *
 * The one bounded mechanism this phase adds for recording a customer identifier on a
 * conversation (most importantly a WebWidget conversation, which never gets one at
 * session-creation time): an admin/agent, having confirmed the customer's phone
 * number or email during a live conversation, records it here. This is the
 * human-verification moment FR-OC-08's own "verified phone number" worked example
 * describes — this codebase has no OTP/cryptographic verification mechanism for a
 * widget session to self-declare an identifier, and building one is a materially
 * larger, separate feature out of this phase's scope (disclosed in
 * `docs/plans/cross-channel-identity-config-portability-plan.md`).
 *
 * Recomputes `customer_identifier_hash` unconditionally — this endpoint has no
 * opinion on whether cross-channel linking is enabled for this tenant; that gate
 * lives entirely in `resolveLinkedConversations()`.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("conversations", "Write");
  if (guard instanceof Response) return guard;

  const { id } = await params;
  const existing = await findConversationById(guard.ctx, id);
  if (!existing) {
    return NextResponse.json({ type: "about:blank", title: "Conversation not found.", status: 404 }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(SetConversationCustomerIdentifierRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid customer-identifier request.", status: 422 }, { status: 422 });
  }

  await updateConversationCustomerIdentifier(guard.ctx, id, body.customerIdentifier);
  return NextResponse.json({ ok: true });
}
