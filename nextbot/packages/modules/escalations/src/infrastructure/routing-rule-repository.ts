import { asc, eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { RoutingRule, RoutingRuleConditions } from "../domain/escalation-routing.js";

/** Lists the tenant's routing rules in evaluation order (ascending `ordinal`) — B.5.3's
 * rules table, and the exact shape `resolveRoutingQueue` consumes. */
export async function listRoutingRules(ctx: TenantContext): Promise<RoutingRule[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.escalationRoutingRule)
      .where(eq(schema.escalationRoutingRule.tenantId, ctx.tenantId))
      .orderBy(asc(schema.escalationRoutingRule.ordinal));
    return rows.map((r) => ({
      id: r.id,
      ordinal: r.ordinal,
      conditions: r.conditions as RoutingRuleConditions,
      queueId: r.queueId,
      enabled: r.enabled,
    }));
  });
}

/**
 * Ordered full replace (LLD §5.8 `PUT /escalation-routing-rules`) — B.5.3 edits the
 * whole rules table at once (add/remove/reorder), which is simpler and less
 * error-prone to reason about than a partial patch API for an ordinal-sequenced list.
 * Runs inside one transaction: delete-all then re-insert, so a caller never observes
 * a partially-replaced rule set.
 */
export async function replaceRoutingRules(
  ctx: TenantContext,
  rules: Array<{ conditions: RoutingRuleConditions; queueId: string; enabled: boolean }>,
): Promise<RoutingRule[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    await db.delete(schema.escalationRoutingRule).where(eq(schema.escalationRoutingRule.tenantId, ctx.tenantId));
    const toInsert = rules.map((rule, index) => ({
      id: generateId(),
      tenantId: ctx.tenantId,
      ordinal: index + 1,
      conditions: rule.conditions,
      queueId: rule.queueId,
      enabled: rule.enabled,
    }));
    if (toInsert.length > 0) {
      await db.insert(schema.escalationRoutingRule).values(toInsert);
    }
    return toInsert.map((r) => ({ id: r.id, ordinal: r.ordinal, conditions: r.conditions, queueId: r.queueId, enabled: r.enabled }));
  });
}
