import { NextResponse } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateServiceAccountRequestSchema } from "@nextbot/contracts";
import { handleCreateServiceAccount, handleListServiceAccounts } from "@nextbot/iam";
import { getSession, getSessionTenantContext } from "@/src/lib/session";
import { problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/** `GET/POST /api/v1/admin/service-accounts` (Phase 4, BL-36, FR-SEC-10) —
 * `users_roles`-gated, same module as human user/role administration. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  try {
    return NextResponse.json(await handleListServiceAccounts(session));
  } catch (err) {
    return problemResponse(err);
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateServiceAccountRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid service-account payload.", status: 422 }, { status: 422 });
  }
  const ctx = await getSessionTenantContext(session);
  try {
    const id = await handleCreateServiceAccount(session, body);
    await recordAdminAudit(ctx, {
      actorId: session.userId,
      actorLabel: session.userId,
      actionType: "service_account.create",
      targetType: "User",
      targetId: id,
      outcome: "Success",
      details: { name: body.name, roleIds: body.roleIds },
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
