import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { StartShadowEvaluationRequestSchema } from "@nextbot/contracts";
import { handleListShadowEvaluations, handleStartShadowEvaluation } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET|POST /api/v1/admin/agent-platform/definitions/:id/shadow-evaluations`
 * (Phase 17, BL-48, ADR-0019 §2.5/§2.6, LLD §15.7).
 *
 * RBAC: `agent_platform=Read` to list, `agent_platform=Write` to start — the same level as
 * promotion, per ADR-0019 §2.6's explicit "no new privilege ladder". Starting an
 * experiment is audit-logged through the transactional outbox like every other deployment
 * action.
 *
 * **This is a spend-incurring action and the API treats it as one.** A shadow evaluation
 * sends real customer conversation content to a model provider a second time, through the
 * same Model Gateway route machinery with the same residency and plan-tier governance (so
 * it can never reach a provider or region the live run could not). `samplePct`, `maxRuns`
 * and `maxCostUsd` are all REQUIRED by the request schema — an experiment with no stated
 * stopping condition is not something this endpoint will create — and all three are
 * enforced for real by the enqueue-side sampling roll and the pump's ceiling check, not
 * merely recorded.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    return NextResponse.json(await handleListShadowEvaluations(guard.ctx, id));
  } catch (err) {
    return problemResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(StartShadowEvaluationRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid shadow-evaluation request.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handleStartShadowEvaluation(guard.ctx, id, body, guard.session.userId), { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
