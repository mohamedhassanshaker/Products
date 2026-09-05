import { NextResponse } from "next/server";
import { handleGetWorkflowRun } from "@nextbot/workflows";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/workflow-runs/{id}` (RBAC: `agent_platform=Read`) — Target
 * Architecture Blueprint Phase 16 (BL-47b), LLD §14.6.5, **FR-WF-07**.
 *
 * Returns `{ run, graph, steps }` so the EXISTING Runtime Traces component renders **the
 * path over the authored graph** rather than a flat list. There is deliberately no
 * second workflow trace viewer (LLD §14.6.5: "reusing the existing Runtime Traces
 * component — no second viewer").
 *
 * The graph comes from the run's OWN pinned `workflow_version`, never the workflow's
 * current version, so a run of version 3 is rendered over version 3's boxes.
 * `checkpoint_json` is deliberately NOT part of the response — the per-step
 * `input`/`output` an operator actually reads are already PII-masked at write time, and
 * exposing the run's whole internal data plane over the admin API would be gratuitous.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse | Response> {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json(await handleGetWorkflowRun(guard.ctx, id));
  } catch (err) {
    return problemResponse(err);
  }
}
