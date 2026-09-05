import { NextResponse, type NextRequest } from "next/server";
import { handleInstantiateBlueprintAsDraft } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/agent-platform/blueprints/:id/instantiate` (RBAC:
 * agent_platform=Write) — "selecting one opens the Studio pre-populated at
 * the Review step of a working Draft, editable before save" (FR-AGT-15). Body:
 * `{ agentDefinitionId: string }`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.agentDefinitionId !== "string") {
    return NextResponse.json({ type: "about:blank", title: "Invalid request — expected { agentDefinitionId: string }.", status: 422 }, { status: 422 });
  }
  try {
    const draft = await handleInstantiateBlueprintAsDraft(guard.ctx, id, body.agentDefinitionId, guard.session.userId);
    return NextResponse.json({ draft }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
