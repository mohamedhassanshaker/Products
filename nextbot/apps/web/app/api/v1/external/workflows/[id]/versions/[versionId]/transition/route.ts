import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { TransitionWorkflowVersionRequestSchema } from "@nextbot/contracts";
import { handleTransitionWorkflowVersion } from "@nextbot/workflows";
import { requirePublicApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/external/workflows/{id}/versions/{versionId}/transition` (RBAC:
 * agent_platform=Write). Every gate (`canPromoteWorkflowVersion`'s FSM edge,
 * four-eyes rule, sandbox-run requirement) is enforced server-side identically to
 * the console's own route — there is no alternate, looser promotion path here.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const guard = await requirePublicApi("agent_platform", "Write");
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
