import { NextResponse } from "next/server";
import { handleListMySessions, handleRevokeAllMySessions } from "@nextbot/iam";
import { getSession } from "@/src/lib/session";
import { problemResponse } from "@/src/lib/api-guard";

/** `GET/DELETE /api/v1/admin/sessions` — the caller's own active sessions
 * (Phase 4, BL-36, FR-SEC-10). No RBAC gate beyond authentication — a user
 * always has the right to see/revoke their own sessions. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  try {
    return NextResponse.json(await handleListMySessions(session));
  } catch (err) {
    return problemResponse(err);
  }
}

/** "Sign out everywhere." */
export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  try {
    await handleRevokeAllMySessions(session);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return problemResponse(err);
  }
}
