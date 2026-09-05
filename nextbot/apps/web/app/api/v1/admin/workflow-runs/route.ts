import { NextResponse, type NextRequest } from "next/server";
import { handleListWorkflowRuns, type ListWorkflowRunsQuery } from "@nextbot/workflows";
import type { WorkflowRunStateValue, WorkflowRunTerminalOutcomeValue } from "@nextbot/contracts";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/workflow-runs?workflowId&state&outcome&from&to&cursor` (RBAC:
 * `agent_platform=Read`) — Target Architecture Blueprint Phase 16 (BL-47b), LLD §14.6.5.
 *
 * Every filter is validated against a closed allow-list before it reaches the
 * repository, rather than being forwarded as free text. `state` and `outcome` are
 * enum-valued columns, so an unrecognized value is dropped (which widens the result set
 * to "no filter") instead of being interpolated — the query itself is parameterized
 * regardless, but validating here also means a typo'd filter cannot silently return an
 * empty page an operator would misread as "there are no runs".
 */

const RUN_STATES: WorkflowRunStateValue[] = ["Pending", "Running", "Suspended", "Compensating", "Succeeded", "Failed", "TimedOut", "Cancelled"];
const RUN_OUTCOMES: WorkflowRunTerminalOutcomeValue[] = ["Resolved", "Escalated", "Transferred", "Failed", "BudgetExceeded", "Timeout", "Cancelled"];

/** Server-side re-derivation of every client-supplied value. A caller-supplied `limit`
 *  is clamped (the repository clamps again, at 200 — defense in depth), and a
 *  non-numeric one is ignored rather than propagated as `NaN`. */
function parseQuery(url: URL): ListWorkflowRunsQuery {
  const state = url.searchParams.get("state");
  const outcome = url.searchParams.get("outcome");
  const limitRaw = Number(url.searchParams.get("limit"));

  return {
    ...(url.searchParams.get("workflowId") ? { workflowId: url.searchParams.get("workflowId")! } : {}),
    ...(url.searchParams.get("workflowVersionId") ? { workflowVersionId: url.searchParams.get("workflowVersionId")! } : {}),
    ...(state && (RUN_STATES as string[]).includes(state) ? { state: state as WorkflowRunStateValue } : {}),
    ...(outcome && (RUN_OUTCOMES as string[]).includes(outcome) ? { outcome: outcome as WorkflowRunTerminalOutcomeValue } : {}),
    ...(url.searchParams.get("from") ? { from: url.searchParams.get("from")! } : {}),
    ...(url.searchParams.get("to") ? { to: url.searchParams.get("to")! } : {}),
    ...(url.searchParams.get("cursor") ? { cursor: url.searchParams.get("cursor")! } : {}),
    ...(Number.isFinite(limitRaw) && limitRaw > 0 ? { limit: Math.min(limitRaw, 200) } : {}),
  };
}

export async function GET(request: NextRequest): Promise<NextResponse | Response> {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  try {
    return NextResponse.json(await handleListWorkflowRuns(guard.ctx, parseQuery(new URL(request.url))));
  } catch (err) {
    return problemResponse(err);
  }
}
