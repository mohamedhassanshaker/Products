import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { StudioEvalsStepRequestSchema } from "@nextbot/contracts";
import { handleSubmitStudioEvalsStep } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/agent-platform/studio/drafts/:id/evals` (RBAC:
 * agent_platform=Write) — Studio step 9: Evals (the admin's edited subset of
 * the composed skills' own eval cases, `GET .../available-skill-eval-cases`). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(StudioEvalsStepRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid Evals step payload.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json({ draft: await handleSubmitStudioEvalsStep(guard.ctx, id, body) });
  } catch (err) {
    return problemResponse(err);
  }
}
