import { NextResponse } from "next/server";
import { handleSubmitForReview } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/agent-platform/versions/:id/submit-review` (RBAC:
 * agent_platform=Write) — opens a real PR/MR (FR-AGT-03, ADR-0009), never a faked one.
 * When there's nothing to open a review against (no Git connection configured for this
 * version's commit — ADR-0009's 2026-08-23 amendment), returns `{ prNumber: null,
 * reason: "git-not-connected" }` rather than an error: the in-app reviewer!=author
 * check (`promotion-policy.ts`) is the documented approval mechanism in that case. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json(await handleSubmitForReview(guard.ctx, id));
  } catch (err) {
    return problemResponse(err);
  }
}
