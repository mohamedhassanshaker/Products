import { NextResponse, type NextRequest } from "next/server";
import { handleValidateTeamVersion } from "@nextbot/teams";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/teams/{id}/versions/{versionId}/validate` (RBAC:
 * `agent_platform=Read` — this is a dry run that writes nothing).
 *
 * NON-strict, per LLD §14.7.2: a non-router-class supervisor route comes back as a
 * `TEAM_SUPERVISOR_ROUTE_EXPENSIVE` *warning* with a 200 here, while the real save
 * (`POST .../versions`) rejects the same artifact with a 422. That split is what
 * lets the editor surface the problem while the author is still editing.
 *
 * Takes raw YAML (not a parsed artifact) so a YAML syntax error is reported by the
 * same validator the save path uses, rather than being swallowed by the route's own
 * `request.json()`.
 */
export async function POST(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || typeof body.yaml !== "string") {
    return NextResponse.json({ type: "about:blank", title: "Invalid validate payload — expected { yaml: string }.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json(await handleValidateTeamVersion(guard.ctx, body.yaml));
  } catch (err) {
    return problemResponse(err);
  }
}
