import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CancelWorkflowRunRequestSchema } from "@nextbot/contracts";
import { handleCancelWorkflowRun } from "@nextbot/workflows";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/workflow-runs/{id}/cancel` (RBAC: `agent_platform=Write`) —
 * Target Architecture Blueprint Phase 16 (BL-47b), LLD §14.6.5.
 *
 * The cancel is a compare-and-set against the run's non-terminal states, so cancelling a
 * run that finished a millisecond earlier is a clean `409` rather than a second terminal
 * write that would overwrite the real outcome. The acting user is taken from the SESSION,
 * never from the request body — a client-supplied actor id is exactly the field an
 * attacker would forge to attribute an action to someone else.
 *
 * A cancelled run does not run its compensation stack; see `cancelRun`'s own doc for why
 * silently issuing compensating writes from a "stop" button would be the wrong default.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) ?? {};
  if (!Value.Check(CancelWorkflowRunRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid cancel payload.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handleCancelWorkflowRun(guard.ctx, id, body, guard.session.userId));
  } catch (err) {
    return problemResponse(err);
  }
}
