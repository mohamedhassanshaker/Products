import { NextResponse } from "next/server";
import { handleRevokeMySession } from "@nextbot/iam";
import { getSession } from "@/src/lib/session";
import { problemResponse } from "@/src/lib/api-guard";

/** `DELETE /api/v1/admin/sessions/{id}` — revokes one of the caller's OWN
 * sessions (Phase 4, BL-36). Ownership is enforced inside
 * `revokeMySession`/`revokeSession`'s `(tenant, id, userId)` scoping, not merely
 * by this route trusting the caller's intent. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  const { id } = await params;
  try {
    await handleRevokeMySession(session, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return problemResponse(err);
  }
}
