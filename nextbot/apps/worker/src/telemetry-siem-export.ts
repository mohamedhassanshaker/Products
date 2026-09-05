import { exportSiemBatchAcrossAllTenants } from "@nextbot/telemetry-export";

/** Target Architecture Blueprint Phase 18 (BL-49, FR-ADM-10) — the audit-log SIEM
 * streaming sweep. 60s cadence, matching `escalation.sla-sweep`'s own cadence for
 * this class of "keep an external system close to real-time" work. */
export async function runTelemetrySiemExport(): Promise<{ tenantsChecked: number; exported: number }> {
  return exportSiemBatchAcrossAllTenants();
}
