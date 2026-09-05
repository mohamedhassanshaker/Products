import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { StudioAudienceStepRequestSchema } from "@nextbot/contracts";
import { handleSubmitStudioAudienceStep } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/agent-platform/studio/drafts/:id/audience` (RBAC:
 * agent_platform=Write) — Studio step 2: Audience & channel (declares trust
 * level, feeding the PII masking-context matrix, FR-AGT-13). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(StudioAudienceStepRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid Audience & channel step payload.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json({ draft: await handleSubmitStudioAudienceStep(guard.ctx, id, body) });
  } catch (err) {
    return problemResponse(err);
  }
}
