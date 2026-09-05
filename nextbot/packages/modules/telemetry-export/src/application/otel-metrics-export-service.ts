import type { TenantContext } from "@nextbot/db";
import { listActiveTenantContexts } from "@nextbot/tenancy";
import { exportTenantMetricsSnapshot } from "@nextbot/observability";
import { getOtelExportConfig } from "../infrastructure/otel-export-config-repository.js";
import { getAgentRunMetricsSnapshot } from "../infrastructure/agent-run-metrics-reader.js";

/** The worker job's own cadence (5 minutes) IS the aggregation window — see this
 * module's own README/plan doc for why an interval-aggregated push is the correct
 * shape for "metric export" (OTel metrics are aggregates by nature, unlike traces). */
const AGGREGATION_WINDOW_MINUTES = 5;

/**
 * FR-ADM-10's periodic metric snapshot, for one tenant: a real aggregate over the
 * last `AGGREGATION_WINDOW_MINUTES` of `agent_run` activity, pushed via a real
 * `OTLPMetricExporter` (`@nextbot/observability#exportTenantMetricsSnapshot`) to the
 * tenant's configured endpoint. No-ops for a tenant with export disabled/
 * unconfigured, or with zero activity in the window (an all-zero snapshot is not
 * useful signal and would just be noise in the tenant's own dashboard).
 */
export async function exportOtelMetricsForTenant(ctx: TenantContext): Promise<{ exported: boolean }> {
  const config = await getOtelExportConfig(ctx);
  if (!config || !config.enabled) return { exported: false };

  const snapshot = await getAgentRunMetricsSnapshot(ctx, AGGREGATION_WINDOW_MINUTES);
  if (snapshot.succeededCount === 0 && snapshot.failedCount === 0) return { exported: false };

  const metrics = [
    { name: "nextbot.agent_run.succeeded_count", value: snapshot.succeededCount },
    { name: "nextbot.agent_run.failed_count", value: snapshot.failedCount },
    ...(snapshot.avgDurationMs != null ? [{ name: "nextbot.agent_run.avg_duration_ms", value: snapshot.avgDurationMs, unit: "ms" }] : []),
    ...(snapshot.totalCostUsd != null ? [{ name: "nextbot.agent_run.total_cost_usd", value: snapshot.totalCostUsd, unit: "usd" }] : []),
  ];
  try {
    await exportTenantMetricsSnapshot(config.otlpEndpointUrl, metrics);
    return { exported: true };
  } catch (err) {
    // Fail safe — one tenant's unreachable OTel collector must never stop the
    // cross-tenant sweep for every other tenant.
    console.error(`NextBot: OTel metrics export for tenant ${ctx.tenantId} failed (non-fatal)`, err);
    return { exported: false };
  }
}

export async function exportOtelMetricsAcrossAllTenants(): Promise<{ tenantsChecked: number; exported: number }> {
  const tenants = await listActiveTenantContexts();
  let exported = 0;
  for (const ctx of tenants) {
    const result = await exportOtelMetricsForTenant(ctx);
    if (result.exported) exported++;
  }
  return { tenantsChecked: tenants.length, exported };
}
