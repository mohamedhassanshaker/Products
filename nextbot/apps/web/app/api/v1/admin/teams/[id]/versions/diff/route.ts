import { NextResponse, type NextRequest } from "next/server";
import { handleDiffTeamVersions } from "@nextbot/teams";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/teams/{id}/versions/diff?from=&to=` (RBAC:
 * `agent_platform=Read`) — LLD §14.7.5.
 *
 * Structural (Git-independent) by construction: team versions have no Git backing at
 * all, so there is no Git-diff path to fall back to — the same situation Phase 0
 * (BL-31) already solved for artifacts without a Git remote.
 */
export async function GET(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json({ type: "about:blank", title: "Both 'from' and 'to' version ids are required.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handleDiffTeamVersions(guard.ctx, from, to));
  } catch (err) {
    return problemResponse(err);
  }
}
