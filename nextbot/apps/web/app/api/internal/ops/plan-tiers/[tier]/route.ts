import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { PlanTierSchema, UpdatePlanTierDefinitionRequestSchema, type PlanTierValue } from "@nextbot/contracts";
import { updatePlanTierDefinition } from "@nextbot/tenancy";
import { requirePlatformApi } from "@/src/lib/platform-api-guard";
import { apiMethodNotFoundHandler } from "@/src/lib/api-not-found-response";
import { PLATFORM_OPERATOR_ACTOR_LABEL } from "@/src/lib/platform-ops-auth";
import { problemResponse } from "@/src/lib/api-guard";

/**
 * `PATCH /api/internal/ops/plan-tiers/:tier` — the Plan Tiers screen's edit action
 * (Platform Manager console Phase 2, NFR-11). `:tier` is validated against the
 * existing three-value `plan_tier` enum (`PlanTierSchema`) before it ever reaches a
 * database query — not arbitrary new tiers, that is materially larger scope than
 * this phase.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tier: string }> }) {
  const guard = await requirePlatformApi(request);
  if (guard instanceof Response) return guard;

  const { tier } = await params;
  if (!Value.Check(PlanTierSchema, tier)) {
    return NextResponse.json({ type: "about:blank", title: "Unknown plan tier.", status: 404 }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!Value.Check(UpdatePlanTierDefinitionRequestSchema, body)) {
    return NextResponse.json(
      { type: "about:blank", title: "Invalid plan-tier definition update.", status: 422 },
      { status: 422 },
    );
  }

  try {
    const result = await updatePlanTierDefinition(tier as PlanTierValue, body, PLATFORM_OPERATOR_ACTOR_LABEL);
    if (!result) {
      return NextResponse.json({ type: "about:blank", title: "Plan tier definition not found.", status: 404 }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return problemResponse(err);
  }
}

/**
 * Every verb this route does not implement, claimed explicitly so Next cannot answer
 * it with a route-existence-confirming `405`/`OPTIONS: Allow` *before* the guard runs
 * (NFR-11, established Phase 1 precedent).
 */
export const GET = apiMethodNotFoundHandler;
export const POST = apiMethodNotFoundHandler;
export const PUT = apiMethodNotFoundHandler;
export const DELETE = apiMethodNotFoundHandler;
export const OPTIONS = apiMethodNotFoundHandler;
