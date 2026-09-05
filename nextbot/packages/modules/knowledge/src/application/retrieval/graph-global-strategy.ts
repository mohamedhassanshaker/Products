import { Type } from "@sinclair/typebox";
import { callModelGatewayEmbedding, callModelGatewayStructuredPinned } from "@nextbot/model-gateway";
import { clampTopK } from "../../domain/retrieval-bounds.js";
import { topKByCosineSimilarity } from "../../infrastructure/embedding-table.js";
import { listCommunitiesByIds } from "../../infrastructure/graph-repository.js";
import { estimateCompletionCallCostUsd, estimateEmbeddingCallCostUsd, sumCostsUsd, type RetrievalEvidenceItem, type RetrievalStrategyParams, type RetrievalStrategyResult } from "./retrieval-types.js";

const ReduceAnswerSchema = Type.Object({ answer: Type.String({ minLength: 1 }) });

/**
 * Target Architecture Blueprint Phase 9 (BL-40, FR-KB-05, §7.4) — the GraphGlobal
 * strategy: "map over community summaries, reduce to an answer... best for broad,
 * thematic or 'what does our policy cover' questions... [relative cost] Highest."
 *
 * MAP: embeds the query with the collection's pinned embedding route, then ranks
 * `graph_community` summary embeddings (`kind='CommunitySummary'`, written by Phase
 * 7b's Embed stage) by cosine similarity — the same "the embedding IS the index"
 * mechanism the Vector strategy uses, just against a different embedding bucket.
 * REDUCE: a real completion call (the collection's `extractionRouteVersionId`, the
 * same cheap route Phase 7b's own community-summary generation already uses)
 * synthesizes a short answer from the top-matched summaries. Two real model calls
 * (one embedding + one completion) is exactly why this is genuinely the highest-cost
 * strategy of the four, matching §7.4's own relative-cost column.
 */
export async function runGraphGlobalRetrieval(params: RetrievalStrategyParams): Promise<RetrievalStrategyResult> {
  const { ctx, collection, generation, query, aclTags } = params;
  // Community counts are typically far smaller than chunk counts, so this phase caps
  // the "map" step's fan-in at a small constant rather than the full topK ceiling —
  // reduce-step prompt size stays bounded regardless of what topK the caller asked for.
  const topK = Math.min(clampTopK(params.topK), 8);
  const started = Date.now();

  const { embedding, catalogEntryId } = await callModelGatewayEmbedding(ctx, {
    routeVersionId: collection.embeddingRouteVersionId,
    routeKeyForLog: "knowledge.playground.graph-global.map",
    input: query,
  });

  // Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — the "map" step's
  // community-summary ranking is now ACL-filtered before ranking too (previously
  // entirely unfiltered — a community summary derived even partly from Restricted
  // content could surface to any caller).
  const hits = await topKByCosineSimilarity(ctx, generation.dimension, generation.id, "CommunitySummary", embedding, topK, aclTags);
  if (hits.length === 0) {
    const costUsd = await estimateEmbeddingCallCostUsd(ctx, catalogEntryId, query);
    return {
      strategy: "GraphGlobal",
      items: [],
      metrics: { groundednessScore: null, latencyMs: Date.now() - started, costUsd },
      note: "No community summaries have been generated for this generation yet — graph-global retrieval has nothing to map over.",
    };
  }

  const communities = await listCommunitiesByIds(ctx, hits.map((h) => h.ownerId));
  const communityById = new Map(communities.map((c) => [c.id, c]));
  const items: RetrievalEvidenceItem[] = hits
    .map((hit) => {
      const community = communityById.get(hit.ownerId);
      if (!community) return null;
      const item: RetrievalEvidenceItem = { kind: "CommunitySummary", score: hit.score, communityId: community.id, communityTitle: community.title, summary: community.summary ?? "" };
      return item;
    })
    .filter((i): i is RetrievalEvidenceItem => i !== null);

  const summaryPrompt = items.map((i, idx) => `Community ${idx + 1}${i.communityTitle ? ` — ${i.communityTitle}` : ""}: ${i.summary}`).join("\n\n");
  let synthesizedAnswer: string | undefined;
  let completionCostUsd = "0.00000000";
  try {
    const result = await callModelGatewayStructuredPinned(ctx, {
      routeVersionId: collection.extractionRouteVersionId,
      routeKeyForLog: "knowledge.playground.graph-global.reduce",
      schema: ReduceAnswerSchema,
      system:
        "You answer a question using ONLY the community summaries provided. Synthesize one short paragraph grounded in those summaries. If the summaries don't cover the question, say so plainly rather than guessing.",
      messages: [{ role: "user", content: `Question: ${query}\n\nCommunity summaries:\n${summaryPrompt}` }],
      knowledgeGenerationId: generation.id,
    });
    synthesizedAnswer = result.answer;
    completionCostUsd = await estimateCompletionCallCostUsd(ctx, collection.extractionRouteVersionId, summaryPrompt, synthesizedAnswer);
  } catch {
    // The "map" step's ranked community summaries are still real, useful evidence
    // even if the "reduce" completion call fails (route misconfigured, provider
    // error, etc.) — never let a reduce failure hide the map step's own result.
  }

  const embeddingCostUsd = await estimateEmbeddingCallCostUsd(ctx, catalogEntryId, query);
  return {
    strategy: "GraphGlobal",
    items,
    metrics: { groundednessScore: items[0]?.score ?? null, latencyMs: Date.now() - started, costUsd: sumCostsUsd(embeddingCostUsd, completionCostUsd) },
    synthesizedAnswer,
  };
}
