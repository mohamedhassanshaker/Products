import type { TenantContext } from "@nextbot/db";
import { getCatalogEntry, resolveModelChainForRouteVersion } from "@nextbot/model-gateway";
import { estimateTokenCount } from "../../domain/chunking.js";
import type { KnowledgeCollectionRow } from "../../infrastructure/collection-repository.js";
import type { KnowledgeGenerationRow } from "../../infrastructure/generation-repository.js";

/**
 * Target Architecture Blueprint Phase 9 (BL-40, FR-KB-05, LLD §14.4.4/§7.4) — shared
 * types and cost-estimation helpers for the four retrieval strategies + the
 * playground orchestrator.
 */

export type RetrievalStrategyName = "Vector" | "GraphLocal" | "GraphGlobal" | "Hybrid";

export const ALL_RETRIEVAL_STRATEGIES: readonly RetrievalStrategyName[] = ["Vector", "GraphLocal", "GraphGlobal", "Hybrid"];

/**
 * One piece of retrieved evidence. Deliberately NOT a literal implementation of LLD
 * §14.4.4's `CitationSchema` — this phase's own brief asks each strategy to return
 * "a result set of chunks/entities/relation-paths/community-summaries as appropriate
 * to that strategy," and `CitationSchema` is the bounded retrieval AGENT's (Phase
 * 10's) contract for a final, budget/expansion-governed answer. This shape is a
 * strict subset covering both a chunk-shaped item (Vector/GraphLocal/Hybrid) and a
 * community-shaped item (GraphGlobal) — reusable input for Phase 10's real citation
 * shaping later without this phase needing to build the full executor.
 */
export interface RetrievalEvidenceItem {
  kind: "Chunk" | "CommunitySummary";
  /** Relevance/confidence in `[0, 1]` — cosine similarity for vector-recalled items,
   *  mean edge confidence for graph-local relation paths. */
  score: number;
  chunkId?: string;
  documentId?: string;
  documentTitle?: string | null;
  sourceId?: string;
  sourceName?: string;
  /** Chunk text (already index-time masked per the collection's trust level, same
   *  precedent `graph-explorer-service.ts#getChunkDetail` established — never
   *  re-masked here). */
  snippet?: string;
  communityId?: string;
  communityTitle?: string | null;
  summary?: string;
  /** Present only for graph-derived evidence (GraphLocal always; Hybrid when its
   *  graph-expansion step contributed to this item) — the FR-KB-06 evidence a pure
   *  vector search could never produce. */
  relationPath?: Array<{ srcName: string; relation: string; dstName: string; provenanceChunkId: string }>;
}

export interface RetrievalStrategyMetrics {
  /** `null` ⇒ nothing retrieved, mirroring `retrieval_event.top_score`'s own
   *  "NULL ⇒ nothing retrieved" semantics (LLD §14.4.2) — this phase doesn't ship
   *  that table, but the metric's meaning is intentionally the same one Phase 10
   *  will persist there. */
  groundednessScore: number | null;
  latencyMs: number;
  /** A real, attributable dollar estimate against the exact catalog entry that
   *  served the call(s) this strategy run made — never a placeholder. See
   *  `estimateEmbeddingCallCostUsd`/`estimateCompletionCallCostUsd`'s own doc
   *  comments for the pricing model. `"0.00000000"` for a strategy that made no
   *  model call at all (GraphLocal, when the collection has no rerank route). */
  costUsd: string;
}

export interface RetrievalStrategyResult {
  strategy: RetrievalStrategyName;
  items: RetrievalEvidenceItem[];
  metrics: RetrievalStrategyMetrics;
  /** Set only when this strategy's own run hit a recoverable condition worth
   *  surfacing to the human comparing strategies (e.g. "no anchor entity found in
   *  the query text") — never thrown, so a playground running all four still shows
   *  the other three. */
  note?: string;
  /** GraphGlobal only — the "reduce to an answer" half of §7.4's "map over
   *  community summaries, reduce to an answer." A real LLM synthesis over the
   *  top-matched community summaries, returned for playground comparison only; NOT
   *  wired into any conversation/citation rendering path (Phase 10's bounded
   *  retrieval agent owns producing a governed, citation-backed final answer). */
  synthesizedAnswer?: string;
}

export interface RetrievalStrategyParams {
  ctx: TenantContext;
  collection: KnowledgeCollectionRow;
  generation: KnowledgeGenerationRow;
  query: string;
  /** Caller-requested limits — every strategy clamps these itself via
   *  `domain/retrieval-bounds.ts` before use; never trusted as-is. */
  topK?: number;
  maxHops?: number;
  maxNodes?: number;
  /**
   * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — the REAL, resolved
   * per-caller ACL scope (`ResolvedAgentKnowledgeConfig.aclTags`, or the Retrieval
   * Playground's own admin-tool-wide union — see `playground-service.ts`'s own doc
   * comment for that narrower precedent) every strategy below must filter candidate
   * chunks/entities/communities against BEFORE ranking, never after — a candidate
   * whose own `acl_tags` shares no tag with this array must never be scored, let
   * alone returned. `undefined` is never passed by any real caller in this module;
   * it exists only so a pre-Phase-11 unit test fixture that predates this field
   * doesn't need updating merely to keep compiling (treated as "no ACL tags at all",
   * i.e. matches nothing, the same fail-closed default `topKByCosineSimilarity`
   * itself applies to an explicit empty array).
   */
  aclTags?: string[];
}

function toFixedCost(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0.00000000";
  return value.toFixed(8);
}

/** Sums cost strings (as returned by the estimators below) without floating-point
 *  string-concatenation bugs — parses each back to a number, adds, re-formats. */
export function sumCostsUsd(...costs: string[]): string {
  return toFixedCost(costs.reduce((sum, c) => sum + Number(c), 0));
}

/**
 * Estimates the dollar cost of ONE embedding call, using the REAL catalog entry that
 * served it (`callModelGatewayEmbedding`'s own return value already names it) and
 * this module's pre-existing `chunking.ts#estimateTokenCount` chars/4 heuristic —
 * never a fabricated placeholder. `model_catalog_entry.price_in` is priced per input
 * token (the schema's `numeric(18,8)` precision is sized for per-token, not
 * per-1K/1M, prices). Returns `"0.00000000"` when the catalog entry can't be
 * resolved (e.g. a test fixture with an undeclared entry) rather than throwing — a
 * cost estimate is advisory, not a billing-critical path.
 */
export async function estimateEmbeddingCallCostUsd(ctx: TenantContext, catalogEntryId: string | undefined, inputText: string): Promise<string> {
  if (!catalogEntryId) return "0.00000000";
  const entry = await getCatalogEntry(ctx, catalogEntryId);
  if (!entry) return "0.00000000";
  return toFixedCost(estimateTokenCount(inputText) * Number(entry.priceIn));
}

/**
 * Estimates the dollar cost of one completion (structured-output) call resolved by
 * ROUTE VERSION id (never a route name — this module always calls pinned versions,
 * per FR-KB-03's immutability discipline) — input tokens priced at `price_in`,
 * output tokens at `price_out`.
 */
export async function estimateCompletionCallCostUsd(ctx: TenantContext, routeVersionId: string, inputText: string, outputText: string): Promise<string> {
  const resolved = await resolveModelChainForRouteVersion(ctx, routeVersionId);
  const catalogEntryId = resolved.hopAttribution[0]?.catalogEntryId;
  if (!catalogEntryId) return "0.00000000";
  const entry = await getCatalogEntry(ctx, catalogEntryId);
  if (!entry) return "0.00000000";
  const cost = estimateTokenCount(inputText) * Number(entry.priceIn) + estimateTokenCount(outputText) * Number(entry.priceOut);
  return toFixedCost(cost);
}
