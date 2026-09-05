import { createHash } from "node:crypto";
import type { TenantContext, ResolvedAgentKnowledgeConfig } from "@nextbot/db";
import { callModelGatewayStructuredPinned } from "@nextbot/model-gateway";
import { detectAndMask, buildPolicyLookup, listCustomPiiRulesForMasking } from "@nextbot/pii";
import { KnowledgeGenerationNotReadyError, type Citation, type RetrievalOutcomeValue, type RetrievalStrategyValue } from "@nextbot/contracts";
import { RetrievalAnswerSchema } from "../../domain/retrieval-agent-schemas.js";
import { clampMaxExpansions, clampMaxHops, clampTopK } from "../../domain/retrieval-bounds.js";
import { deriveAclTags } from "../../domain/acl.js";
import { resolveChunkTextForCaller } from "../pii-reeval-service.js";
import { getCollectionOrThrow } from "../../infrastructure/collection-repository.js";
import { getGenerationOrThrow } from "../../infrastructure/generation-repository.js";
import { listEdgesForEntity, listEntitiesByIds, listEntitiesForCommunity, type GraphEdgeRow } from "../../infrastructure/graph-repository.js";
import { listChunksByIds } from "../../infrastructure/document-chunk-repository.js";
import { listSourcesByIds } from "../../infrastructure/source-repository.js";
import { insertRetrievalEvent } from "../../infrastructure/retrieval-event-repository.js";
import { runVectorRetrieval } from "./vector-strategy.js";
import { runGraphLocalRetrieval } from "./graph-local-strategy.js";
import { runGraphGlobalRetrieval } from "./graph-global-strategy.js";
import { runHybridRetrieval } from "./hybrid-strategy.js";
import { classifyRetrievalStrategy } from "./query-classifier.js";
import { checkSufficiency } from "./sufficiency-check.js";
import { estimateCompletionCallCostUsd, sumCostsUsd, type RetrievalEvidenceItem, type RetrievalStrategyParams, type RetrievalStrategyResult } from "./retrieval-types.js";

/**
 * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-05/06/07, Blueprint §7.5,
 * LLD §14.4.4) — THE bounded retrieval agent: "plans, retrieves, assesses whether
 * what it has is sufficient, expands if not, and answers with citations — bounded so
 * that it cannot loop." This is the runtime component `orchestration/application/
 * turn-pipeline.ts` calls for a knowledge-scoped agent version's "reply" action —
 * NOT the Retrieval Playground (Phase 9's `playground-service.ts`, a human-driven
 * side-by-side comparison tool with no classifier/expansion-loop/refusal
 * enforcement/`retrieval_event` write, unchanged by this phase).
 *
 * **Disclosed narrowing (single-collection)**: `ResolvedAgentKnowledgeConfig.
 * collectionIds` supports an array (an agent version MAY scope more than one
 * collection, per the Blueprint's own example YAML listing two), but this phase's
 * executor operates over `collectionIds[0]` only — Phase 9's four strategy functions
 * (`RetrievalStrategyParams`) each take exactly ONE collection/generation, and
 * extending them to fan out across multiple collections and MERGE their evidence
 * pools is real, separate complexity (score normalization across independently-built
 * indexes, cross-collection ACL reconciliation) this phase's own brief did not ask
 * for. A future phase can add multi-collection fan-out without changing this
 * function's own contract shape. Every other configured collection id is currently
 * unused.
 *
 * **Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) update — real
 * per-caller ACL scope.** Phase 10 left this executor passing `listAllAclTagsFor
 * Generation`'s "whole generation" union into each strategy's own pre-ranking filter
 * — real filtering, but not yet narrowed to a per-caller subset (see git history for
 * that phase's own disclosed-narrowing comment, superseded by this one). This phase
 * replaces it with `config.aclTags` — `ResolvedAgentKnowledgeConfig.aclTags`, the
 * agent version's own save-time-resolved grant (`spec.knowledge.aclScope`, `@nextbot/
 * agent-platform`'s `createAgentDefinitionVersion`) — so two agent versions scoped to
 * the identical collection now genuinely retrieve DIFFERENT result sets when their
 * declared grants differ, which is FR-KB-08's own core requirement ("a chunk the
 * caller may not see must never influence the ranking of chunks it may see").
 *
 * **Disclosed scope, restated precisely**: full wiring through §14.2's permission-
 * intersection evaluator (a real `ScopeDescriptor`/`scope_json` on `agent_definition_
 * version`, folded through `evaluateOrDeny`) remains out of reach this phase for the
 * same reason Phase 10 found it out of reach — `packages/modules/authz`'s own module
 * doc still discloses that `agent_definition_version` persists no such column (teams/
 * workflows/knowledge chain-ref resolution is tracked as later-phase scope). What
 * changes THIS phase is deriving a real, narrower scope from an already-real input
 * that DOES exist today (the agent version's own declared `aclScope`) rather than
 * continuing to pass "the whole collection." The distinction this genuinely draws is
 * per AGENT VERSION, not per end-user-within-a-conversation — this codebase threads
 * no acting end-user identity into this call site at all (only `conversationId`/
 * `agentRunId`/`agentDefinitionVersionId` reach here), so a true per-human-user
 * narrowing remains structurally unavailable regardless of approach; see `spec.
 * knowledge.aclScope`'s own doc comment (`@nextbot/contracts`) for the full
 * rationale. Legacy rows saved before this phase (whose `knowledgeConfig` JSON
 * predates the `aclTags` field) fall back to `deriveAclTags(ctx.tenantId, {
 * visibility: "Tenant", tags: [] })` below — i.e. "Tenant-visibility content only,
 * no Restricted grant" — a safe, strictly NARROWER default than the old
 * whole-collection behavior, never a silent widening.
 */

export interface RetrievalExecutorRequest {
  query: string;
  config: ResolvedAgentKnowledgeConfig;
  /** Resolved once at agent-version save time (`agent_definition_version.
   *  planner_route_version_id`) — the cheap "classification and sufficiency checks"
   *  route. */
  plannerRouteVersionId: string;
  /** The agent's own answering route (`agent_definition_version.
   *  model_route_version_id`) — used ONLY for the final "answer from evidence"
   *  synthesis call, never for classification/sufficiency. */
  answerRouteVersionId: string;
  conversationId?: string | null;
  agentRunId?: string | null;
  agentDefinitionVersionId?: string | null;
  /** Playground-style explicit override — bypasses `config.strategy`/classification
   *  entirely (`strategySource: 'PlaygroundOverride'` on the written event). Not used
   *  by the live turn-pipeline call site; exists so a future admin "run the bounded
   *  agent, not just the raw strategies" tool can pin a strategy for comparison. */
  strategyOverride?: RetrievalStrategyValue;
}

export interface RetrievalExecutorResult {
  outcome: RetrievalOutcomeValue;
  /**
   * **THE safety-critical field.** `null` if and ONLY IF `outcome === 'Refused'` —
   * enforced by this function's own code (see the `if (willRefuse) answerText =
   * null;` line below), never by asking the model to withhold an answer. A caller
   * (the turn pipeline) that finds `outcome === 'Refused'` must render
   * `KNOWLEDGE_NOT_GROUNDED`'s fallback copy, never fall back to some OTHER text —
   * there is no other text: this field is genuinely null.
   */
  answerText: string | null;
  citations: Citation[];
  strategyUsed: RetrievalStrategyValue;
  hops: number;
  expansions: number;
  latencyMs: number;
  costUsd: string;
  retrievalEventId: string;
}

type StrategyRunner = (params: RetrievalStrategyParams) => Promise<RetrievalStrategyResult>;
const STRATEGY_RUNNERS: Record<RetrievalStrategyValue, StrategyRunner> = {
  Vector: runVectorRetrieval,
  GraphLocal: runGraphLocalRetrieval,
  GraphGlobal: runGraphGlobalRetrieval,
  Hybrid: runHybridRetrieval,
};

/**
 * GraphGlobal's own evidence is community-shaped (`kind: 'CommunitySummary'`) — LLD
 * §14.4.4's `CitationSchema` structurally requires a real `documentId`/`chunkId`
 * (there is no "community" citation shape), so a community summary alone can never
 * legally become a citation. This derives REAL, chunk-grounded evidence backing the
 * top-matched communities' own content: for each of the top 2 communities, the 2
 * highest-degree member entities' 2 highest-confidence edges (their real provenance
 * chunks) — the exact same "one evidence item per relation edge" shape
 * `graph-local-strategy.ts` already produces, just reached via the community's
 * members instead of a query-mentioned anchor. Bounded (2x2x2 = at most 8 edges
 * looked up) so this can never itself become an unbounded fan-out.
 */
async function deriveGraphGlobalChunkEvidence(ctx: TenantContext, generationId: string, communityItems: RetrievalEvidenceItem[]): Promise<RetrievalEvidenceItem[]> {
  const edgeCandidates: Array<{ edge: GraphEdgeRow; communityScore: number }> = [];
  for (const communityItem of communityItems.slice(0, 2)) {
    if (!communityItem.communityId) continue;
    const members = await listEntitiesForCommunity(ctx, generationId, communityItem.communityId);
    const topMembers = [...members].sort((a, b) => b.degree - a.degree).slice(0, 2);
    for (const member of topMembers) {
      const edges = await listEdgesForEntity(ctx, generationId, member.id);
      const topEdges = [...edges].sort((a, b) => b.confidence - a.confidence).slice(0, 2);
      for (const edge of topEdges) edgeCandidates.push({ edge, communityScore: communityItem.score });
    }
  }
  if (edgeCandidates.length === 0) return [];

  const chunkIds = [...new Set(edgeCandidates.map((c) => c.edge.provenanceChunkId))];
  const entityIds = [...new Set(edgeCandidates.flatMap((c) => [c.edge.srcEntityId, c.edge.dstEntityId]))];
  const [chunks, entities] = await Promise.all([listChunksByIds(ctx, chunkIds), listEntitiesByIds(ctx, entityIds)]);
  const chunkById = new Map(chunks.map((c) => [c.id, c]));
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const sources = await listSourcesByIds(ctx, [...new Set(chunks.map((c) => c.sourceId))]);
  const sourceById = new Map(sources.map((s) => [s.id, s]));

  const seenEdgeIds = new Set<string>();
  const items: RetrievalEvidenceItem[] = [];
  for (const { edge, communityScore } of edgeCandidates) {
    if (seenEdgeIds.has(edge.id)) continue;
    seenEdgeIds.add(edge.id);
    const chunk = chunkById.get(edge.provenanceChunkId);
    if (!chunk) continue;
    const src = entityById.get(edge.srcEntityId);
    const dst = entityById.get(edge.dstEntityId);
    items.push({
      kind: "Chunk",
      score: communityScore,
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentTitle: chunk.provenance.documentTitle ?? null,
      sourceId: chunk.sourceId,
      sourceName: sourceById.get(chunk.sourceId)?.name ?? "(unknown source)",
      snippet: chunk.text,
      relationPath: [{ srcName: src?.canonicalName ?? "(unknown entity)", relation: edge.relation, dstName: dst?.canonicalName ?? "(unknown entity)", provenanceChunkId: edge.provenanceChunkId }],
    });
  }
  return items;
}

function toCitations(collectionId: string, collectionName: string, items: RetrievalEvidenceItem[]): Citation[] {
  return items
    .filter((item): item is RetrievalEvidenceItem & { chunkId: string; documentId: string } => Boolean(item.chunkId && item.documentId))
    .slice(0, 8)
    .map((item) => ({
      collectionId,
      collectionName,
      documentId: item.documentId,
      documentTitle: item.documentTitle ?? "(untitled)",
      chunkId: item.chunkId,
      snippet: item.snippet ?? "",
      relationPath: item.relationPath,
    }));
}

/**
 * THE bounded retrieval agent. Implements LLD §14.4.4's loop verbatim:
 * `plan (classify) -> retrieve -> sufficiency-check -> expand | answer -> ground-check
 * (refuse if configured) -> write retrieval_event -> return`.
 */
export async function runBoundedRetrieval(ctx: TenantContext, request: RetrievalExecutorRequest): Promise<RetrievalExecutorResult> {
  const turnStartedAt = Date.now();
  const config = request.config;
  const collectionId = config.collectionIds[0];
  if (!collectionId) throw new Error("runBoundedRetrieval: config.collectionIds is empty — nothing scoped to retrieve against.");

  const collection = await getCollectionOrThrow(ctx, collectionId);
  // LLD §14.4.4 step 1: "resolve generation := collection.current_generation_id
  // (never a superseded one)." A collection with no Ready generation has nothing to
  // retrieve against at all — mirrors `runRetrievalPlayground`'s identical precedent.
  if (!collection.currentGenerationId) throw new KnowledgeGenerationNotReadyError(collectionId);
  const generation = await getGenerationOrThrow(ctx, collection.currentGenerationId);
  if (generation.status !== "Ready") throw new KnowledgeGenerationNotReadyError(generation.id);

  const queryTextHash = createHash("sha256").update(request.query).digest("hex");
  const scopeHash = createHash("sha256").update(JSON.stringify({ config, strategyOverride: request.strategyOverride ?? null })).digest("hex");

  // Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — Coverage: `retrieval_
  // event.query_text_masked` was left permanently NULL through Phase 10 ("this
  // phase always leaves it NULL... no PII-policy-aware masked-query capture exists
  // yet"). This phase populates it — masked per the COLLECTION's own trust level
  // (never the raw query, never the caller's own trust level: this column feeds an
  // aggregate, cross-caller coverage report an admin reads, not a per-caller view,
  // so a single fixed, collection-configured masking level is the right, simpler
  // choice here — unlike citation snippets, which genuinely need per-caller
  // re-evaluation). The raw query text itself is NEVER persisted into this column.
  const queryTextMasked = await (async () => {
    const customRules = await listCustomPiiRulesForMasking(ctx);
    const policyLookup = await buildPolicyLookup(ctx);
    return detectAndMask(request.query, "Knowledge", collection.trustLevel, policyLookup, customRules);
  })();

  // Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — the real per-caller
  // ACL scope every strategy filters candidates against BEFORE ranking (see this
  // function's own doc comment above for the full disclosed-scope rationale). The
  // fallback path only fires for a `knowledgeConfig` JSON persisted before this
  // phase shipped (no `aclTags` field at all) — a strictly NARROWER default
  // (Tenant-visibility content only) than the pre-Phase-11 whole-collection behavior.
  const aclTags = config.aclTags ?? deriveAclTags(ctx.tenantId, { visibility: "Tenant", tags: [] });

  // LLD §14.4.4 step 1's freshness refusal (FR-KB-08): a generation older than the
  // collection's own configured `max_staleness_hours` must be REFUSED, never
  // silently answered from — distinct from (and checked before) the grounding
  // refusal below, since staleness makes the whole retrieval untrustworthy
  // regardless of how many citations it would otherwise produce.
  if (collection.maxStalenessHours !== null && generation.builtAt) {
    const ageHours = (Date.now() - generation.builtAt.getTime()) / (1000 * 60 * 60);
    if (ageHours > collection.maxStalenessHours) {
      const latencyMs = Date.now() - turnStartedAt;
      const evt = await insertRetrievalEvent(ctx, {
        conversationId: request.conversationId,
        agentRunId: request.agentRunId,
        agentDefinitionVersionId: request.agentDefinitionVersionId,
        collectionId: collection.id,
        generationId: generation.id,
        strategy: "Vector",
        strategySource: request.strategyOverride ? "PlaygroundOverride" : config.strategy === "auto" ? "Auto" : "Pinned",
        queryTextHash,
        queryTextMasked,
        hops: 0,
        expansions: 0,
        chunkIds: [],
        citationIds: [],
        topScore: null,
        grounded: false,
        refused: true,
        truncatedByBudget: false,
        latencyMs,
        costUsd: "0.00000000",
        scopeHash,
      });
      return { outcome: "Stale", answerText: null, citations: [], strategyUsed: "Vector", hops: 0, expansions: 0, latencyMs, costUsd: "0.00000000", retrievalEventId: evt.id };
    }
  }

  // Step 2: strategy resolution. `strategyOverride` (playground-style pin) wins,
  // then the agent version's own configured pin, then — only for `auto` — the real
  // query classifier (Blueprint §7.5).
  let strategyUsed: RetrievalStrategyValue;
  let strategySource: "Auto" | "Pinned" | "PlaygroundOverride";
  let consumedUsd = 0;
  if (request.strategyOverride) {
    strategyUsed = request.strategyOverride;
    strategySource = "PlaygroundOverride";
  } else if (config.strategy === "auto") {
    strategySource = "Auto";
    const classification = await classifyRetrievalStrategy(ctx, { generationId: generation.id, query: request.query, plannerRouteVersionId: request.plannerRouteVersionId });
    strategyUsed = classification.strategy;
    consumedUsd += Number(classification.costUsd);
  } else {
    strategyUsed = config.strategy;
    strategySource = "Pinned";
  }

  const maxExpansions = clampMaxExpansions(config.maxExpansions);
  const maxHops = clampMaxHops(config.maxHops);
  const runner = STRATEGY_RUNNERS[strategyUsed];

  let expansionsUsed = 0;
  let truncatedByBudget = false;
  let currentTopK = clampTopK(undefined);
  let latestResult: RetrievalStrategyResult | undefined;

  // Step 3/4: retrieve -> sufficiency-check -> expand, bounded by `maxExpansions`.
  // `attempt` runs from 0 (the first, mandatory retrieval) through `maxExpansions`
  // (the last allowed expansion) inclusive — `maxExpansions + 1` total retrieval
  // calls at the absolute most, REGARDLESS of what the sufficiency check concludes.
  // This `for` loop's own upper bound (`attempt <= maxExpansions`) is the hard
  // iteration cap FR-KB-06 requires — the model's own "insufficient" opinion can
  // only ever cause a `continue`/next-iteration; it can never add an iteration.
  for (let attempt = 0; attempt <= maxExpansions; attempt += 1) {
    if (attempt > 0) {
      const elapsedSeconds = (Date.now() - turnStartedAt) / 1000;
      if (consumedUsd >= config.budget.usdPerTurn || elapsedSeconds >= config.budget.seconds) {
        truncatedByBudget = true;
        break;
      }
      expansionsUsed += 1;
      currentTopK = clampTopK(currentTopK + 8);
    }

    latestResult = await runner({ ctx, collection, generation, query: request.query, topK: currentTopK, maxHops, aclTags });
    consumedUsd += Number(latestResult.metrics.costUsd);

    if (attempt === maxExpansions) break; // hard cap reached — never sufficiency-check or expand past it.

    const elapsedSecondsAfterRetrieve = (Date.now() - turnStartedAt) / 1000;
    if (consumedUsd >= config.budget.usdPerTurn || elapsedSecondsAfterRetrieve >= config.budget.seconds) {
      truncatedByBudget = true;
      break;
    }

    const evidenceSummary = latestResult.items
      .slice(0, 5)
      .map((item, i) => `${i + 1}. ${item.snippet ?? item.summary ?? ""}`.trim())
      .join("\n");
    const sufficiency = await checkSufficiency(ctx, { plannerRouteVersionId: request.plannerRouteVersionId, query: request.query, evidenceSummary });
    consumedUsd += Number(sufficiency.costUsd);
    if (sufficiency.sufficient) break; // done — do not spend another retrieval call.
    // else: insufficient AND attempt < maxExpansions AND budget remains -> loop expands.
  }

  const result = latestResult ?? { strategy: strategyUsed, items: [], metrics: { groundednessScore: null, latencyMs: 0, costUsd: "0.00000000" } };

  // GraphGlobal's own evidence is community-shaped, never directly citable — derive
  // real chunk-grounded citations from its top communities' member entities' edges
  // (see `deriveGraphGlobalChunkEvidence`'s own doc comment).
  const citableItems = strategyUsed === "GraphGlobal" ? await deriveGraphGlobalChunkEvidence(ctx, generation.id, result.items) : result.items;
  const citations = toCitations(collection.id, collection.name, citableItems);

  // Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — PII read-time
  // re-evaluation: re-derive each citation's snippet against THIS agent version's own
  // trust level (`config.callerTrustLevel`, defaulting to `"SemiTrusted"` for a
  // legacy config predating this field — the same default `knowledge_collection.
  // trust_level` itself uses) rather than leaving the collection's own index-time
  // masking as the final word. See `resolveChunkTextForCaller`'s own doc comment for
  // exactly what this can and cannot recover.
  if (citations.length > 0) {
    const callerTrustLevel = config.callerTrustLevel ?? "SemiTrusted";
    const citedChunks = await listChunksByIds(ctx, citations.map((c) => c.chunkId));
    const chunkById = new Map(citedChunks.map((c) => [c.id, c]));
    await Promise.all(
      citations.map(async (citation) => {
        const chunk = chunkById.get(citation.chunkId);
        if (!chunk) return; // e.g. a synthetic/derived citation with no direct chunk row — leave its snippet as-is.
        citation.snippet = await resolveChunkTextForCaller(ctx, chunk, callerTrustLevel);
      }),
    );
  }

  const grounded = citations.length >= config.minCitations;
  const willRefuse = !grounded && config.refuseWhenUngrounded;

  let answerText: string | null = null;
  // Deliberately NOT gated on `!willRefuse`: the model is asked to synthesize an
  // answer whenever there is ANY real evidence at all (even fewer citations than
  // `config.minCitations` requires), so the safety check below is a genuine
  // "discard a real, already-produced answer," never merely "skip asking in the
  // first place." Only truly zero evidence (`citations.length === 0`) skips the
  // call outright — there is nothing for the model to answer from either way.
  if (citations.length > 0) {
    const contextBlock = citations.map((c, i) => `[${i + 1}] ${c.snippet}`).join("\n\n");
    const system =
      "You answer the customer's question using ONLY the numbered evidence snippets provided — never information from outside them. " +
      "If the snippets genuinely do not answer the question, say so plainly rather than guessing. Respond only with the required JSON shape.";
    const userContent = `Question: ${request.query}\n\nEvidence:\n${contextBlock}`;
    try {
      const synthesized = await callModelGatewayStructuredPinned(ctx, {
        routeVersionId: request.answerRouteVersionId,
        routeKeyForLog: "knowledge.retrieval-agent.answer",
        schema: RetrievalAnswerSchema,
        system,
        messages: [{ role: "user", content: userContent }],
        agentRunId: request.agentRunId ?? undefined,
      });
      answerText = synthesized.answer;
      consumedUsd += Number(await estimateCompletionCallCostUsd(ctx, request.answerRouteVersionId, system + userContent, answerText));
    } catch {
      // A failed answer-synthesis call degrades to "no answer produced" — grounded
      // still reflects whether real citations exist; `answerText` staying null here
      // is a genuine "the model failed," not a masked refusal.
      answerText = null;
    }
  }

  // **THE safety-critical line.** Regardless of what was computed above (even if the
  // model successfully produced a plausible-sounding `answerText`), a refusal means
  // the customer NEVER sees it — this is enforced here, in code, unconditionally.
  if (willRefuse) answerText = null;

  const outcome: RetrievalOutcomeValue = willRefuse ? "Refused" : truncatedByBudget ? "BudgetTruncated" : grounded ? "Grounded" : "Ungrounded";
  const latencyMs = Date.now() - turnStartedAt;
  const costUsd = sumCostsUsd(consumedUsd.toFixed(8));

  const retrievalEvent = await insertRetrievalEvent(ctx, {
    conversationId: request.conversationId,
    agentRunId: request.agentRunId,
    agentDefinitionVersionId: request.agentDefinitionVersionId,
    collectionId: collection.id,
    generationId: generation.id,
    strategy: strategyUsed,
    strategySource,
    queryTextHash,
    queryTextMasked,
    hops: maxHops,
    expansions: expansionsUsed,
    chunkIds: citableItems.map((i) => i.chunkId).filter((id): id is string => Boolean(id)),
    citationIds: citations.map((c) => c.chunkId),
    topScore: result.items[0]?.score ?? null,
    grounded,
    refused: willRefuse,
    truncatedByBudget,
    latencyMs,
    costUsd,
    scopeHash,
  });

  return {
    outcome,
    answerText,
    citations,
    strategyUsed,
    hops: maxHops,
    expansions: expansionsUsed,
    latencyMs,
    costUsd,
    retrievalEventId: retrievalEvent.id,
  };
}
