import { NextResponse } from "next/server";
import { handleListPendingDrift } from "@nextbot/mcp-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/mcp/servers/{id}/drift` — pending drift events for the
 * drift-review screen (RBAC: connectors=Read). Reuses Phase 0's drift-event data
 * unchanged. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("connectors", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    const driftEvents = await handleListPendingDrift(guard.ctx, id);
    return NextResponse.json({ driftEvents });
  } catch (err) {
    return problemResponse(err);
  }
}
