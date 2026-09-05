import { NextResponse } from "next/server";
import { handleSubmitForReview } from "@nextbot/agent-platform";
import { requirePublicApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/external/agent-platform/versions/:id/submit-review` (RBAC:
 * agent_platform=Write) — same real PR/MR-opening path (or `git-not-connected`
 * fallback) the console's own route uses; see that route's doc comment. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePublicApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json(await handleSubmitForReview(guard.ctx, id));
  } catch (err) {
    return problemResponse(err);
  }
}
