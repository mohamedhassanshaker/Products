import { NextResponse } from "next/server";
import { handleDisableServiceAccount } from "@nextbot/iam";
import { getSession, getSessionTenantContext } from "@/src/lib/session";
import { problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/** `DELETE /api/v1/admin/service-accounts/{id}` — disables (never hard-deletes)
 * a service account and revokes its active credentials (Phase 4, BL-36). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  const { id } = await params;
  const ctx = await getSessionTenantContext(session);
  try {
    await handleDisableServiceAccount(session, id);
    await recordAdminAudit(ctx, {
      actorId: session.userId,
      actorLabel: session.userId,
      actionType: "service_account.disable",
      targetType: "User",
      targetId: id,
      outcome: "Success",
      details: {},
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return problemResponse(err);
  }
}
