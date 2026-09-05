import { NextResponse } from "next/server";
import { handleMigrateExistingConnectors } from "@nextbot/mcp-registry";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/**
 * `POST /api/v1/admin/mcp/servers/migrate-connectors` (LLD §14.3.1, RBAC:
 * connectors=Write) — the existing-connector migration. Attributed to the calling
 * admin (`created_by_user_id`/`owner_user_id` are NOT NULL on the synthesized
 * `mcp_server` rows — see `connector-migration.ts`'s doc comment for why this is an
 * admin-triggered action rather than an unattended background job). Idempotent:
 * safe to call more than once, and safe to call after some servers already exist via
 * the wizard.
 */
export async function POST() {
  const guard = await requireApi("connectors", "Write");
  if (guard instanceof Response) return guard;
  try {
    const result = await handleMigrateExistingConnectors(guard.ctx, guard.session.userId);
    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "mcp_server.migrate_existing_connectors",
      targetType: "McpServer",
      targetId: null,
      outcome: "Success",
      details: { ...result },
    });
    return NextResponse.json(result);
  } catch (err) {
    return problemResponse(err);
  }
}
