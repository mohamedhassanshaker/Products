import type { TenantContext } from "@nextbot/db";
import type { ChunkingConfig, KnowledgeTrustLevel } from "@nextbot/db";
import { getTenantDataPolicy } from "@nextbot/tenancy";
import { resolveOrSynthesizeRouteVersionForKey, getRouteOrThrow, getRouteVersion } from "@nextbot/model-gateway";
import { KnowledgeRegionMismatchError } from "@nextbot/contracts";
import {
  createCollection as createCollectionRow,
  listCollections,
  getCollectionOrThrow,
  updateCollectionFields,
  updateCollectionConfig,
  softDeleteCollection,
  type KnowledgeCollectionRow,
  type UpdateCollectionFields,
} from "../infrastructure/collection-repository.js";

/**
 * FR-KB-08 — a collection configuration that would send chunks out of region is
 * rejected at SAVE TIME, never silently accepted (mirrors Phase 2's
 * `validateRouteCapabilities` residency check — the same "reject at save time"
 * convention, applied here to a collection's own `region` field rather than a
 * route hop's provider region).
 */
async function assertRegionAllowed(ctx: TenantContext, region: "UAE" | "EU" | "US"): Promise<void> {
  const policy = await getTenantDataPolicy(ctx);
  const tenantRegion = policy?.residencyRegion ?? ctx.region;
  if (region !== tenantRegion && !(policy?.allowOutOfRegionInference ?? false)) {
    throw new KnowledgeRegionMismatchError(region, tenantRegion);
  }
}

/**
 * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — FR-KB-08 requires "the
 * index, graph store, AND embedding provider" to all satisfy the tenant's configured
 * region, not merely the collection's own `region` field (`assertRegionAllowed` above
 * already covered that half since Phase 7b). This closes the remaining gap: a
 * collection's PINNED embedding route resolves to a real provider, and that
 * provider's own region set must include the collection's declared region unless
 * out-of-region inference is explicitly allowed — otherwise the save is rejected with
 * the SAME named `KNOWLEDGE_REGION_MISMATCH` error, never silently accepted.
 *
 * Reuses Model Gateway v2's own already-computed `model_route_version.max_region_set`
 * (ADR-0011, Phase 2's `validateRouteCapabilities`) rather than inventing a second
 * region concept for this module — `maxRegionSet` empty means "unconstrained" (the
 * same convention `gateway-call-service.ts`'s own runtime region check already
 * applies to a provider's `regionsServed`), so an empty set never blocks a save.
 */
async function assertEmbeddingProviderRegionAllowed(ctx: TenantContext, region: "UAE" | "EU" | "US", embeddingRouteVersionId: string): Promise<void> {
  const policy = await getTenantDataPolicy(ctx);
  if (policy?.allowOutOfRegionInference) return; // tenant has explicitly opted in — never blocks.
  const version = await getRouteVersion(ctx, embeddingRouteVersionId);
  if (!version || version.maxRegionSet.length === 0) return; // unresolvable or genuinely unconstrained — nothing to reject against.
  if (!version.maxRegionSet.includes(region)) {
    throw new KnowledgeRegionMismatchError(region, version.maxRegionSet.join("/"));
  }
}

export interface CreateCollectionRequest {
  name: string;
  description?: string;
  region: "UAE" | "EU" | "US";
  retentionDays?: number | null;
  trustLevel?: KnowledgeTrustLevel;
  chunkingConfig?: ChunkingConfig;
  /** Route NAMES (e.g. `"extract.cheap"`/`"embed.default"`), resolved to a real,
   *  immutable `model_route_version` id at creation time via
   *  `resolveOrSynthesizeRouteVersionForKey` — the collection stores the resolved
   *  version id, never the name (FR-KB-03/FR-AGT-21's "the pin, not a string"). */
  extractionRouteKey: string;
  embeddingRouteKey: string;
  rerankRouteKey?: string;
  defaultStrategy?: "Vector" | "GraphLocal" | "GraphGlobal" | "Hybrid" | null;
  maxStalenessHours?: number | null;
  minRelevanceScore?: number;
}

/** Creates a collection — `knowledge:Write` for the base fields, but resolving the
 *  route keys into real pins is itself a `knowledge_config`-gated decision at the
 *  HTTP composition-root layer (the caller must already hold both permissions;
 *  this module has no RBAC awareness of its own, per this codebase's convention). */
export async function createCollection(ctx: TenantContext, req: CreateCollectionRequest): Promise<KnowledgeCollectionRow> {
  await assertRegionAllowed(ctx, req.region);

  const extractionVersion = await resolveOrSynthesizeRouteVersionForKey(ctx, req.extractionRouteKey);
  const embeddingVersion = await resolveOrSynthesizeRouteVersionForKey(ctx, req.embeddingRouteKey);
  const rerankVersion = req.rerankRouteKey ? await resolveOrSynthesizeRouteVersionForKey(ctx, req.rerankRouteKey) : null;
  // FR-KB-08 — the embedding PROVIDER must also satisfy the tenant's residency
  // setting, not merely the collection's own declared `region` field.
  await assertEmbeddingProviderRegionAllowed(ctx, req.region, embeddingVersion.id);

  return createCollectionRow(ctx, {
    name: req.name,
    description: req.description,
    region: req.region,
    retentionDays: req.retentionDays,
    trustLevel: req.trustLevel,
    chunkingConfig: req.chunkingConfig,
    extractionRouteVersionId: extractionVersion.id,
    embeddingRouteVersionId: embeddingVersion.id,
    rerankRouteVersionId: rerankVersion?.id,
    defaultStrategy: req.defaultStrategy,
    maxStalenessHours: req.maxStalenessHours,
    minRelevanceScore: req.minRelevanceScore,
  });
}

export { listCollections, getCollectionOrThrow, softDeleteCollection };

export async function updateCollection(ctx: TenantContext, id: string, fields: UpdateCollectionFields): Promise<KnowledgeCollectionRow> {
  return updateCollectionFields(ctx, id, fields);
}

export interface UpdateCollectionConfigRequest {
  extractionRouteKey?: string;
  embeddingRouteKey?: string;
  rerankRouteKey?: string | null;
  chunkingConfig?: ChunkingConfig;
}

/** `knowledge_config`-gated — resolves any new route KEY into a fresh, real pin
 *  before writing it. Changing `embeddingRouteVersionId` here does NOT touch any
 *  existing generation (FR-KB-03) — it only changes what the NEXT
 *  `POST .../generations` call will pin a new generation to. */
export async function updateCollectionConfiguration(ctx: TenantContext, id: string, req: UpdateCollectionConfigRequest): Promise<KnowledgeCollectionRow> {
  const fields: Parameters<typeof updateCollectionConfig>[2] = { chunkingConfig: req.chunkingConfig };
  if (req.extractionRouteKey) {
    const version = await resolveOrSynthesizeRouteVersionForKey(ctx, req.extractionRouteKey);
    fields.extractionRouteVersionId = version.id;
  }
  if (req.embeddingRouteKey) {
    const version = await resolveOrSynthesizeRouteVersionForKey(ctx, req.embeddingRouteKey);
    // FR-KB-08 — re-pinning the embedding route must re-validate residency too; a
    // config update that would silently swap in an out-of-region provider is exactly
    // as much a "reject at save time" case as the original creation.
    const collection = await getCollectionOrThrow(ctx, id);
    await assertEmbeddingProviderRegionAllowed(ctx, collection.region, version.id);
    fields.embeddingRouteVersionId = version.id;
  }
  if (req.rerankRouteKey !== undefined) {
    fields.rerankRouteVersionId = req.rerankRouteKey ? (await resolveOrSynthesizeRouteVersionForKey(ctx, req.rerankRouteKey)).id : null;
  }
  return updateCollectionConfig(ctx, id, fields);
}

// Re-exported so callers that only need to confirm a route name resolves to a real,
// existing route (e.g. a console dropdown) don't need to import @nextbot/model-gateway directly.
export { getRouteOrThrow };
