import type { TenantContext } from "@nextbot/db";
import type { CreateModelCatalogEntryRequest, UpdateModelCatalogEntryRequest } from "@nextbot/contracts";
import { ModelCatalogEntryNotFoundError } from "@nextbot/contracts";
import {
  createCatalogEntry,
  deleteCatalogEntry,
  getCatalogEntry,
  listCatalogEntries,
  updateCatalogEntry,
  type ModelCatalogEntryRow,
} from "../infrastructure/model-gateway-repository.js";

/** Manual declaration (FR-AGT-21) — the path for provider types with no discovery API
 * (`custom`, and self-hosted deployments an operator wants to describe precisely
 * rather than trust a generic listing endpoint's defaults for). */
export async function declareCatalogEntry(ctx: TenantContext, input: CreateModelCatalogEntryRequest): Promise<ModelCatalogEntryRow> {
  return createCatalogEntry(ctx, {
    providerId: input.providerId,
    modelId: input.modelId,
    displayName: input.displayName,
    modality: input.modality,
    contextWindow: input.contextWindow,
    maxOutput: input.maxOutput,
    dimension: input.dimension,
    capabilitiesJson: input.capabilities,
    tokenizer: input.tokenizer,
    priceIn: input.priceIn !== undefined ? String(input.priceIn) : undefined,
    priceOut: input.priceOut !== undefined ? String(input.priceOut) : undefined,
    priceCached: input.priceCached !== undefined ? String(input.priceCached) : undefined,
    deprecatesAt: input.deprecatesAt ? new Date(input.deprecatesAt) : undefined,
    source: "Manual",
  });
}

export async function listCatalog(
  ctx: TenantContext,
  filters: { providerId?: string; modality?: ModelCatalogEntryRow["modality"]; status?: ModelCatalogEntryRow["status"] } = {},
): Promise<ModelCatalogEntryRow[]> {
  return listCatalogEntries(ctx, filters);
}

async function requireCatalogEntry(ctx: TenantContext, id: string): Promise<ModelCatalogEntryRow> {
  const row = await getCatalogEntry(ctx, id);
  if (!row) throw new ModelCatalogEntryNotFoundError(id);
  return row;
}

export async function updateCatalogEntryDeclaration(ctx: TenantContext, id: string, input: UpdateModelCatalogEntryRequest): Promise<ModelCatalogEntryRow> {
  await requireCatalogEntry(ctx, id);
  await updateCatalogEntry(ctx, id, {
    displayName: input.displayName,
    contextWindow: input.contextWindow,
    maxOutput: input.maxOutput,
    dimension: input.dimension,
    capabilitiesJson: input.capabilities,
    priceIn: input.priceIn !== undefined ? String(input.priceIn) : undefined,
    priceOut: input.priceOut !== undefined ? String(input.priceOut) : undefined,
    priceCached: input.priceCached !== undefined ? String(input.priceCached) : undefined,
    status: input.status,
    deprecatesAt: input.deprecatesAt ? new Date(input.deprecatesAt) : undefined,
  });
  return requireCatalogEntry(ctx, id);
}

/**
 * A manually-declared entry can be hard-deleted (nothing else this phase pins it —
 * Route v2's pinning, Phase 2, is what makes deletion unsafe going forward). A
 * `source: 'Synced'` entry is never hard-deleted — ADR-0011 §4's "additive and non-
 * destructive" rule — it can only be retired via `updateCatalogEntryDeclaration`
 * (`status: 'Retired'`).
 */
export async function removeCatalogEntry(ctx: TenantContext, id: string): Promise<void> {
  const row = await requireCatalogEntry(ctx, id);
  if (row.source !== "Manual") {
    // Same shape as ADR-0011 §4's rule, enforced here rather than only documented:
    // retire instead of delete.
    await updateCatalogEntry(ctx, id, { status: "Retired" });
    return;
  }
  await deleteCatalogEntry(ctx, id);
}
