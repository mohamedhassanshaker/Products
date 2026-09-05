import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateStudioDraftRequestSchema } from "@nextbot/contracts";
import { handleCreateStudioDraft } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/agent-platform/studio/drafts` (RBAC: agent_platform=Write)
 * — starts a new Agent Design Studio wizard session (FR-AGT-13). */
export async function POST(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateStudioDraftRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid Studio draft payload.", status: 422 }, { status: 422 });
  }
  try {
    const draft = await handleCreateStudioDraft(guard.ctx, body.agentDefinitionId, guard.session.userId);
    return NextResponse.json({ draft }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
