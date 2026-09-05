import { exportOtelMetricsAcrossAllTenants } from "@nextbot/telemetry-export";

/** Target Architecture Blueprint Phase 18 (BL-49, FR-ADM-10) — the periodic tenant
 * OTel metric-snapshot push. 5-minute cadence, matching the aggregation window
 * `otel-metrics-export-service.ts` itself computes over. */
export async function runTelemetryOtelMetricsExport(): Promise<{ tenantsChecked: number; exported: number }> {
  return exportOtelMetricsAcrossAllTenants();
}
