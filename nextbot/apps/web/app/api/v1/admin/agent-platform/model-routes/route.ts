import { NextResponse } from "next/server";
import { requireApi } from "@/src/lib/api-guard";

/**
 * Target Architecture Blueprint Phase 2 (BL-33, LLD §14.8.6/§14.9.6) — RETIRED. The
 * v1 free-text-chain `model_route` shape this endpoint served no longer exists
 * (Route v2's `model_route`/`model_route_version` schema, migration `0044`) — Route
 * management has moved to `/api/v1/admin/model-gateway/routes` (`@nextbot/model-gateway`,
 * LLD §14.8.5) and its console screen to `/model-gateway`'s new "Routes" tab. `GET`
 * is kept as a `410 Gone` (not a bare 404) so any stale client/bookmark gets an
 * explicit, actionable signal rather than an ambiguous "not found"; `PUT` (the old
 * save path) is removed entirely.
 */
export async function GET() {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json(
    { type: "about:blank", title: "This endpoint has moved.", status: 410, detail: "Model routes now live at /api/v1/admin/model-gateway/routes." },
    { status: 410 },
  );
}
