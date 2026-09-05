import { NextResponse } from "next/server";
import { handleRevokeApiKey } from "@nextbot/iam";
import { getSession, getSessionTenantContext } from "@/src/lib/session";
import { problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/** `DELETE /api/v1/admin/service-accounts/{id}/api-keys/{keyId}` — revokes an
 * API key. Takes effect on its very next use (Phase 4, BL-36). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; keyId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  const { keyId } = await params;
  const ctx = await getSessionTenantContext(session);
  try {
    await handleRevokeApiKey(session, keyId);
    await recordAdminAudit(ctx, {
      actorId: session.userId,
      actorLabel: session.userId,
      actionType: "api_key.revoke",
      targetType: "ApiKey",
      targetId: keyId,
      outcome: "Success",
      details: {},
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return problemResponse(err);
  }
}
