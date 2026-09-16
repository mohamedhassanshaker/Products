/**
 * The real `ToolBindingRepository` — `ToolBindings`, per-tenant. **The shared path**: both
 * the wizard's step 4 and B5's Server Actions call this exact class (via
 * `modules/tools/application/{bind,unbind}-tool.ts`) — see `tasks/todo.md`'s
 * module-boundary note for why that identity, not a shared UI control, is what "the same
 * data" means here.
 *
 * `ToolBindings` carries no Prisma `@@unique` (only the three raw-SQL filtered unique
 * indexes in `001_constraints.sql`, one per target kind) — so `bind()` is a manual
 * find-then-create-or-update, not a Prisma compound-key `upsert`.
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import {
  isRequiredAssuranceLevel,
  isToolBindingTargetKind,
  type RequiredAssuranceLevel,
} from "../../../domain/tool-catalog.js";
import type {
  BindToolResult,
  ToolBindingRepository,
  ToolBindingRow,
} from "../../../ports/tool-binding-repository.js";

const OPERATION = "tools tool-binding repository";

/**
 * `TR_ToolBindings_serverMustBeConnected`'s two THROW texts (`001_constraints.sql`),
 * matched by substring — the same already-proven pattern `PrismaRoleRepository.
 * findProtectedChange` uses. Prisma does not reliably surface the raw SQL Server error
 * number on this path (confirmed absent as a usable, structured field on the wrapped
 * error), so `domain/tool-catalog.ts`'s `TOOL_BINDING_*_ERROR_NUMBER` constants document
 * *which* trigger block this is for a reader following the SQL file, without this adapter
 * pretending to match on them directly.
 */
const SERVER_NOT_CONNECTED_FRAGMENT = "requires a Connected MCP server and a live tool";
const SOFT_DELETED_TARGET_FRAGMENT = "cannot be newly bound";

/**
 * Built via explicit conditionals rather than a computed property name (`{[column]:
 * targetId}`) — Prisma's generated `ToolBindingWhereInput` is a concrete, per-field object
 * type, not an index signature, and a computed key built from a runtime string union does
 * not reliably typecheck cleanly against it. This is the unambiguous, always-correct
 * alternative.
 */
function targetWhereClause(
  agentVersionId: string,
  targetKind: "Skill" | "McpTool" | "ApiConnector",
  targetId: string,
): { agentVersionId: string; skillId?: string; mcpToolId?: string; apiConnectorId?: string } {
  if (targetKind === "Skill") return { agentVersionId, skillId: targetId };
  if (targetKind === "McpTool") return { agentVersionId, mcpToolId: targetId };
  return { agentVersionId, apiConnectorId: targetId };
}

function toRow(row: {
  id: string;
  agentVersionId: string;
  targetKind: string;
  skillId: string | null;
  mcpToolId: string | null;
  apiConnectorId: string | null;
  isEnabled: boolean;
  argumentPolicyJson: string | null;
  requiredAssurance: string;
  rateLimitPolicyId: string | null;
  boundByStaffUserId: string;
  boundAt: Date;
}): ToolBindingRow {
  if (
    !isToolBindingTargetKind(row.targetKind) ||
    !isRequiredAssuranceLevel(row.requiredAssurance)
  ) {
    throw new Error(`ToolBinding ${row.id} has an unrecognized targetKind/requiredAssurance.`);
  }
  return {
    id: row.id,
    agentVersionId: row.agentVersionId,
    targetKind: row.targetKind,
    skillId: row.skillId,
    mcpToolId: row.mcpToolId,
    apiConnectorId: row.apiConnectorId,
    isEnabled: row.isEnabled,
    argumentPolicyJson: row.argumentPolicyJson,
    requiredAssurance: row.requiredAssurance,
    rateLimitPolicyId: row.rateLimitPolicyId,
    boundByStaffUserId: row.boundByStaffUserId,
    boundAt: row.boundAt,
  };
}

export class PrismaToolBindingRepository implements ToolBindingRepository {
  async listForVersion(agentVersionId: string): Promise<readonly ToolBindingRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.toolBinding.findMany({ where: { agentVersionId } });
    return rows.map(toRow);
  }

  async bind(input: {
    readonly agentVersionId: string;
    readonly targetKind: "Skill" | "McpTool" | "ApiConnector";
    readonly targetId: string;
    readonly requiredAssurance: RequiredAssuranceLevel;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<BindToolResult> {
    const db = getTenantDb(OPERATION);
    const existing = await db.toolBinding.findFirst({
      where: targetWhereClause(input.agentVersionId, input.targetKind, input.targetId),
    });

    try {
      if (existing) {
        // Re-binding an existing, currently-disabled row flips isEnabled back to true
        // without disturbing the original boundByStaffUserId/boundAt — attribution is "who
        // first granted this," not "who most recently toggled it."
        const row = await db.toolBinding.update({
          where: { id: existing.id },
          data: { isEnabled: true, updatedAt: input.now },
        });
        return { ok: true, binding: toRow(row) };
      }

      const row = await db.toolBinding.create({
        data: {
          id: newUlid(input.now),
          agentVersionId: input.agentVersionId,
          targetKind: input.targetKind,
          skillId: input.targetKind === "Skill" ? input.targetId : null,
          mcpToolId: input.targetKind === "McpTool" ? input.targetId : null,
          apiConnectorId: input.targetKind === "ApiConnector" ? input.targetId : null,
          isEnabled: true,
          argumentPolicyJson: null,
          requiredAssurance: input.requiredAssurance,
          rateLimitPolicyId: null,
          boundByStaffUserId: input.actorStaffUserId,
          boundAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
      return { ok: true, binding: toRow(row) };
    } catch (error) {
      if (error instanceof Error && error.message.includes(SERVER_NOT_CONNECTED_FRAGMENT)) {
        return { ok: false, reason: "tools.server_not_connected" };
      }
      if (error instanceof Error && error.message.includes(SOFT_DELETED_TARGET_FRAGMENT)) {
        return { ok: false, reason: "tools.target_soft_deleted" };
      }
      throw error;
    }
  }

  async unbind(input: {
    readonly agentVersionId: string;
    readonly targetKind: "Skill" | "McpTool" | "ApiConnector";
    readonly targetId: string;
  }): Promise<
    { readonly ok: true } | { readonly ok: false; readonly reason: "tools.binding_not_found" }
  > {
    const db = getTenantDb(OPERATION);
    const existing = await db.toolBinding.findFirst({
      where: targetWhereClause(input.agentVersionId, input.targetKind, input.targetId),
    });
    if (!existing) return { ok: false, reason: "tools.binding_not_found" };

    // isEnabled: false only — never a delete, so bind history/attribution survives a later
    // re-bind. Note this bypasses TR_ToolBindings_serverMustBeConnected's own gap (its
    // first block has no `isEnabled` condition, unlike its AgentFlowBindings sibling) only
    // because an UPDATE that changes nothing the trigger's WHERE clause inspects besides
    // `isEnabled` can still re-trigger it if the target has since become disconnected — a
    // known, flagged, unfixed SQL-layer edge case (tasks/todo.md's B-3 review).
    await db.toolBinding.update({ where: { id: existing.id }, data: { isEnabled: false } });
    return { ok: true };
  }

  async countEnabledBindingsBySkill(): Promise<ReadonlyMap<string, number>> {
    const db = getTenantDb(OPERATION);
    const rows = await db.toolBinding.groupBy({
      by: ["skillId"],
      where: { targetKind: "Skill", isEnabled: true },
      _count: { _all: true },
    });
    return new Map(
      rows.filter((r) => r.skillId !== null).map((r) => [r.skillId as string, r._count._all]),
    );
  }

  async countEnabledBindingsByMcpTool(): Promise<ReadonlyMap<string, number>> {
    const db = getTenantDb(OPERATION);
    const rows = await db.toolBinding.groupBy({
      by: ["mcpToolId"],
      where: { targetKind: "McpTool", isEnabled: true },
      _count: { _all: true },
    });
    return new Map(
      rows.filter((r) => r.mcpToolId !== null).map((r) => [r.mcpToolId as string, r._count._all]),
    );
  }

  async countEnabledBindingsByApiConnector(): Promise<ReadonlyMap<string, number>> {
    const db = getTenantDb(OPERATION);
    const rows = await db.toolBinding.groupBy({
      by: ["apiConnectorId"],
      where: { targetKind: "ApiConnector", isEnabled: true },
      _count: { _all: true },
    });
    return new Map(
      rows
        .filter((r) => r.apiConnectorId !== null)
        .map((r) => [r.apiConnectorId as string, r._count._all]),
    );
  }
}
