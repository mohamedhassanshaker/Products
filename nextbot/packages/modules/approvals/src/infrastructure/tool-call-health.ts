import { and, desc, eq, gte } from "drizzle-orm";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/**
 * QA fix (UI-D4, B.3A.4) — the MCP Health dashboard's missing tool-level health
 * table. `connector_health_check` (the existing probe rollup `getConnectorHealthSummary`
 * reads) is genuinely per-*connector*, not per-tool — its own doc comment admits
 * "the probe is per-connector, not per-tool, since MCP has no per-tool ping" — so
 * there is no per-tool p50/p95/p99 *probe* latency to render (a real, structural
 * gap, not a rendering one; `latencyP50Ms`/`latencyP95Ms`/`latencyP99Ms` are
 * omitted here rather than faked from connector-level numbers).
 *
 * What genuinely exists at tool granularity is real *call* data: `tool_call` rows
 * carry `tool_id`/`tool_name`/`connector_id`/`status`/`created_at` for every
 * actual invocation. This aggregates that into the call-volume/error-rate/
 * last-error-message/sparkline/uptime numbers B.3A.4 asks for at the tool level —
 * the rendering gap UI-D4 flagged, now built against the data that's actually
 * there.
 */
export interface ToolHealthSummary {
  toolId: string;
  toolName: string;
  connectorId: string | null;
  /** Calls in the last 24h. */
  callVolume: number;
  /** % of the last 24h's calls that ended `Failed`. */
  errorRatePct: number;
  /** Most recent `Failed` call's `error_message`, if any in the last 24h. */
  lastErrorMessage: string | null;
  /** Hourly call-volume buckets for the last 24h, oldest first — sparkline data. */
  sparkline: Array<{ hour: string; calls: number; failures: number }>;
  /** % of the last 30 days' calls that did NOT end `Failed` — the closest
   * available proxy for "tool uptime" this schema supports (no per-tool
   * synthetic probe exists, see module doc above). */
  uptime30dPct: number;
}

function hourBucket(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours())).toISOString();
}

/** Aggregates every tool's call history into B.3A.4's tool-level health table
 * rows. Ordered by `errorRatePct` descending by default (UI-D4's "sort by error
 * rate" — the highest-error-rate tool surfaces first, the operationally
 * interesting default). */
export async function getToolHealthSummaries(ctx: TenantContext): Promise<ToolHealthSummary[]> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  return withTenant(ctx, async (db: TenantScopedClient) => {
    const recentCalls = await db
      .select({
        id: schema.toolCall.id,
        toolId: schema.toolCall.toolId,
        toolName: schema.toolCall.toolName,
        connectorId: schema.toolCall.connectorId,
        status: schema.toolCall.status,
        errorMessage: schema.toolCall.errorMessage,
        createdAt: schema.toolCall.createdAt,
      })
      .from(schema.toolCall)
      .where(and(eq(schema.toolCall.tenantId, ctx.tenantId), gte(schema.toolCall.createdAt, since24h)))
      .orderBy(desc(schema.toolCall.createdAt));

    const last30dCalls = await db
      .select({ toolId: schema.toolCall.toolId, status: schema.toolCall.status })
      .from(schema.toolCall)
      .where(and(eq(schema.toolCall.tenantId, ctx.tenantId), gte(schema.toolCall.createdAt, since30d)));

    const uptimeByTool = new Map<string, { total: number; failed: number }>();
    for (const row of last30dCalls) {
      const bucket = uptimeByTool.get(row.toolId) ?? { total: 0, failed: 0 };
      bucket.total += 1;
      if (row.status === "Failed") bucket.failed += 1;
      uptimeByTool.set(row.toolId, bucket);
    }

    interface Accumulator {
      toolId: string;
      toolName: string;
      connectorId: string | null;
      total: number;
      failed: number;
      lastErrorMessage: string | null;
      lastErrorAt: Date | null;
      buckets: Map<string, { calls: number; failures: number }>;
    }
    const byTool = new Map<string, Accumulator>();

    for (const row of recentCalls) {
      const acc =
        byTool.get(row.toolId) ??
        ({
          toolId: row.toolId,
          toolName: row.toolName,
          connectorId: row.connectorId,
          total: 0,
          failed: 0,
          lastErrorMessage: null,
          lastErrorAt: null,
          buckets: new Map(),
        } as Accumulator);

      acc.total += 1;
      if (row.status === "Failed") {
        acc.failed += 1;
        if (!acc.lastErrorAt || row.createdAt > acc.lastErrorAt) {
          acc.lastErrorMessage = row.errorMessage;
          acc.lastErrorAt = row.createdAt;
        }
      }
      const bucketKey = hourBucket(row.createdAt);
      const bucket = acc.buckets.get(bucketKey) ?? { calls: 0, failures: 0 };
      bucket.calls += 1;
      if (row.status === "Failed") bucket.failures += 1;
      acc.buckets.set(bucketKey, bucket);

      byTool.set(row.toolId, acc);
    }

    const summaries: ToolHealthSummary[] = Array.from(byTool.values()).map((acc) => {
      const uptime = uptimeByTool.get(acc.toolId);
      const sparkline = Array.from(acc.buckets.entries())
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([hour, v]) => ({ hour, calls: v.calls, failures: v.failures }));

      return {
        toolId: acc.toolId,
        toolName: acc.toolName,
        connectorId: acc.connectorId,
        callVolume: acc.total,
        errorRatePct: acc.total === 0 ? 0 : Math.round((acc.failed / acc.total) * 10000) / 100,
        lastErrorMessage: acc.lastErrorMessage,
        sparkline,
        uptime30dPct: !uptime || uptime.total === 0 ? 100 : Math.round(((uptime.total - uptime.failed) / uptime.total) * 10000) / 100,
      };
    });

    return summaries.sort((a, b) => b.errorRatePct - a.errorRatePct);
  });
}
