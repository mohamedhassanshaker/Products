import { NextResponse, type NextRequest } from "next/server";
import { handlePreviewStudioDraft } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/agent-platform/studio/drafts/:id/preview` (RBAC:
 * agent_platform=Read) — LLD §14.5.5's Review step's "full YAML preview,
 * then save as Draft". Body: `{ version: string, graphType?: string }` (the
 * two fields the final submit also needs but this draft doesn't itself stage).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.version !== "string") {
    return NextResponse.json({ type: "about:blank", title: "Invalid request — expected { version: string, graphType?: string }.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handlePreviewStudioDraft(guard.ctx, id, body.version, body.graphType));
  } catch (err) {
    return problemResponse(err);
  }
}
