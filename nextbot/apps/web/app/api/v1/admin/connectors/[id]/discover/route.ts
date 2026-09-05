import { NextResponse } from "next/server";
import { discoverAndSyncTools } from "@nextbot/tool-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/connectors/{id}/discover` (FR-MCP-01/02, RBAC:
 * connectors=Write per the LLD's admin API table) — discovers the connector's tools
 * and syncs them into the catalog (`@nextbot/tool-registry`'s BL-03 service, which
 * itself calls `@nextbot/connectors`'s discovery flow).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("connectors", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  try {
    const result = await discoverAndSyncTools(guard.ctx, id);
    return NextResponse.json(result);
  } catch (err) {
    return problemResponse(err);
  }
}
