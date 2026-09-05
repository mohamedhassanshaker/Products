import { NextResponse } from "next/server";
import { handleGetStudioDraft, handleDeleteStudioDraft } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/agent-platform/studio/drafts/:id` (RBAC: agent_platform=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json({ draft: await handleGetStudioDraft(guard.ctx, id) });
  } catch (err) {
    return problemResponse(err);
  }
}

/** `DELETE /api/v1/admin/agent-platform/studio/drafts/:id` (RBAC: agent_platform=Write)
 * — abandons an in-progress Studio wizard session. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    await handleDeleteStudioDraft(guard.ctx, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return problemResponse(err);
  }
}
