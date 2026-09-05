import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { StudioGuardrailsStepRequestSchema } from "@nextbot/contracts";
import { handleSubmitStudioGuardrailsStep } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/agent-platform/studio/drafts/:id/guardrails` (RBAC:
 * agent_platform=Write) — Studio step 6: Guardrails & escalation (reusing
 * tenant PII/Guardrails settings as a floor, never a ceiling — FR-AGT-14's
 * tightening-only invariant is enforced at Review/submit, not here, since a
 * mid-wizard step has no `AgentDefinitionArtifact` to validate yet). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(StudioGuardrailsStepRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid Guardrails & escalation step payload.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json({ draft: await handleSubmitStudioGuardrailsStep(guard.ctx, id, body) });
  } catch (err) {
    return problemResponse(err);
  }
}
