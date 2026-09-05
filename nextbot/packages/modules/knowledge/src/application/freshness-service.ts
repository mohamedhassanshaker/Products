import type { TenantContext } from "@nextbot/db";
import { getCollectionOrThrow } from "../infrastructure/collection-repository.js";
import { getGenerationOrThrow } from "../infrastructure/generation-repository.js";

/**
 * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — the Freshness
 * sub-requirement's UI half: "collections show a staleness badge." The REFUSAL
 * half ("an agent version may declare a maximum acceptable staleness and must
 * refuse when exceeded") already shipped in Phase 10
 * (`retrieval-executor.ts`'s own staleness check, unchanged by this file) — this is
 * a read-only computed indicator over the SAME two fields that check already reads
 * (`collection.maxStalenessHours`, `generation.builtAt`), not a new backend concept.
 */
export type CollectionFreshnessStatus = "NoGeneration" | "Fresh" | "Stale" | "NoStalenessLimitConfigured";

export interface CollectionFreshness {
  status: CollectionFreshnessStatus;
  /** Hours since the current generation's own `built_at` — `null` only when there
   *  is no Ready generation to measure (`status === 'NoGeneration'`). */
  ageHours: number | null;
  maxStalenessHours: number | null;
  builtAt: string | null;
}

/**
 * Computes the SAME staleness comparison `runBoundedRetrieval`'s own refusal check
 * performs (`ageHours > collection.maxStalenessHours`), purely for display — this
 * function makes no refusal decision and has no side effect. `NoStalenessLimit
 * Configured` is a genuinely distinct state from `Fresh`: a collection with no
 * `max_staleness_hours` at all can never be refused for staleness (per Phase 10's
 * own `!== null` guard), so labelling it "Fresh" would be misleading — there is no
 * limit to have satisfied.
 */
export async function getCollectionFreshness(ctx: TenantContext, collectionId: string): Promise<CollectionFreshness> {
  const collection = await getCollectionOrThrow(ctx, collectionId);
  if (!collection.currentGenerationId) {
    return { status: "NoGeneration", ageHours: null, maxStalenessHours: collection.maxStalenessHours, builtAt: null };
  }
  const generation = await getGenerationOrThrow(ctx, collection.currentGenerationId);
  if (!generation.builtAt) {
    return { status: "NoGeneration", ageHours: null, maxStalenessHours: collection.maxStalenessHours, builtAt: null };
  }

  const ageHours = (Date.now() - generation.builtAt.getTime()) / (1000 * 60 * 60);
  if (collection.maxStalenessHours === null) {
    return { status: "NoStalenessLimitConfigured", ageHours, maxStalenessHours: null, builtAt: generation.builtAt.toISOString() };
  }
  const status: CollectionFreshnessStatus = ageHours > collection.maxStalenessHours ? "Stale" : "Fresh";
  return { status, ageHours, maxStalenessHours: collection.maxStalenessHours, builtAt: generation.builtAt.toISOString() };
}
