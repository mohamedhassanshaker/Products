import { listActiveTenantContexts } from "@nextbot/tenancy";
import { listProvidersDueForProbe, probeProvider } from "./provider-probe-service.js";
import { listProvidersDueForCatalogSync, syncProviderCatalog } from "./catalog-sync-service.js";

/**
 * `model-gateway.provider-probe` (60s tick, per-provider cadence from
 * `health_interval_seconds` — ADR-0011 §2.1/LLD §14.8.3, mirrors `mcp.health-check`'s
 * own "sweep tick vs. per-connector cadence" split). Every active tenant's own
 * providers are probed (platform-shared providers excluded this phase — see
 * `listOwnProvidersForTenant`'s doc comment); one provider's probe failure never stops
 * the sweep (each is caught and recorded individually, same convention as every other
 * scheduled job in this codebase).
 */
export async function runProviderProbeSweep(): Promise<{ tenantsChecked: number; probed: number; failed: number }> {
  const tenants = await listActiveTenantContexts();
  let probed = 0;
  let failed = 0;
  for (const ctx of tenants) {
    const due = await listProvidersDueForProbe(ctx);
    for (const provider of due) {
      try {
        await probeProvider(ctx, provider.id);
        probed += 1;
      } catch (err) {
        failed += 1;
        console.error(`model-gateway.provider-probe: probe failed for provider ${provider.id}`, err);
      }
    }
  }
  return { tenantsChecked: tenants.length, probed, failed };
}

/**
 * `model-gateway.catalog-sync` (6h — ADR-0011 §2.1). Every active tenant's own
 * providers whose adapter supports catalog sync are re-synced; additive/non-
 * destructive per `syncProviderCatalog`'s own doc comment.
 */
export async function runCatalogSyncSweep(): Promise<{ tenantsChecked: number; synced: number; failed: number }> {
  const tenants = await listActiveTenantContexts();
  let synced = 0;
  let failed = 0;
  for (const ctx of tenants) {
    const due = await listProvidersDueForCatalogSync(ctx);
    for (const provider of due) {
      try {
        await syncProviderCatalog(ctx, provider.id);
        synced += 1;
      } catch (err) {
        failed += 1;
        console.error(`model-gateway.catalog-sync: sync failed for provider ${provider.id}`, err);
      }
    }
  }
  return { tenantsChecked: tenants.length, synced, failed };
}
