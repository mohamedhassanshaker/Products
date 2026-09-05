import { NextResponse, type NextRequest } from "next/server";
import { reseedTenantQuotaFromTier } from "@nextbot/tenancy";
import { requirePlatformApi } from "@/src/lib/platform-api-guard";
import { apiMethodNotFoundHandler } from "@/src/lib/api-not-found-response";
import { PLATFORM_OPERATOR_ACTOR_LABEL } from "@/src/lib/platform-ops-auth";
import { problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/internal/ops/tenants/:id/plan-tier/reseed-quota` — the Tenant Detail
 * screen's explicit "Re-seed quota from tier defaults" action (Platform Manager
 * console Phase 2, NFR-11). Deliberately its own nested route rather than a flag on
 * `../route.ts` (the plain plan-tier-label-change endpoint): a distinct HTTP verb
 * (`POST`, not `PATCH`) *and* a distinct path both have to be hit for a quota
 * overwrite to happen, so this action cannot be triggered by that endpoint by
 * accident. Reapplies the tenant's *current* plan tier's *current* quota defaults
 * (reflecting any plan-tier-definition edits made since this tenant was provisioned
 * or last re-seeded) to `tenant_runtime_quota`, overwriting whatever quota numbers
 * are there now — the UI's confirm-dialog copy makes that overwrite explicit before
 * this endpoint is ever called.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformApi(request);
  if (guard instanceof Response) return guard;

  const { id } = await params;
  try {
    const result = await reseedTenantQuotaFromTier(id, PLATFORM_OPERATOR_ACTOR_LABEL);
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
export const PUT = apiMethodNotFoundHandler;
export const PATCH = apiMethodNotFoundHandler;
export const DELETE = apiMethodNotFoundHandler;
export const OPTIONS = apiMethodNotFoundHandler;
