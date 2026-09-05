import { NextResponse, type NextRequest } from "next/server";
import { handleProbeProvider } from "@nextbot/model-gateway";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/model-gateway/providers/{id}/probe` (RBAC: agent_platform=Write)
 * — FR-AGT-20's on-demand reachability/health check. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    const provider = await handleProbeProvider(guard.ctx, id);
    return NextResponse.json({ provider });
  } catch (err) {
    return problemResponse(err);
  }
}
