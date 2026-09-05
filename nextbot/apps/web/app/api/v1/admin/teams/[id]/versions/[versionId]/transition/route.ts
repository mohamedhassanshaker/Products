import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { TransitionTeamVersionRequestSchema } from "@nextbot/contracts";
import { handleTransitionTeamVersion } from "@nextbot/teams";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/teams/{id}/versions/{versionId}/transition` (RBAC:
 * `agent_platform=Write`) — LLD §14.7.5.
 *
 * Every gate lives server-side in `canPromoteTeamVersion`: the FSM edge, the
 * four-eyes rule on `Approved`, and FR-ORC-11's whole-topology sandbox requirement
 * (which reads real `delegation_event` rows, not a flag). The client's own
 * `allowedTransitions` hint comes from that same function, so the two can never
 * disagree — and the hint is never trusted in place of the check.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { versionId } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(TransitionTeamVersionRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid transition payload.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handleTransitionTeamVersion(guard.ctx, versionId, body.to, guard.session.userId));
  } catch (err) {
    return problemResponse(err);
  }
}
