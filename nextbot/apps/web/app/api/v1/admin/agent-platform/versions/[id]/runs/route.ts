import { NextResponse } from "next/server";
import { handleListAgentRuns } from "@nextbot/agent-platform";
import { requireApi } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/agent-platform/versions/:id/runs` (RBAC: agent_platform=Read)
 * — UX_GUIDELINES.md §6.7's basic Runtime Observability run list. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  return NextResponse.json({ runs: await handleListAgentRuns(guard.ctx, id) });
}
