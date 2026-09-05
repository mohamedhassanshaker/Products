import { NextResponse } from "next/server";
import { handleListEvalCaseResults } from "@nextbot/agent-platform";
import { requireApi } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/agent-platform/eval-runs/:id/results` (RBAC: agent_platform=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse | Response> {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  return NextResponse.json({ results: await handleListEvalCaseResults(guard.ctx, id) });
}
