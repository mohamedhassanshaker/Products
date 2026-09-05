import { runCatalogSyncSweep } from "@nextbot/model-gateway";

/** Target Architecture Blueprint Phase 1 (BL-32, ADR-0011 §2.1, LLD §14.8.3) —
 * `model-gateway.catalog-sync`'s scheduled sweep: re-syncs every tenant-owned
 * provider whose adapter supports catalog discovery (`GET /v1/models`, `GET
 * /api/tags`, etc.), every 6h. Additive/non-destructive (ADR-0011 §4) — a model
 * missing from a live listing is retired, never deleted. */
export async function runModelGatewayCatalogSync(): Promise<{ tenantsChecked: number; synced: number; failed: number }> {
  return runCatalogSyncSweep();
}
