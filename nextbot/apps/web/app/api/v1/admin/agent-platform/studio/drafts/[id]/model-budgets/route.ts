import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { StudioModelBudgetsStepRequestSchema } from "@nextbot/contracts";
import { handleSubmitStudioModelBudgetsStep } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/agent-platform/studio/drafts/:id/model-budgets` (RBAC:
 * agent_platform=Write) — Studio step 7: Model & budgets (Model Gateway v2
 * routes). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(StudioModelBudgetsStepRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid Model & budgets step payload.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json({ draft: await handleSubmitStudioModelBudgetsStep(guard.ctx, id, body) });
  } catch (err) {
    return problemResponse(err);
  }
}
