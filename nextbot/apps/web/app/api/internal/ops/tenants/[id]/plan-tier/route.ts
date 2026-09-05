import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { UpdateTenantPlanTierRequestSchema } from "@nextbot/contracts";
import { updateTenantPlanTier } from "@nextbot/tenancy";
import { requirePlatformApi } from "@/src/lib/platform-api-guard";
import { apiMethodNotFoundHandler } from "@/src/lib/api-not-found-response";
import { PLATFORM_OPERATOR_ACTOR_LABEL } from "@/src/lib/platform-ops-auth";
import { problemResponse } from "@/src/lib/api-guard";

/**
 * `PATCH /api/internal/ops/tenants/:id/plan-tier` — the Tenant Detail screen's
 * plan-tier-*label*-change action (Platform Manager console Phase 2, NFR-11).
 * Deliberately does NOT touch the tenant's live `tenant_runtime_quota` row — that is
 * the whole point of `updateTenantPlanTier()` being a separate function from
 * `reseedTenantQuotaFromTier()`. The re-seed action lives at its own nested path,
 * `./reseed-quota/route.ts`, precisely so it is never reachable via this endpoint by
 * accident (no body flag, no query param on *this* route can trigger it).
 *
 * Consequential like the status-change action, so the UI gates it behind its own
 * confirm dialog before calling this endpoint.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformApi(request);
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!Value.Check(UpdateTenantPlanTierRequestSchema, body)) {
    return NextResponse.json(
      { type: "about:blank", title: "Invalid plan-tier change request.", status: 422 },
      { status: 422 },
    );
  }

  const { id } = await params;
  try {
    const result = await updateTenantPlanTier(id, body.planTier, PLATFORM_OPERATOR_ACTOR_LABEL);
    if (!result) {
      return NextResponse.json({ type: "about:blank", title: "Tenant not found.", status: 404 }, { status: 404 });
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
