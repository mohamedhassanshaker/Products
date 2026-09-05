import { NextResponse } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { UpdateUserRolesRequestSchema } from "@nextbot/contracts";
import { handleUpdateUserRoles } from "@nextbot/iam";
import { getSession, getSessionTenantContext } from "@/src/lib/session";
import { problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/**
 * `PUT /api/v1/admin/users/{id}/roles` — reassigns a user's entire role set (the
 * "change this user's role(s)" action, not incremental add/remove). Completes the
 * "Users & Roles" screen's role-assignment gap (FR-ADM-02). RBAC checked inside
 * `@nextbot/iam`'s own http layer, same convention as the rest of this module's routes.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(UpdateUserRolesRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid role-assignment payload.", status: 422 }, { status: 422 });
  }
  const ctx = await getSessionTenantContext(session);
  try {
    await handleUpdateUserRoles(session, id, body);
    // FR-ADM-03 (QA Final Review B4): role reassignment must be audited with the
    // real acting admin as actor, never `system`.
    await recordAdminAudit(ctx, {
      actorId: session.userId,
      actorLabel: session.userId,
      actionType: "user.roles_update",
      targetType: "User",
      targetId: id,
      outcome: "Success",
      details: { roleIds: body.roleIds },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    await recordAdminAudit(ctx, {
      actorId: session.userId,
      actorLabel: session.userId,
      actionType: "user.roles_update",
      targetType: "User",
      targetId: id,
      outcome: "Failure",
      details: { error: err instanceof Error ? err.message : String(err) },
    });
    return problemResponse(err);
  }
}
