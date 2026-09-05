import { NextResponse } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { UpdateRoleRequestSchema } from "@nextbot/contracts";
import { handleUpdateRole } from "@nextbot/iam";
import { getSession, getSessionTenantContext } from "@/src/lib/session";
import { problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/**
 * `PUT /api/v1/admin/roles/{id}` — edits a custom (non-system) role's name/
 * permission matrix/MFA flag (RBAC checked inside `@nextbot/iam`'s own http layer,
 * same convention as `/api/v1/admin/roles`'s GET/POST — `users_roles` is iam's own
 * module). Completes the role editor half of the "Users & Roles" screen (FR-ADM-02).
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(UpdateRoleRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid role payload.", status: 422 }, { status: 422 });
  }
  const ctx = await getSessionTenantContext(session);
  try {
    await handleUpdateRole(session, id, body);
    // FR-ADM-03 (QA Final Review B4): role edits must be audited with the real
    // acting admin as actor, never `system`.
    await recordAdminAudit(ctx, {
      actorId: session.userId,
      actorLabel: session.userId,
      actionType: "role.update",
      targetType: "Role",
      targetId: id,
      outcome: "Success",
      details: { name: body.name },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    await recordAdminAudit(ctx, {
      actorId: session.userId,
      actorLabel: session.userId,
      actionType: "role.update",
      targetType: "Role",
      targetId: id,
      outcome: "Failure",
      details: { error: err instanceof Error ? err.message : String(err) },
    });
    return problemResponse(err);
  }
}
