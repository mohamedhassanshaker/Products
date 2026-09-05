import { NextResponse } from "next/server";
import { handleGetDelegationTree } from "@nextbot/teams";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/agent-runs/{runId}/delegation-tree` (RBAC:
 * agent_platform:Read — same gate the Runtime Traces screen already uses, since
 * this is the same per-run observability surface). LLD §14.7.5. Returns
 * `{ roots: [] }` for every run today — there is no live delegation executor yet
 * (Phase 14/BL-46); this is the real, working read path, simply never populated
 * by anything yet.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { runId } = await params;
  try {
    return NextResponse.json(await handleGetDelegationTree(guard.ctx, runId));
  } catch (err) {
    return problemResponse(err);
  }
}
