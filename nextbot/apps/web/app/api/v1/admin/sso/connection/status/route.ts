import { NextResponse } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { UpdateSsoConnectionStatusRequestSchema } from "@nextbot/contracts";
import { handleSetSsoConnectionStatus } from "@nextbot/iam";
import { getSession, getSessionTenantContext } from "@/src/lib/session";
import { problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/** `PUT /api/v1/admin/sso/connection/status` — explicit activate/deactivate
 * (Phase 4, BL-36) — separate from the config PUT so the console can present
 * "test, then activate" as two distinct steps (fail-closed: a config save never
 * itself flips the connection Active). */
export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(UpdateSsoConnectionStatusRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid status payload.", status: 422 }, { status: 422 });
  }
  const ctx = await getSessionTenantContext(session);
  try {
    await handleSetSsoConnectionStatus(session, body);
    await recordAdminAudit(ctx, {
      actorId: session.userId,
      actorLabel: session.userId,
      actionType: "sso_connection.set_status",
      targetType: "SsoConnection",
      targetId: null,
      outcome: "Success",
      details: { status: body.status },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    await recordAdminAudit(ctx, {
      actorId: session.userId,
      actorLabel: session.userId,
      actionType: "sso_connection.set_status",
      targetType: "SsoConnection",
      targetId: null,
      outcome: "Failure",
      details: { error: err instanceof Error ? err.message : String(err) },
    });
    return problemResponse(err);
  }
}
