import { NextResponse } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateUserRequestSchema } from "@nextbot/contracts";
import { handleListUsers, handleCreateUser } from "@nextbot/iam";
import { getSession, getSessionTenantContext } from "@/src/lib/session";
import { problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/**
 * `GET/POST /api/v1/admin/users` — the "Users & Roles" screen's user table + invite/
 * create-user action (FR-ADM-02 / screen inventory B.8.1). RBAC checked inside
 * `@nextbot/iam`'s own http layer (`users_roles` is iam's own module, same convention
 * `/api/v1/admin/roles` uses — no composition-root `requireApi` indirection needed).
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  try {
    const users = await handleListUsers(session);
    return NextResponse.json({ users });
  } catch (err) {
    return problemResponse(err);
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateUserRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid user payload.", status: 422 }, { status: 422 });
  }
  const ctx = await getSessionTenantContext(session);
  try {
    const userId = await handleCreateUser(session, body);
    // FR-ADM-03 (QA Final Review B4): user creation must be audited with the real
    // acting admin as actor, never `system`. The password is never logged.
    await recordAdminAudit(ctx, {
      actorId: session.userId,
      actorLabel: session.userId,
      actionType: "user.create",
      targetType: "User",
      targetId: userId,
      outcome: "Success",
      details: { email: body.email, roleIds: body.roleIds },
    });
    return NextResponse.json({ userId }, { status: 201 });
  } catch (err) {
    await recordAdminAudit(ctx, {
      actorId: session.userId,
      actorLabel: session.userId,
      actionType: "user.create",
      targetType: "User",
      targetId: null,
      outcome: "Failure",
      details: { email: body.email, error: err instanceof Error ? err.message : String(err) },
    });
    return problemResponse(err);
  }
}
