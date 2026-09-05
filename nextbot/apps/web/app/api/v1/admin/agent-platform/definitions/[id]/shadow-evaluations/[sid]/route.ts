import { NextResponse } from "next/server";
import { handleGetShadowEvaluationReport } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/agent-platform/definitions/:id/shadow-evaluations/:sid`
 * (Phase 17, BL-48, ADR-0019 §2.5, LLD §15.7) — the comparison report: counters, spend,
 * reply/tool-call divergence, escalation rate and candidate latency percentiles.
 *
 * RBAC: `agent_platform=Read`. The experiment is looked up under the caller's own
 * RLS-scoped tenant context, so `sid` cannot reach another tenant's experiment.
 *
 * **Evidence, never a gate.** Nothing this endpoint returns promotes a version, satisfies
 * the sandbox-test-before-promote requirement, or shortens `canPromote` (ADR-0019 §2.5's
 * closing rule). There is deliberately no code path from a shadow result to a deployment
 * write anywhere in the module behind it — a human reads this and decides.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; sid: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { sid } = await params;
  try {
    return NextResponse.json(await handleGetShadowEvaluationReport(guard.ctx, sid));
  } catch (err) {
    return problemResponse(err);
  }
}
