import { NextResponse } from "next/server";
import { handleGetScimTokenStatus, handleRevokeScimToken, handleRotateScimToken } from "@nextbot/iam";
import { getSession, getSessionTenantContext } from "@/src/lib/session";
import { problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/** `GET/POST/DELETE /api/v1/admin/scim-token` (Phase 4, BL-36, FR-SEC-10) —
 * status / rotate(-issue) / revoke the tenant's single SCIM bearer token. The
 * plaintext token is returned only from `POST`, exactly once. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  try {
    return NextResponse.json(await handleGetScimTokenStatus(session));
  } catch (err) {
    return problemResponse(err);
  }
}

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  const ctx = await getSessionTenantContext(session);
  try {
    const result = await handleRotateScimToken(session);
    await recordAdminAudit(ctx, {
      actorId: session.userId,
      actorLabel: session.userId,
      actionType: "scim_token.rotate",
      targetType: "ScimToken",
      targetId: null,
      outcome: "Success",
      details: {},
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    await recordAdminAudit(ctx, {
      actorId: session.userId,
      actorLabel: session.userId,
      actionType: "scim_token.rotate",
      targetType: "ScimToken",
      targetId: null,
      outcome: "Failure",
      details: { error: err instanceof Error ? err.message : String(err) },
    });
    return problemResponse(err);
  }
}

export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  const ctx = await getSessionTenantContext(session);
  try {
    await handleRevokeScimToken(session);
    await recordAdminAudit(ctx, {
      actorId: session.userId,
      actorLabel: session.userId,
      actionType: "scim_token.revoke",
      targetType: "ScimToken",
      targetId: null,
      outcome: "Success",
      details: {},
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return problemResponse(err);
  }
}
