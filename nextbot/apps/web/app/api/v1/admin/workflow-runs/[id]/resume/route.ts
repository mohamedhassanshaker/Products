import { NextResponse } from "next/server";
import { handleResumeWorkflowRun } from "@nextbot/workflows";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/workflow-runs/{id}/resume` (RBAC: `agent_platform=Write`) —
 * Target Architecture Blueprint Phase 16 (BL-47b), LLD §14.6.5's "operator nudge;
 * re-leases, never re-executes a Succeeded step".
 *
 * **It executes nothing.** It confirms the run is in a state `apps/worker`'s
 * `workflow.run-pump` will claim on its next 5s tick, and reports the run. That is the
 * honest implementation of the LLD's wording given ADR-0013 §7's correction: there is no
 * queue to enqueue into, and executing from a request handler would put a second
 * advancer beside the lease holder — the one thing `workflow_run_lease` exists to
 * prevent. Because it never executes, it also structurally cannot re-execute a
 * `Succeeded` step.
 *
 * A `Suspended` run is deliberately NOT resumable here: its suspension is a real
 * external condition (an undecided approval, an open escalation, an unelapsed timer),
 * and "resuming" past it would fabricate a decision nobody made. Such a run returns a
 * `409` naming its state, so the operator can see what it is actually waiting on.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse | Response> {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json(await handleResumeWorkflowRun(guard.ctx, id));
  } catch (err) {
    return problemResponse(err);
  }
}
