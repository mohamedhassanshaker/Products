import { NextResponse } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { UpsertSsoConnectionRequestSchema } from "@nextbot/contracts";
import { handleGetSsoConnection, handleUpsertSsoConnection } from "@nextbot/iam";
import { getSession, getSessionTenantContext } from "@/src/lib/session";
import { problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/** `GET/PUT /api/v1/admin/sso/connection` — the tenant's single SSO connection
 * (Phase 4, BL-36, FR-SEC-10). RBAC (`security_settings`) checked inside
 * `@nextbot/iam`'s own http layer, same convention as the rest of this module. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  try {
    return NextResponse.json(await handleGetSsoConnection(session));
  } catch (err) {
    return problemResponse(err);
  }
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(UpsertSsoConnectionRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid SSO connection payload.", status: 422 }, { status: 422 });
  }
  const ctx = await getSessionTenantContext(session);
  try {
    const id = await handleUpsertSsoConnection(session, body);
    await recordAdminAudit(ctx, {
      actorId: session.userId,
      actorLabel: session.userId,
      actionType: "sso_connection.upsert",
      targetType: "SsoConnection",
      targetId: id,
      outcome: "Success",
      details: { protocol: body.protocol },
    });
    return NextResponse.json({ id });
  } catch (err) {
    await recordAdminAudit(ctx, {
      actorId: session.userId,
      actorLabel: session.userId,
      actionType: "sso_connection.upsert",
      targetType: "SsoConnection",
      targetId: null,
      outcome: "Failure",
      details: { error: err instanceof Error ? err.message : String(err) },
    });
    return problemResponse(err);
  }
}
