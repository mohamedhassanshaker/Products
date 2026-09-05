import type { TenantContext } from "@nextbot/db";
import type {
  CreateModelCatalogEntryRequest,
  CreateModelProviderRequest,
  UpdateModelCatalogEntryRequest,
  UpdateModelProviderRequest,
} from "@nextbot/contracts";
import * as providers from "../application/provider-service.js";
import * as catalog from "../application/catalog-service.js";
import { probeProvider } from "../application/provider-probe-service.js";
import { syncProviderCatalog } from "../application/catalog-sync-service.js";
import { adapterFor } from "../domain/adapter-registry.js";

/** `http/` layer (LLD §2.2) — plain functions; RBAC checks (`agent_platform` module,
 * matching the existing v1 Model Gateway console screen's convention) are applied by
 * the composition root (`apps/web`), same pattern as every other module. */

export async function handleCreateProvider(ctx: TenantContext, input: CreateModelProviderRequest) {
  return providers.createProviderRegistration(ctx, input);
}

export async function handleListProviders(ctx: TenantContext) {
  return providers.listProviderRegistrations(ctx);
}

export async function handleUpdateProvider(ctx: TenantContext, id: string, input: UpdateModelProviderRequest) {
  return providers.updateProviderRegistration(ctx, id, input);
}

export async function handleDeactivateProvider(ctx: TenantContext, id: string) {
  return providers.deactivateProviderRegistration(ctx, id);
}

export async function handleProbeProvider(ctx: TenantContext, id: string) {
  return probeProvider(ctx, id);
}

export async function handleSyncProviderCatalog(ctx: TenantContext, id: string) {
  return syncProviderCatalog(ctx, id);
}

export async function handleListCatalog(
  ctx: TenantContext,
  filters: { providerId?: string; modality?: string; status?: string } = {},
) {
  return catalog.listCatalog(ctx, filters as Parameters<typeof catalog.listCatalog>[1]);
}

export async function handleDeclareCatalogEntry(ctx: TenantContext, input: CreateModelCatalogEntryRequest) {
  return catalog.declareCatalogEntry(ctx, input);
}

export async function handleUpdateCatalogEntry(ctx: TenantContext, id: string, input: UpdateModelCatalogEntryRequest) {
  return catalog.updateCatalogEntryDeclaration(ctx, id, input);
}

export async function handleDeleteCatalogEntry(ctx: TenantContext, id: string) {
  return catalog.removeCatalogEntry(ctx, id);
}

/** Whether a provider type supports catalog sync at all — the console uses this to
 * decide "Sync" button vs. manual-entry-only affordance (ADR-0011 §2.1). */
export function handleProviderSupportsCatalogSync(providerType: Parameters<typeof adapterFor>[0]) {
  return adapterFor(providerType).supportsCatalogSync;
}
