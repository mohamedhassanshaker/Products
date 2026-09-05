import { NextResponse } from "next/server";
import { handleGetServer, handleListBindingsForVersion, listManifestItemsFull } from "@nextbot/mcp-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/mcp/servers/{id}` — definition detail (RBAC: connectors=Read).
 * Includes the current version's environment bindings and manifest items inline
 * (the detail screen's Environments/Manifest/Tools/Resources/Prompts/Policy tabs)
 * rather than several separate round trips. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("connectors", "Read");
  if (guard instanceof Response) return guard;
  const { id } = await params;
  try {
    const mcpServer = await handleGetServer(guard.ctx, id);
    if (!mcpServer) return NextResponse.json({ type: "about:blank", title: "MCP server not found.", status: 404 }, { status: 404 });
    const bindings = mcpServer.currentVersionId ? await handleListBindingsForVersion(guard.ctx, mcpServer.currentVersionId) : [];
    const manifestItems = mcpServer.currentVersionId ? await listManifestItemsFull(guard.ctx, mcpServer.currentVersionId) : [];
    return NextResponse.json({ mcpServer, bindings, manifestItems });
  } catch (err) {
    return problemResponse(err);
  }
}
