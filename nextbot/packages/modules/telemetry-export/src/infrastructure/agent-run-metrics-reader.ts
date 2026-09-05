import { and, avg, count, eq, gte, ne, sum } from "drizzle-orm";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

export interface AgentRunMetricsSnapshot {
  succeededCount: number;
  failedCount: number;
  avgDurationMs: number | null;
  totalCostUsd: number | null;
}

/**
 * The periodic OTel metric snapshot's own read side: a real aggregate over
 * `agent_run` for the last `sinceMinutesAgo` minutes — reused directly via
 * `@nextbot/db`'s shared schema (not a module import; `agent_run` is shared
 * infrastructure the same way `domain_event` is, see this codebase's established
 * "reading another module's table via the shared schema package" precedent, e.g.
 * `authz`'s Phase 6 `delegation_event` tree query).
 *
 * Excludes `trigger = 'ShadowEvaluation'` runs — the same exclusion `@nextbot/
 * agent-platform`'s own `excludeShadowRuns()` applies to every ordinary reporting
 * aggregate (Phase 17, ADR-0019 §2.5's analytics containment): shadow-evaluation
 * traffic no customer ever saw must never inflate a tenant's real operational
 * metrics, including the ones now leaving the building to their own SIEM/APM stack.
 * Deliberately re-derived inline here rather than importing `@nextbot/agent-platform`
 * for one predicate — this module stays a true leaf (no module-to-module edge) for a
 * single, trivial, unlikely-to-drift enum comparison.
 */
export async function getAgentRunMetricsSnapshot(ctx: TenantContext, sinceMinutesAgo: number): Promise<AgentRunMetricsSnapshot> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const since = new Date(Date.now() - sinceMinutesAgo * 60_000);
    const baseWhere = and(eq(schema.agentRun.tenantId, ctx.tenantId), gte(schema.agentRun.startedAt, since), ne(schema.agentRun.trigger, "ShadowEvaluation"));

    const [succeeded] = await db
      .select({ count: count() })
      .from(schema.agentRun)
      .where(and(baseWhere, eq(schema.agentRun.status, "Succeeded")));
    const [failed] = await db
      .select({ count: count() })
      .from(schema.agentRun)
      .where(and(baseWhere, eq(schema.agentRun.status, "Failed")));
    const [aggregates] = await db
      .select({ avgDurationMs: avg(schema.agentRun.durationMs), totalCostUsd: sum(schema.agentRun.costUsd) })
      .from(schema.agentRun)
      .where(baseWhere);

    return {
      succeededCount: succeeded?.count ?? 0,
      failedCount: failed?.count ?? 0,
      avgDurationMs: aggregates?.avgDurationMs != null ? Number(aggregates.avgDurationMs) : null,
      totalCostUsd: aggregates?.totalCostUsd != null ? Number(aggregates.totalCostUsd) : null,
    };
  });
}
