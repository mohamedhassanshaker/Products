import { NextResponse } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateRoleRequestSchema } from "@nextbot/contracts";
import { handleListRoles, handleCreateRole } from "@nextbot/iam";
import { getSession, getSessionTenantContext } from "@/src/lib/session";
import { problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/** `GET/POST /api/v1/admin/roles` — role CRUD (RBAC checked inside `@nextbot/iam`'s
 * own http layer, since `users_roles` is iam's own module — unlike connectors/tools,
 * no composition-root guard indirection is needed here). */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  try {
    const roles = await handleListRoles(session);
    return NextResponse.json({ roles });
  } catch (err) {
    return problemResponse(err);
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateRoleRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid role payload.", status: 422 }, { status: 422 });
  }
  const ctx = await getSessionTenantContext(session);
  try {
    const roleId = await handleCreateRole(session, body);
    // FR-ADM-03 (QA Final Review B4): role creation must be audited with the real
    // acting admin as actor, never `system`.
    await recordAdminAudit(ctx, {
      actorId: session.userId,
      actorLabel: session.userId,
      actionType: "role.create",
      targetType: "Role",
      targetId: roleId,
      outcome: "Success",
      details: { name: body.name },
    });
    return NextResponse.json({ roleId }, { status: 201 });
  } catch (err) {
    await recordAdminAudit(ctx, {
      actorId: session.userId,
      actorLabel: session.userId,
      actionType: "role.create",
      targetType: "Role",
      targetId: null,
      outcome: "Failure",
      details: { error: err instanceof Error ? err.message : String(err) },
    });
    return problemResponse(err);
  }
}
