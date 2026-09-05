import { NextResponse } from "next/server";
import { handleDeleteDraft, handleGetDraft } from "@nextbot/mcp-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/mcp/enrolments/{draftId}` — resume an in-progress draft. */
export async function GET(_request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const guard = await requireApi("connectors", "Read");
  if (guard instanceof Response) return guard;
  const { draftId } = await params;
  try {
    const draft = await handleGetDraft(guard.ctx, draftId);
    return NextResponse.json({ draft });
  } catch (err) {
    return problemResponse(err);
  }
}

/** `DELETE /api/v1/admin/mcp/enrolments/{draftId}` — abandon a draft (e.g. the admin
 * cancels the wizard). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const guard = await requireApi("connectors", "Write");
  if (guard instanceof Response) return guard;
  const { draftId } = await params;
  try {
    await handleDeleteDraft(guard.ctx, draftId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return problemResponse(err);
  }
}
