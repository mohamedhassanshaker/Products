import { NextResponse, type NextRequest } from "next/server";
import { listPlanTierDefinitions } from "@nextbot/tenancy";
import { requirePlatformApi } from "@/src/lib/platform-api-guard";
import { apiMethodNotFoundHandler } from "@/src/lib/api-not-found-response";
import { problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/internal/ops/plan-tiers` — the Plan Tiers screen's data source
 * (Platform Manager console Phase 2, NFR-11). Lists all three plan-tier
 * definitions (Starter/Growth/Enterprise); editing an individual tier is
 * `PATCH /api/internal/ops/plan-tiers/:tier`.
 */
export async function GET(request: NextRequest) {
  const guard = await requirePlatformApi(request);
  if (guard instanceof Response) return guard;

  try {
    const tiers = await listPlanTierDefinitions();
    return NextResponse.json({ tiers });
  } catch (err) {
    return problemResponse(err);
  }
}

/**
 * Every verb this route does not implement, claimed explicitly so Next cannot answer
 * it with a route-existence-confirming `405`/`OPTIONS: Allow` *before* the guard runs
 * (NFR-11, established Phase 1 precedent).
 */
export const POST = apiMethodNotFoundHandler;
export const PUT = apiMethodNotFoundHandler;
export const PATCH = apiMethodNotFoundHandler;
export const DELETE = apiMethodNotFoundHandler;
export const OPTIONS = apiMethodNotFoundHandler;
