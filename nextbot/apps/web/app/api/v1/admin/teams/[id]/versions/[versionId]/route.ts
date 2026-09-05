import { NextResponse } from "next/server";
import { handleGetTeamVersion } from "@nextbot/teams";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/teams/{id}/versions/{versionId}` (RBAC: `agent_platform=Read`).
 * Returns the version with its members inlined, the transitions the console should
 * offer, and — FR-ORC-11 — which members a recorded sandbox run has NOT yet
 * exercised, so the console can show the gap before an approval is attempted rather
 * than only refusing afterwards.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { versionId } = await params;
  try {
    return NextResponse.json(await handleGetTeamVersion(guard.ctx, versionId));
  } catch (err) {
    return problemResponse(err);
  }
}
