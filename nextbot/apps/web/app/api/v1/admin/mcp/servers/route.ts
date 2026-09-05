import { NextResponse } from "next/server";
import { handleListServers } from "@nextbot/mcp-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/mcp/servers` — registry list (RBAC: connectors=Read, matching
 * Phase 0's own precedent for MCP-server-shaped configuration). */
export async function GET() {
  const guard = await requireApi("connectors", "Read");
  if (guard instanceof Response) return guard;
  try {
    const mcpServers = await handleListServers(guard.ctx);
    return NextResponse.json({ mcpServers });
  } catch (err) {
    return problemResponse(err);
  }
}
