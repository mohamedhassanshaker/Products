import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { StopShadowEvaluationRequestSchema } from "@nextbot/contracts";
import { handleStopShadowEvaluation } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/agent-platform/definitions/:id/shadow-evaluations/:sid/stop`
 * (Phase 17, BL-48, ADR-0019 §2.5/§2.6, LLD §15.7). RBAC: `agent_platform=Write`.
 *
 * Stopping means stopping: the pump re-checks the experiment's status on every claimed run
 * and terminates an already-enqueued replay as `Skipped(EvaluationStopped)` rather than
 * spending more of a stopped experiment's budget. Idempotent by predicate — the underlying
 * `UPDATE` only matches an `Active` row, so a double-click cannot overwrite the original
 * stop reason with a second one.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; sid: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { sid } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(StopShadowEvaluationRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid stop request.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handleStopShadowEvaluation(guard.ctx, sid, body, guard.session.userId));
  } catch (err) {
    return problemResponse(err);
  }
}
