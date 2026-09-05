import { NextResponse, type NextRequest } from "next/server";
import { handleListEvalRuns, handleRunEvalSuite } from "@nextbot/agent-platform";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/agent-platform/versions/:id/eval-runs` (RBAC: agent_platform=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  return NextResponse.json({ runs: await handleListEvalRuns(guard.ctx, id) });
}

/** `POST /api/v1/admin/agent-platform/versions/:id/eval-runs` (RBAC: agent_platform=Write)
 * — triggers a real eval run (FR-AGT-06) against the version's bound eval suite. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    const run = await handleRunEvalSuite(guard.ctx, id, "Manual");
    return NextResponse.json({ run }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
