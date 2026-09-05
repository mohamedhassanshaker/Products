import type { TenantContext } from "@nextbot/db";
import { KnowledgeGenerationNotReadyError, RetrievalQueryRequiredError } from "@nextbot/contracts";
import { getCollectionOrThrow } from "../../infrastructure/collection-repository.js";
import { getGenerationOrThrow } from "../../infrastructure/generation-repository.js";
import { listAllAclTagsForGeneration } from "../../infrastructure/graph-repository.js";
import { runVectorRetrieval } from "./vector-strategy.js";
import { runGraphLocalRetrieval } from "./graph-local-strategy.js";
import { runGraphGlobalRetrieval } from "./graph-global-strategy.js";
import { runHybridRetrieval } from "./hybrid-strategy.js";
import { ALL_RETRIEVAL_STRATEGIES, type RetrievalStrategyName, type RetrievalStrategyResult } from "./retrieval-types.js";

/**
 * Target Architecture Blueprint Phase 9 (BL-40, FR-KB-05, LLD §14.4.5) — the
 * Retrieval Playground orchestrator: `POST /api/v1/admin/knowledge/playground`.
 * "Runs ALL FOUR strategies" is LLD's own literal wording for this endpoint; this
 * phase's own brief additionally asks for a human to be able to run a SUBSET (one
 * strategy at a time) for a faster, cheaper single-strategy check — `strategies`
 * defaults to all four when omitted, satisfying both.
 *
 * Deliberately NOT the bounded retrieval AGENT (no query classifier, no
 * sufficiency-check/expansion loop, no `refuseWhenUngrounded` enforcement, no
 * `retrieval_event` write) — see this phase's own plan doc for the disclosed scope
 * boundary against Phase 10. Each strategy's own failure is caught and surfaced as a
 * `note` rather than failing the whole comparison — a human comparing four
 * strategies should still see the three that worked when one didn't (e.g.
 * GraphLocal finding no anchor entity for a thematic question).
 */
export interface RetrievalPlaygroundRequest {
  query: string;
  strategies?: RetrievalStrategyName[];
  topK?: number;
  maxHops?: number;
  maxNodes?: number;
}

export interface RetrievalPlaygroundResult {
  query: string;
  collectionId: string;
  generationId: string;
  results: RetrievalStrategyResult[];
}

const STRATEGY_RUNNERS: Record<RetrievalStrategyName, typeof runVectorRetrieval> = {
  Vector: runVectorRetrieval,
  GraphLocal: runGraphLocalRetrieval,
  GraphGlobal: runGraphGlobalRetrieval,
  Hybrid: runHybridRetrieval,
};

export async function runRetrievalPlayground(ctx: TenantContext, collectionId: string, request: RetrievalPlaygroundRequest): Promise<RetrievalPlaygroundResult> {
  const query = request.query?.trim();
  if (!query) throw new RetrievalQueryRequiredError();

  const collection = await getCollectionOrThrow(ctx, collectionId);
  // Step 1 of LLD §14.4.4's loop, minus the loop: "resolve generation :=
  // collection.current_generation_id (never a superseded one)." A collection with no
  // Ready generation yet has nothing to retrieve against.
  if (!collection.currentGenerationId) throw new KnowledgeGenerationNotReadyError(collectionId);
  const generation = await getGenerationOrThrow(ctx, collection.currentGenerationId);
  if (generation.status !== "Ready") throw new KnowledgeGenerationNotReadyError(generation.id);

  const requestedStrategies = request.strategies && request.strategies.length > 0 ? request.strategies : ALL_RETRIEVAL_STRATEGIES;
  const uniqueStrategies = [...new Set(requestedStrategies)];

  // Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — unchanged precedent,
  // now made an EXPLICIT argument instead of something each strategy reached for
  // internally: the Playground is an admin-only tool gated on `knowledge:Read`, not
  // the bounded retrieval agent's real per-caller retrieval path, so it continues to
  // pass the whole generation's own ACL-tag union (never used for a customer-facing/
  // end-user retrieval path — see `listAllAclTagsForGeneration`'s own doc comment).
  const aclTags = await listAllAclTagsForGeneration(ctx, generation.id);

  const results = await Promise.all(
    uniqueStrategies.map(async (strategy): Promise<RetrievalStrategyResult> => {
      const runner = STRATEGY_RUNNERS[strategy];
      const startedAt = Date.now();
      try {
        return await runner({ ctx, collection, generation, query, topK: request.topK, maxHops: request.maxHops, maxNodes: request.maxNodes, aclTags });
      } catch (err) {
        // A single strategy's failure (e.g. a provider outage on its pinned route)
        // never hides the others — surfaced as a zero-evidence result with a note,
        // never thrown past this point.
        return {
          strategy,
          items: [],
          metrics: { groundednessScore: null, latencyMs: Date.now() - startedAt, costUsd: "0.00000000" },
          note: `This strategy failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }),
  );

  return { query, collectionId, generationId: generation.id, results };
}
