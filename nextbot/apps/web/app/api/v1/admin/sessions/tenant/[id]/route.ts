import { NextResponse } from "next/server";
import { handleAdminRevokeSession } from "@nextbot/iam";
import { getSession, getSessionTenantContext } from "@/src/lib/session";
import { problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/** `DELETE /api/v1/admin/sessions/tenant/{id}` — admin revokes ANY user's
 * session in the tenant (Phase 4, BL-36; `users_roles` Write-gated). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  const { id } = await params;
  const ctx = await getSessionTenantContext(session);
  try {
    await handleAdminRevokeSession(session, id);
    await recordAdminAudit(ctx, {
      actorId: session.userId,
      actorLabel: session.userId,
      actionType: "session.admin_revoke",
      targetType: "AuthSession",
      targetId: id,
      outcome: "Success",
      details: {},
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return problemResponse(err);
  }
}
