import { NextResponse } from "next/server";
import { getSession } from "@/src/lib/session";

/** `GET /api/v1/admin/session` — session check / current-user (LLD Phase 2 deliverable). */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  return NextResponse.json({ tenantId: session.tenantId, userId: session.userId, roleIds: session.roleIds, permissions: session.permissions });
}
