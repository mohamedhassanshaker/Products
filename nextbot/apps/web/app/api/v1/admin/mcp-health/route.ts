import { NextResponse } from "next/server";
import { getConnectorHealthSummary, listConnectors } from "@nextbot/connectors";
import { listBreakerStatuses } from "@nextbot/mcp-client";
import { getToolHealthSummaries } from "@nextbot/approvals";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/mcp-health` (RBAC: connectors=Read, B.3A.4's server status
 * grid + tool-level health table). Joins four sources for one tenant:
 *  - `connector` (server status grid: name, status, environment).
 *  - `connector_health_check` rollups (p50/p95/p99 latency, error rate, call volume,
 *    and now a 30-day uptime figure — QA fix UI-D4).
 *  - `tool_call` history, aggregated per-tool (QA fix UI-D4's tool-level health
 *    table: call volume, error rate, last error message, hourly sparkline, 30d
 *    uptime — see `@nextbot/approvals`'s `getToolHealthSummaries` doc for why
 *    per-tool *latency* percentiles aren't included, a real data gap, not a
 *    rendering one).
 *  - the real, Redis-backed, cross-process circuit breaker (`@nextbot/mcp-client`) —
 *    the exact mechanism FR-MCP-08's egress guarantee is enforced by, not a
 *    separate display-only copy.
 */
export async function GET() {
  const guard = await requireApi("connectors", "Read");
  if (guard instanceof Response) return guard;

  try {
    const connectors = await listConnectors(guard.ctx);
    const breakerStatuses = await listBreakerStatuses(guard.ctx.tenantId);
    const rows = await Promise.all(
      connectors.map(async (connector) => ({
        connector,
        health: await getConnectorHealthSummary(guard.ctx, connector.id),
        // 30-day window reuses the same rollup at a longer window purely for the
        // uptime % figure (QA fix UI-D4's server-grid "30d uptime" column).
        uptime30dPct: await getConnectorHealthSummary(guard.ctx, connector.id, 24 * 30).then((s) => Math.round((100 - s.errorRatePct) * 100) / 100),
      })),
    );
    const toolHealth = await getToolHealthSummaries(guard.ctx);
    return NextResponse.json({ connectors: rows, breakerStatuses, toolHealth });
  } catch (err) {
    return problemResponse(err);
  }
}
