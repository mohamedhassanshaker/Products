import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { StudioKnowledgeStepRequestSchema } from "@nextbot/contracts";
import { handleSubmitStudioKnowledgeStep } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/agent-platform/studio/drafts/:id/knowledge` (RBAC:
 * agent_platform=Write) — Studio step 5: Knowledge (collection scopes,
 * retrieval strategy, grounding policy). Staged verbatim into `spec.knowledge`
 * — the final Review-step artifact validation (`AgentDefinitionArtifactSchema`)
 * is the real structural gate, not this staging step. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(StudioKnowledgeStepRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid Knowledge step payload.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json({ draft: await handleSubmitStudioKnowledgeStep(guard.ctx, id, body) });
  } catch (err) {
    return problemResponse(err);
  }
}
