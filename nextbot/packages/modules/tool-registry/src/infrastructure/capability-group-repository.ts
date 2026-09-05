import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { CapabilityGroupNameDuplicateError } from "@nextbot/contracts";

export interface CapabilityGroupRow {
  id: string;
  tenantId: string;
  name: string;
  guidanceText: string | null;
  priorityWeight: number;
}

export async function listCapabilityGroups(ctx: TenantContext): Promise<CapabilityGroupRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.capabilityGroup)
      .where(and(eq(schema.capabilityGroup.tenantId, ctx.tenantId), isNull(schema.capabilityGroup.deletedAt))),
  );
}

/** A `CapabilityGroupRow` plus how many `tool` rows currently reference it — Phase 10
 * (client-feedback-batch item 8) needs this for the Design Studio's capability-group
 * picker, so an admin can see at a glance which groups actually have tools assigned
 * before picking one for an agent's tool policy. */
export interface CapabilityGroupWithToolCount extends CapabilityGroupRow {
  toolCount: number;
}

/**
 * Same tenant-scoped, non-deleted `capability_group` rows as `listCapabilityGroups`,
 * with a live `LEFT JOIN` count of `tool` rows currently assigned to each group. The
 * join's own `tool.tenant_id` condition is redundant with `withTenant`'s RLS policy
 * (defense in depth, not a substitute for it — matches this repository's existing
 * `listCapabilityGroups`/`tool-repository.ts` convention of also filtering explicitly
 * by tenant id in the query itself, never relying on RLS alone). Ordered by name for a
 * stable, predictable picker list (no natural creation-order significance here, unlike
 * `tool-repository.ts`'s `listTools`).
 */
export async function listCapabilityGroupsWithToolCounts(ctx: TenantContext): Promise<CapabilityGroupWithToolCount[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({
        id: schema.capabilityGroup.id,
        tenantId: schema.capabilityGroup.tenantId,
        name: schema.capabilityGroup.name,
        guidanceText: schema.capabilityGroup.guidanceText,
        priorityWeight: schema.capabilityGroup.priorityWeight,
        toolCount: sql<number>`count(${schema.tool.id})`.mapWith(Number),
      })
      .from(schema.capabilityGroup)
      .leftJoin(
        schema.tool,
        and(eq(schema.tool.capabilityGroupId, schema.capabilityGroup.id), eq(schema.tool.tenantId, ctx.tenantId)),
      )
      .where(and(eq(schema.capabilityGroup.tenantId, ctx.tenantId), isNull(schema.capabilityGroup.deletedAt)))
      .groupBy(
        schema.capabilityGroup.id,
        schema.capabilityGroup.tenantId,
        schema.capabilityGroup.name,
        schema.capabilityGroup.guidanceText,
        schema.capabilityGroup.priorityWeight,
      )
      .orderBy(asc(schema.capabilityGroup.name));
    return rows;
  });
}

/**
 * Phase 17 (client-feedback-batch capability-group enforcement) — resolves an agent
 * version's `toolPolicy.capabilityGroups` **names** (the shape the Design Studio
 * picker writes, `AgentDefinitionArtifactSchema.spec.toolPolicy.capabilityGroups`) to
 * the real, tenant-scoped `capability_group.id`s they currently refer to.
 *
 * Tenant isolation is structural here, not an extra check: `withTenant`'s RLS plus
 * this query's own explicit `tenant_id` filter mean a name that happens to collide
 * with a DIFFERENT tenant's group can never resolve to that other tenant's id — the
 * lookup simply never sees rows outside `ctx.tenantId`.
 *
 * A stale/deleted/renamed name (no longer matching any non-deleted row for this
 * tenant) silently contributes nothing to the result — callers must NOT treat a
 * shorter-than-`names.length` result as an error; it is the expected shape of "some
 * of this agent's configured groups no longer exist," and the caller's own filtering
 * (`tool-repository.ts`'s `listTools`, `permission-resolver.ts`'s
 * `capability_group_not_permitted` check) already treats "not in this id list" as
 * "not permitted" without needing to distinguish why a name didn't resolve.
 */
export async function resolveCapabilityGroupIdsByNames(ctx: TenantContext, names: string[]): Promise<string[]> {
  if (names.length === 0) return [];
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ id: schema.capabilityGroup.id })
      .from(schema.capabilityGroup)
      .where(
        and(
          eq(schema.capabilityGroup.tenantId, ctx.tenantId),
          inArray(schema.capabilityGroup.name, names),
          isNull(schema.capabilityGroup.deletedAt),
        ),
      );
    return rows.map((r) => r.id);
  });
}

export async function createCapabilityGroup(
  ctx: TenantContext,
  input: { name: string; guidanceText?: string; priorityWeight?: number },
): Promise<string> {
  const id = generateId();
  await withTenant(ctx, async (db: TenantScopedClient) => {
    // Pre-check, not a caught unique-violation — mirrors this codebase's existing
    // `agent-definition-repository.ts` convention for name-duplicate errors (a small,
    // accepted TOCTOU race under the same tenant is no worse than every other
    // name-uniqueness check in this codebase).
    const existing = await db
      .select({ id: schema.capabilityGroup.id })
      .from(schema.capabilityGroup)
      .where(and(eq(schema.capabilityGroup.tenantId, ctx.tenantId), eq(schema.capabilityGroup.name, input.name), isNull(schema.capabilityGroup.deletedAt)));
    if (existing.length > 0) throw new CapabilityGroupNameDuplicateError(input.name);

    await db.insert(schema.capabilityGroup).values({
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      guidanceText: input.guidanceText ?? null,
      priorityWeight: input.priorityWeight ?? 50,
    });
  });
  return id;
}

/**
 * Phase 6 (BL-28, FR-MCP-17) — renames/re-describes/re-weights an existing capability
 * group in place. Never touches `tool.capability_group_id` (that's `setToolCapability
 * Group` in `tool-repository.ts`, a per-tool action) — this only edits the group row
 * itself. Silently a no-op against a different tenant's or an already-deleted group,
 * by construction: `withTenant`'s RLS plus this query's own explicit `tenant_id` /
 * `deletedAt IS NULL` filter mean the `UPDATE` simply matches zero rows rather than
 * ever touching one it shouldn't.
 */
export async function updateCapabilityGroup(
  ctx: TenantContext,
  id: string,
  input: { name?: string; guidanceText?: string | null; priorityWeight?: number },
): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    if (input.name !== undefined) {
      const collision = await db
        .select({ id: schema.capabilityGroup.id })
        .from(schema.capabilityGroup)
        .where(
          and(
            eq(schema.capabilityGroup.tenantId, ctx.tenantId),
            eq(schema.capabilityGroup.name, input.name),
            isNull(schema.capabilityGroup.deletedAt),
            ne(schema.capabilityGroup.id, id),
          ),
        );
      if (collision.length > 0) throw new CapabilityGroupNameDuplicateError(input.name);
    }

    await db
      .update(schema.capabilityGroup)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.guidanceText !== undefined ? { guidanceText: input.guidanceText } : {}),
        ...(input.priorityWeight !== undefined ? { priorityWeight: input.priorityWeight } : {}),
      })
      .where(and(eq(schema.capabilityGroup.tenantId, ctx.tenantId), eq(schema.capabilityGroup.id, id), isNull(schema.capabilityGroup.deletedAt)));
  });
}

/**
 * Phase 6 (BL-28, FR-MCP-17) — soft-deletes a capability group and, in the **same
 * transaction**, reassigns every tool currently pointing at it to Ungrouped
 * (`capability_group_id = NULL`) — LLD §14.3.3's documented behavior: "deleting a
 * group with tools assigned reassigns them to Ungrouped," never a cascade delete of
 * the tools themselves. The group row itself is soft-deleted (`deleted_at`), matching
 * this table's existing convention (`listCapabilityGroups`'s `isNull(deletedAt)`
 * filter) rather than a hard `DELETE`, so the group's own history/audit trail is never
 * lost — the `tool.capability_group_id` FK's `ON DELETE SET NULL` (migration
 * `0034_capability_group_fk_set_null.sql`) is additional, belt-and-suspenders
 * enforcement at the engine level in case anything ever does hard-delete a group row
 * directly, but the actual mutation path here is the explicit `UPDATE ... SET
 * capability_group_id = NULL` this function performs, not a reliance on the FK firing.
 *
 * @returns the number of `tool` rows reassigned to Ungrouped by this call — the
 * console's confirmation dialog shows this count *before* the user confirms (via a
 * separate read, `countToolsInCapabilityGroup`), and this return value lets a caller
 * that skips the confirmation step still know what happened.
 */
export async function deleteCapabilityGroup(ctx: TenantContext, id: string): Promise<{ reassignedToolCount: number }> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const reassigned = await db
      .update(schema.tool)
      .set({ capabilityGroupId: null })
      .where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.capabilityGroupId, id)))
      .returning({ id: schema.tool.id });

    await db
      .update(schema.capabilityGroup)
      .set({ deletedAt: new Date() })
      .where(and(eq(schema.capabilityGroup.tenantId, ctx.tenantId), eq(schema.capabilityGroup.id, id), isNull(schema.capabilityGroup.deletedAt)));

    return { reassignedToolCount: reassigned.length };
  });
}

/** Backs the confirm-dialog's "this will un-group N tools" count (LLD §14.3.3) —
 * read-only, called before `deleteCapabilityGroup` so the console can show the
 * affected count ahead of the destructive confirmation, not just after the fact. */
export async function countToolsInCapabilityGroup(ctx: TenantContext, id: string): Promise<number> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ id: schema.tool.id })
      .from(schema.tool)
      .where(and(eq(schema.tool.tenantId, ctx.tenantId), eq(schema.tool.capabilityGroupId, id)));
    return rows.length;
  });
}
