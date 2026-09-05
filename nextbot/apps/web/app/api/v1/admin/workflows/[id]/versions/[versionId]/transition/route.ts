import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { TransitionWorkflowVersionRequestSchema } from "@nextbot/contracts";
import { handleTransitionWorkflowVersion } from "@nextbot/workflows";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/workflows/{id}/versions/{versionId}/transition` (RBAC:
 * `agent_platform=Write`) — LLD §14.6.4.
 *
 * Every gate lives server-side in `canPromoteWorkflowVersion`: the FSM edge, the
 * four-eyes rule on `Approved`, and LLD §14.6.1's `sandboxRunId` requirement
 * (genuinely unreachable until Phase 16 populates it for real — see that
 * function's own module doc). The client's own `allowedTransitions` hint comes
 * from that same function, so the two can never disagree.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { versionId } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(TransitionWorkflowVersionRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid transition payload.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handleTransitionWorkflowVersion(guard.ctx, versionId, body.to, guard.session.userId));
  } catch (err) {
    return problemResponse(err);
  }
}
