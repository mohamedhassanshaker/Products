import { NextResponse } from "next/server";
import { handleSubmitEnrol } from "@nextbot/mcp-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/**
 * `POST /api/v1/admin/mcp/enrolments/{draftId}/enrol` — wizard step 9, terminal.
 * Re-validates the whole draft server-side (a client cannot skip a step by calling
 * this early), writes the real `mcp_server`/`mcp_server_version`/`mcp_manifest_item`/
 * `mcp_environment_binding`/`tool` rows, and — here, at the composition root, per
 * this codebase's established "packages/modules/** can't import @nextbot/audit"
 * convention (`apps/web/src/lib/record-admin-audit.ts`) — writes the audit log entry
 * FR-MCP-16 step 9 requires, including the manifest hash.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const guard = await requireApi("connectors", "Write");
  if (guard instanceof Response) return guard;
  const { draftId } = await params;

  try {
    const result = await handleSubmitEnrol(guard.ctx, draftId, guard.session.userId);
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "mcp_server.enrol",
      targetType: "McpServer",
      targetId: result.serverId,
      outcome: "Success",
      details: { serverVersionId: result.serverVersionId, version: result.version, manifestHash: result.manifestHash, materialisedToolCount: result.materialisedToolIds.length },
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "mcp_server.enrol",
      targetType: "McpServer",
      targetId: null,
      outcome: "Failure",
      details: { draftId, error: err instanceof Error ? err.message : String(err) },
    });
    return problemResponse(err);
  }
}
