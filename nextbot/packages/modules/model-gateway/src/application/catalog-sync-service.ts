import type { TenantContext } from "@nextbot/db";
import { ModelProviderNotFoundError } from "@nextbot/contracts";
import { adapterFor, type AdapterContext, type SyncedCatalogModel } from "../domain/adapter-registry.js";
import { getCredentialForDecrypt } from "../infrastructure/credential-repository.js";
import {
  createCatalogEntry,
  getProvider,
  listCatalogEntries,
  listOwnProvidersForTenant,
  setProviderStatus,
  updateCatalogEntry,
  type ModelCatalogEntryRow,
  type ModelProviderRow,
} from "../infrastructure/model-gateway-repository.js";
import { KmsEnvelopeSecretsProvider } from "@nextbot/secrets";

let secretsProvider: KmsEnvelopeSecretsProvider | undefined;
function getSecretsProvider(): KmsEnvelopeSecretsProvider {
  if (!secretsProvider) secretsProvider = new KmsEnvelopeSecretsProvider();
  return secretsProvider;
}

async function buildAdapterContext(ctx: TenantContext, provider: ModelProviderRow, fetchImpl: typeof fetch): Promise<AdapterContext> {
  let apiKey: string | null = null;
  if (provider.credentialId) {
    const encrypted = await getCredentialForDecrypt(ctx, provider.credentialId);
    if (encrypted) {
      apiKey = await getSecretsProvider().get(encrypted.ciphertext, encrypted.dekRef, {
        tenantId: ctx.tenantId,
        kind: "model-provider-key",
        id: provider.credentialId,
      });
    }
  }
  return { provider: { id: provider.id, type: provider.type, baseUrl: provider.baseUrl, apiKey }, fetchImpl };
}

export interface CatalogSyncOutcome {
  created: number;
  updated: number;
  retired: number;
  models: SyncedCatalogModel[];
}

/**
 * `POST …/providers/{id}/sync-catalog` (on-demand) and the `model-gateway.catalog-sync`
 * scheduled job (every 6h, ADR-0011 §2.1). **Additive and non-destructive** (ADR-0011
 * §4): a model missing from the live listing is set `status='Retired'`, never
 * deleted — a route (Phase 2) referencing it keeps resolving and surfaces a
 * deprecation badge instead of a broken FK. Throws `ModelProviderTypeUnsupportedError`
 * / `ModelCatalogSyncUnsupportedError` (via `adapterFor`/the adapter itself) for a
 * provider type with no discovery API — callers should check
 * `adapterFor(provider.type).supportsCatalogSync` before offering a "Sync" action in
 * the UI, matching the manual-declaration-only console path.
 */
export async function syncProviderCatalog(ctx: TenantContext, providerId: string, fetchImpl: typeof fetch = fetch): Promise<CatalogSyncOutcome> {
  const provider = await getProvider(ctx, providerId);
  if (!provider) throw new ModelProviderNotFoundError(providerId);

  const adapterCtx = await buildAdapterContext(ctx, provider, fetchImpl);
  const { models } = await adapterFor(provider.type).syncCatalog(adapterCtx);

  const existing = await listCatalogEntries(ctx, { providerId });
  const existingByModelId = new Map(existing.map((e) => [e.modelId, e] as const));
  const liveModelIds = new Set(models.map((m) => m.modelId));

  let created = 0;
  let updated = 0;
  for (const model of models) {
    const current = existingByModelId.get(model.modelId);
    if (!current) {
      await createCatalogEntry(ctx, {
        providerId,
        modelId: model.modelId,
        displayName: model.displayName,
        modality: model.modality,
        contextWindow: model.contextWindow,
        maxOutput: model.maxOutput,
        dimension: model.dimension,
        capabilitiesJson: model.capabilities,
        tokenizer: model.tokenizer,
        source: "Synced",
        syncedAt: new Date(),
      });
      created += 1;
    } else {
      // A manually-corrected entry's capability/price/context edits are never
      // silently clobbered by a re-sync — only re-activate it if it had drifted to
      // Retired (the model reappeared) and refresh `syncedAt`.
      await updateCatalogEntry(ctx, current.id, {
        status: current.status === "Retired" ? "Available" : current.status,
        syncedAt: new Date(),
      });
      updated += 1;
    }
  }

  let retired = 0;
  for (const entry of existing) {
    if (entry.source === "Synced" && entry.status !== "Retired" && !liveModelIds.has(entry.modelId)) {
      await updateCatalogEntry(ctx, entry.id, { status: "Retired" });
      retired += 1;
    }
  }

  await setProviderStatus(ctx, providerId, { catalogSyncedAt: new Date() });

  return { created, updated, retired, models };
}

/** Every tenant-owned provider whose adapter supports catalog sync (platform-shared
 * providers excluded — see `listOwnProvidersForTenant`'s doc comment). */
export async function listProvidersDueForCatalogSync(ctx: TenantContext): Promise<ModelProviderRow[]> {
  const providers = await listOwnProvidersForTenant(ctx);
  return providers.filter((p) => p.enabled && adapterFor(p.type).supportsCatalogSync);
}

export type { ModelCatalogEntryRow };
