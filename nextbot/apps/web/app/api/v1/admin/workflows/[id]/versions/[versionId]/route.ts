import { NextResponse } from "next/server";
import { handleGetWorkflowVersion } from "@nextbot/workflows";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/workflows/{id}/versions/{versionId}` (RBAC:
 * `agent_platform=Read`). Returns the version plus the transitions the console
 * should offer (`allowedTransitions`, computed by the same `domain/promotion-
 * policy.ts` function the transition endpoint enforces with).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  const { versionId } = await params;
  try {
    return NextResponse.json(await handleGetWorkflowVersion(guard.ctx, versionId));
  } catch (err) {
    return problemResponse(err);
  }
}
