import { NextResponse } from "next/server";
import { handleListShadowRuns } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/agent-platform/definitions/:id/shadow-evaluations/:sid/runs`
 * (Phase 17, BL-48, LLD §15.7) — the drillable per-run list. RBAC: `agent_platform=Read`.
 *
 * Each row carries `shadowAgentRunId`, which is the ONE deliberate path by which a shadow
 * trace remains reachable: every ordinary `agent_run` reader excludes
 * `trigger = 'ShadowEvaluation'` (ADR-0019 §2.5's analytics containment), so this screen
 * is the only surface that can follow the pointer.
 *
 * `wouldHaveToolCalls` carries arguments already masked through the SAME
 * `maskArgsForLogging` every other audit path uses — never a second masking mechanism, and
 * never raw customer data.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; sid: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { sid } = await params;
  try {
    return NextResponse.json(await handleListShadowRuns(guard.ctx, sid));
  } catch (err) {
    return problemResponse(err);
  }
}
