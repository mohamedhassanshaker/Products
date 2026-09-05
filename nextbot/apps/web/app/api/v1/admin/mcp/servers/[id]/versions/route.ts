import { NextResponse } from "next/server";
import { handleListServerVersions } from "@nextbot/mcp-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/mcp/servers/{id}/versions` — the detail screen's "Versions"
 * tab (RBAC: connectors=Read). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("connectors", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    const versions = await handleListServerVersions(guard.ctx, id);
    return NextResponse.json({ versions });
  } catch (err) {
    return problemResponse(err);
  }
}
