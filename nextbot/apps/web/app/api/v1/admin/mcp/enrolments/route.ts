import { NextResponse } from "next/server";
import { handleCreateDraft } from "@nextbot/mcp-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/mcp/enrolments` — step 0, creates the resumable wizard draft
 * (RBAC: connectors=Write). */
export async function POST() {
  const guard = await requireApi("connectors", "Write");
  if (guard instanceof Response) return guard;
  try {
    const draft = await handleCreateDraft(guard.ctx, guard.session.userId);
    return NextResponse.json({ draft }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
