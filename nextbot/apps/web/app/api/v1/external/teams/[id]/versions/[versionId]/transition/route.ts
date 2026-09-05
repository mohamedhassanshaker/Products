import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { TransitionTeamVersionRequestSchema } from "@nextbot/contracts";
import { handleTransitionTeamVersion } from "@nextbot/teams";
import { requirePublicApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/external/teams/{id}/versions/{versionId}/transition` (RBAC:
 * agent_platform=Write). Every gate (`canPromoteTeamVersion`'s FSM edge, four-eyes
 * rule, FR-ORC-11's whole-topology sandbox requirement) is enforced server-side
 * identically to the console's own route.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const guard = await requirePublicApi("agent_platform", "Write");
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
