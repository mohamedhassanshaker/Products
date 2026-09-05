import { NextResponse } from "next/server";
import { handleReconcileServer } from "@nextbot/mcp-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `POST /api/v1/admin/mcp/servers/{id}/reconcile` — manual drift check (RBAC:
 * connectors=Write, mirrors the existing "Discover" connector action's write gate). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("connectors", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    const result = await handleReconcileServer(guard.ctx, id);
    return NextResponse.json(result);
  } catch (err) {
    return problemResponse(err);
  }
}
