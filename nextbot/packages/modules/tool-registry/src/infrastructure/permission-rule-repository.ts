import { and, eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { ApprovalTierValue, PermissionCondition, PermissionEffectValue } from "@nextbot/contracts";
import type { ResolverRule } from "../domain/permission-resolver.js";

/** The tool-scoped rules an admin edits in the rule-builder UI for one specific tool
 * (as opposed to `listAllRules`, which the resolver uses across every scope). */
export async function listToolScopedRules(ctx: TenantContext, toolId: string): Promise<ResolverRule[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.toolPermissionRule)
      .where(and(eq(schema.toolPermissionRule.tenantId, ctx.tenantId), eq(schema.toolPermissionRule.toolId, toolId), eq(schema.toolPermissionRule.scope, "Tool")));
    return rows.map(toResolverRule);
  });
}

/** Loads every rule for the tenant (used by the resolver, which itself filters by
 * scope/target — see `permission-resolver.ts`). A tenant's total rule count is small
 * enough (bounded by tool/connector/backend-type counts) that loading all of them per
 * resolution and filtering in memory is simpler and fast enough for this phase; a
 * future phase can add scoped queries if profiling shows a need. */
export async function listAllRules(ctx: TenantContext): Promise<ResolverRule[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.toolPermissionRule).where(eq(schema.toolPermissionRule.tenantId, ctx.tenantId));
    return rows.map(toResolverRule);
  });
}

export async function replaceRulesForTool(ctx: TenantContext, toolId: string, rules: NewRuleInput[]): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .delete(schema.toolPermissionRule)
      .where(and(eq(schema.toolPermissionRule.tenantId, ctx.tenantId), eq(schema.toolPermissionRule.toolId, toolId), eq(schema.toolPermissionRule.scope, "Tool")));
    for (const rule of rules) {
      await db.insert(schema.toolPermissionRule).values({
        id: generateId(),
        tenantId: ctx.tenantId,
        scope: "Tool",
        toolId,
        connectorId: null,
        backendType: null,
        ordinal: rule.ordinal,
        conditions: rule.conditions,
        effect: rule.effect,
        requiredTier: rule.requiredTier ?? null,
        enabled: rule.enabled ?? true,
      });
    }
  });
}

export interface NewRuleInput {
  ordinal: number;
  conditions: PermissionCondition;
  effect: PermissionEffectValue;
  requiredTier?: ApprovalTierValue;
  enabled?: boolean;
}

function toResolverRule(row: typeof schema.toolPermissionRule.$inferSelect): ResolverRule {
  return {
    id: row.id,
    scope: row.scope,
    toolId: row.toolId,
    connectorId: row.connectorId,
    backendType: row.backendType,
    ordinal: row.ordinal,
    conditions: row.conditions as PermissionCondition,
    effect: row.effect,
    requiredTier: row.requiredTier,
    enabled: row.enabled,
  };
}
