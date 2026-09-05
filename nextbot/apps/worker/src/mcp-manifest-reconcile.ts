import { reconcileDueServersAcrossAllTenants } from "@nextbot/mcp-registry";

/**
 * Phase 6 (BL-29, ADR-0014, LLD §14.3.6) — the manifest-pinning drift reconciler's
 * scheduled sweep. Runs every 60s (a sweep tick); each server's own `reconcile_
 * interval_seconds` (default 3600, bounded 300..86400 by NFR-14) governs whether it's
 * actually due this tick — this function itself doesn't decide that, `@nextbot/
 * mcp-registry`'s own `listServersDueForReconciliation` does, mirroring `mcp.health-
 * check`'s own "sweep tick vs. per-connector cadence" split.
 */
export async function runMcpManifestReconcile(): Promise<{ tenantsChecked: number; results: unknown[] }> {
  return reconcileDueServersAcrossAllTenants();
}
