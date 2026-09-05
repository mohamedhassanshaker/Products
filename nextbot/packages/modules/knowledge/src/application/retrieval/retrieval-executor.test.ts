import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-05/06/07, LLD §14.4.4) — unit
 * tests for the bounded retrieval agent with every I/O boundary mocked (real Postgres/
 * real model-gateway coverage lives in `retrieval-agent.int.test.ts`). This file's own
 * focus: the runtime-enforcement branches (`refuseWhenUngrounded` true vs. false, the
 * hard expansion-loop cap, budget truncation, staleness) that are cheapest and fastest
 * to exercise exhaustively here, with every strategy call fully controlled.
 */

const getCollectionOrThrowMock = vi.fn();
vi.mock("../../infrastructure/collection-repository.js", () => ({
  getCollectionOrThrow: (...a: unknown[]) => getCollectionOrThrowMock(...a),
}));

const getGenerationOrThrowMock = vi.fn();
vi.mock("../../infrastructure/generation-repository.js", () => ({
  getGenerationOrThrow: (...a: unknown[]) => getGenerationOrThrowMock(...a),
}));

const listEdgesForEntityMock = vi.fn();
const listEntitiesByIdsMock = vi.fn();
const listEntitiesForCommunityMock = vi.fn();
vi.mock("../../infrastructure/graph-repository.js", () => ({
  listEdgesForEntity: (...a: unknown[]) => listEdgesForEntityMock(...a),
  listEntitiesByIds: (...a: unknown[]) => listEntitiesByIdsMock(...a),
  listEntitiesForCommunity: (...a: unknown[]) => listEntitiesForCommunityMock(...a),
}));

const listChunksByIdsMock = vi.fn();
vi.mock("../../infrastructure/document-chunk-repository.js", () => ({
  listChunksByIds: (...a: unknown[]) => listChunksByIdsMock(...a),
}));

const listSourcesByIdsMock = vi.fn();
vi.mock("../../infrastructure/source-repository.js", () => ({
  listSourcesByIds: (...a: unknown[]) => listSourcesByIdsMock(...a),
}));

const insertRetrievalEventMock = vi.fn();
vi.mock("../../infrastructure/retrieval-event-repository.js", () => ({
  insertRetrievalEvent: (...a: unknown[]) => insertRetrievalEventMock(...a),
}));

const resolveChunkTextForCallerMock = vi.fn();
vi.mock("../pii-reeval-service.js", () => ({
  resolveChunkTextForCaller: (...a: unknown[]) => resolveChunkTextForCallerMock(...a),
}));

const detectAndMaskMock = vi.fn();
const buildPolicyLookupMock = vi.fn();
const listCustomPiiRulesForMaskingMock = vi.fn();
vi.mock("@nextbot/pii", () => ({
  detectAndMask: (...a: unknown[]) => detectAndMaskMock(...a),
  buildPolicyLookup: (...a: unknown[]) => buildPolicyLookupMock(...a),
  listCustomPiiRulesForMasking: (...a: unknown[]) => listCustomPiiRulesForMaskingMock(...a),
}));

const runVectorRetrievalMock = vi.fn();
vi.mock("./vector-strategy.js", () => ({ runVectorRetrieval: (...a: unknown[]) => runVectorRetrievalMock(...a) }));
const runGraphLocalRetrievalMock = vi.fn();
vi.mock("./graph-local-strategy.js", () => ({ runGraphLocalRetrieval: (...a: unknown[]) => runGraphLocalRetrievalMock(...a) }));
const runGraphGlobalRetrievalMock = vi.fn();
vi.mock("./graph-global-strategy.js", () => ({ runGraphGlobalRetrieval: (...a: unknown[]) => runGraphGlobalRetrievalMock(...a) }));
const runHybridRetrievalMock = vi.fn();
vi.mock("./hybrid-strategy.js", () => ({ runHybridRetrieval: (...a: unknown[]) => runHybridRetrievalMock(...a) }));

const classifyRetrievalStrategyMock = vi.fn();
vi.mock("./query-classifier.js", () => ({ classifyRetrievalStrategy: (...a: unknown[]) => classifyRetrievalStrategyMock(...a) }));

const checkSufficiencyMock = vi.fn();
vi.mock("./sufficiency-check.js", () => ({ checkSufficiency: (...a: unknown[]) => checkSufficiencyMock(...a) }));

const callModelGatewayStructuredPinnedMock = vi.fn();
const getCatalogEntryMock = vi.fn();
const resolveModelChainForRouteVersionMock = vi.fn();
vi.mock("@nextbot/model-gateway", () => ({
  callModelGatewayStructuredPinned: (...a: unknown[]) => callModelGatewayStructuredPinnedMock(...a),
  getCatalogEntry: (...a: unknown[]) => getCatalogEntryMock(...a),
  resolveModelChainForRouteVersion: (...a: unknown[]) => resolveModelChainForRouteVersionMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

const BASE_CONFIG = {
  collectionIds: ["col1"],
  strategy: "Vector" as const,
  maxHops: 2,
  maxExpansions: 2,
  minCitations: 1,
  refuseWhenUngrounded: true,
  budget: { usdPerTurn: 1, seconds: 60 },
};

function chunkItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: "Chunk" as const,
    score: 0.9,
    chunkId: "chunk1",
    documentId: "doc1",
    documentTitle: "Refund Policy",
    sourceId: "src1",
    sourceName: "policy.md",
    snippet: "Refunds are processed within 14 days.",
    ...overrides,
  };
}

describe("runBoundedRetrieval (unit, mocked infra/strategies/model-gateway)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCollectionOrThrowMock.mockResolvedValue({ id: "col1", name: "Refund Policy Collection", currentGenerationId: "gen1", maxStalenessHours: null });
    getGenerationOrThrowMock.mockResolvedValue({ id: "gen1", status: "Ready", builtAt: new Date(), dimension: 384, graphGenerationLabel: "G_abc" });
    resolveModelChainForRouteVersionMock.mockResolvedValue({ hopAttribution: [{ catalogEntryId: "cat1" }] });
    getCatalogEntryMock.mockResolvedValue({ priceIn: "0.000001", priceOut: "0.000002" });
    insertRetrievalEventMock.mockResolvedValue({ id: "evt1" });
    checkSufficiencyMock.mockResolvedValue({ sufficient: true, missingConcepts: [], costUsd: "0.00000000" });
    // Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — the citation
    // PII-re-evaluation step looks up each cited chunk's row; default to "not found"
    // (re-eval leaves the citation's own snippet untouched) unless a specific test
    // below overrides it to exercise the re-evaluation path itself.
    listChunksByIdsMock.mockResolvedValue([]);
    resolveChunkTextForCallerMock.mockImplementation(async (_ctx: unknown, chunk: { text: string }) => chunk.text);
    buildPolicyLookupMock.mockResolvedValue(() => "FullMask");
    listCustomPiiRulesForMaskingMock.mockResolvedValue([]);
    detectAndMaskMock.mockImplementation(async (text: string) => text); // no PII in these fixture queries
  });

  it("THE safety-critical case: refuseWhenUngrounded=true discards a REAL, already-produced model answer when citations fall short of minCitations — the customer never sees it", async () => {
    // Below `minCitations: 2` on purpose — exactly one real citation, so the model
    // genuinely IS called and DOES produce a plausible answer, proving this is a
    // runtime override of a real model output, not merely "never asked."
    runVectorRetrievalMock.mockResolvedValue({ strategy: "Vector", items: [chunkItem()], metrics: { groundednessScore: 0.9, latencyMs: 5, costUsd: "0.00000010" } });
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ answer: "Yes — refunds are processed within 14 days per the policy." });

    const { runBoundedRetrieval } = await import("./retrieval-executor.js");
    const result = await runBoundedRetrieval(ctx, {
      query: "What is the refund window?",
      config: { ...BASE_CONFIG, minCitations: 2 },
      plannerRouteVersionId: "planner1",
      answerRouteVersionId: "answer1",
    });

    // The model WAS asked and DID answer — proven by the mock having been called —
    // yet the runtime's own returned result carries neither that text nor any other.
    expect(callModelGatewayStructuredPinnedMock).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe("Refused");
    expect(result.answerText).toBeNull();
    expect(result.citations).toHaveLength(1); // the real citation still exists on the result...
    // ...it just isn't enough to clear minCitations, so the answer is genuinely withheld.
    const [, writtenEvent] = insertRetrievalEventMock.mock.calls[0] as [unknown, { refused: boolean; grounded: boolean }];
    expect(writtenEvent.refused).toBe(true);
    expect(writtenEvent.grounded).toBe(false);
  });

  it("the inverse: refuseWhenUngrounded=false lets the SAME under-cited answer through — proving the flag genuinely gates behavior, not that answers are always refused", async () => {
    runVectorRetrievalMock.mockResolvedValue({ strategy: "Vector", items: [chunkItem()], metrics: { groundednessScore: 0.9, latencyMs: 5, costUsd: "0.00000010" } });
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ answer: "Yes — refunds are processed within 14 days per the policy." });

    const { runBoundedRetrieval } = await import("./retrieval-executor.js");
    const result = await runBoundedRetrieval(ctx, {
      query: "What is the refund window?",
      config: { ...BASE_CONFIG, minCitations: 2, refuseWhenUngrounded: false },
      plannerRouteVersionId: "planner1",
      answerRouteVersionId: "answer1",
    });

    expect(result.outcome).toBe("Ungrounded");
    expect(result.answerText).toBe("Yes — refunds are processed within 14 days per the policy.");
  });

  it("zero evidence at all: refuses without ever calling the answer model (nothing to answer from either way)", async () => {
    runVectorRetrievalMock.mockResolvedValue({ strategy: "Vector", items: [], metrics: { groundednessScore: null, latencyMs: 5, costUsd: "0.00000000" } });

    const { runBoundedRetrieval } = await import("./retrieval-executor.js");
    const result = await runBoundedRetrieval(ctx, {
      query: "Something totally unrelated",
      config: BASE_CONFIG,
      plannerRouteVersionId: "planner1",
      answerRouteVersionId: "answer1",
    });

    expect(result.outcome).toBe("Refused");
    expect(result.answerText).toBeNull();
    expect(callModelGatewayStructuredPinnedMock).not.toHaveBeenCalled();
  });

  it("a grounded answer with enough citations passes through untouched", async () => {
    runVectorRetrievalMock.mockResolvedValue({ strategy: "Vector", items: [chunkItem()], metrics: { groundednessScore: 0.9, latencyMs: 5, costUsd: "0.00000010" } });
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ answer: "Refunds are processed within 14 days." });

    const { runBoundedRetrieval } = await import("./retrieval-executor.js");
    const result = await runBoundedRetrieval(ctx, {
      query: "What is the refund window?",
      config: BASE_CONFIG, // minCitations: 1, exactly matches
      plannerRouteVersionId: "planner1",
      answerRouteVersionId: "answer1",
    });

    expect(result.outcome).toBe("Grounded");
    expect(result.answerText).toBe("Refunds are processed within 14 days.");
    expect(result.citations).toHaveLength(1);
  });

  it("THE bounded-loop hard cap: a sufficiency check that ALWAYS reports insufficient still stops at exactly maxExpansions, never more", async () => {
    runVectorRetrievalMock.mockResolvedValue({ strategy: "Vector", items: [chunkItem()], metrics: { groundednessScore: 0.9, latencyMs: 5, costUsd: "0.00000010" } });
    checkSufficiencyMock.mockResolvedValue({ sufficient: false, missingConcepts: ["more detail"], costUsd: "0.00000001" }); // ALWAYS insufficient — would loop forever without a real cap.
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ answer: "Refunds are processed within 14 days." });

    const { runBoundedRetrieval } = await import("./retrieval-executor.js");
    const result = await runBoundedRetrieval(ctx, {
      query: "What is the refund window?",
      config: { ...BASE_CONFIG, maxExpansions: 2 },
      plannerRouteVersionId: "planner1",
      answerRouteVersionId: "answer1",
    });

    // maxExpansions=2 -> at most 3 total retrieval calls (attempt 0,1,2) and 2
    // sufficiency checks (after attempts 0 and 1 — never after the last, since no
    // further expansion is possible regardless of the model's opinion).
    expect(runVectorRetrievalMock).toHaveBeenCalledTimes(3);
    expect(checkSufficiencyMock).toHaveBeenCalledTimes(2);
    expect(result.expansions).toBe(2);
  });

  it("stops expanding as soon as the sufficiency check reports sufficient — never spends an expansion it doesn't need", async () => {
    runVectorRetrievalMock.mockResolvedValue({ strategy: "Vector", items: [chunkItem()], metrics: { groundednessScore: 0.9, latencyMs: 5, costUsd: "0.00000010" } });
    checkSufficiencyMock.mockResolvedValue({ sufficient: true, missingConcepts: [], costUsd: "0.00000001" });
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ answer: "Refunds are processed within 14 days." });

    const { runBoundedRetrieval } = await import("./retrieval-executor.js");
    const result = await runBoundedRetrieval(ctx, {
      query: "What is the refund window?",
      config: { ...BASE_CONFIG, maxExpansions: 5 },
      plannerRouteVersionId: "planner1",
      answerRouteVersionId: "answer1",
    });

    expect(runVectorRetrievalMock).toHaveBeenCalledTimes(1);
    expect(result.expansions).toBe(0);
  });

  it("budget enforcement: the sufficiency check's OWN cost tipping the total over budget is caught by the pre-expansion check, before a second retrieval call ever runs", async () => {
    runVectorRetrievalMock.mockResolvedValue({ strategy: "Vector", items: [chunkItem()], metrics: { groundednessScore: 0.9, latencyMs: 5, costUsd: "0.015" } }); // under budget alone
    checkSufficiencyMock.mockResolvedValue({ sufficient: false, missingConcepts: ["x"], costUsd: "0.01" }); // pushes the running total over budget
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ answer: "Refunds are processed within 14 days." });

    const { runBoundedRetrieval } = await import("./retrieval-executor.js");
    const result = await runBoundedRetrieval(ctx, {
      query: "What is the refund window?",
      config: { ...BASE_CONFIG, maxExpansions: 3, budget: { usdPerTurn: 0.02, seconds: 60 } },
      plannerRouteVersionId: "planner1",
      answerRouteVersionId: "answer1",
    });

    expect(result.outcome).toBe("BudgetTruncated");
    expect(runVectorRetrievalMock).toHaveBeenCalledTimes(1); // the second call's own pre-expansion budget check stopped it before it ever ran.
    expect(checkSufficiencyMock).toHaveBeenCalledTimes(1);
    expect(result.expansions).toBe(0);
  });

  it("a failed answer-synthesis call degrades to a null answer without masking a genuinely grounded outcome (never mistaken for a refusal)", async () => {
    runVectorRetrievalMock.mockResolvedValue({ strategy: "Vector", items: [chunkItem()], metrics: { groundednessScore: 0.9, latencyMs: 5, costUsd: "0.00000010" } });
    callModelGatewayStructuredPinnedMock.mockRejectedValue(new Error("upstream provider error"));

    const { runBoundedRetrieval } = await import("./retrieval-executor.js");
    const result = await runBoundedRetrieval(ctx, {
      query: "What is the refund window?",
      config: BASE_CONFIG, // minCitations: 1, exactly matches the one real citation
      plannerRouteVersionId: "planner1",
      answerRouteVersionId: "answer1",
    });

    expect(result.outcome).toBe("Grounded"); // grounded reflects citations, independent of answer-synthesis success.
    expect(result.answerText).toBeNull(); // degraded — the model failed, this is not a refusal.
  });

  it("budget enforcement: a per-iteration cost that immediately exceeds usdPerTurn truncates before any expansion is spent", async () => {
    runVectorRetrievalMock.mockResolvedValue({ strategy: "Vector", items: [chunkItem()], metrics: { groundednessScore: 0.9, latencyMs: 5, costUsd: "5.00000000" } }); // way over budget in one call
    checkSufficiencyMock.mockResolvedValue({ sufficient: false, missingConcepts: ["x"], costUsd: "0.00000000" });
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ answer: "Refunds are processed within 14 days." });

    const { runBoundedRetrieval } = await import("./retrieval-executor.js");
    const result = await runBoundedRetrieval(ctx, {
      query: "What is the refund window?",
      config: { ...BASE_CONFIG, maxExpansions: 5, budget: { usdPerTurn: 0.02, seconds: 60 } },
      plannerRouteVersionId: "planner1",
      answerRouteVersionId: "answer1",
    });

    expect(result.outcome).toBe("BudgetTruncated");
    expect(runVectorRetrievalMock).toHaveBeenCalledTimes(1); // truncated before a second (expansion) call
    expect(result.expansions).toBe(0);
    const [, writtenEvent] = insertRetrievalEventMock.mock.calls[0] as [unknown, { truncatedByBudget: boolean }];
    expect(writtenEvent.truncatedByBudget).toBe(true);
  });

  it("staleness refusal fires (and writes a retrieval_event) before any strategy call, when the generation is older than the collection's configured max staleness", async () => {
    getCollectionOrThrowMock.mockResolvedValue({ id: "col1", name: "Refund Policy Collection", currentGenerationId: "gen1", maxStalenessHours: 1 });
    getGenerationOrThrowMock.mockResolvedValue({ id: "gen1", status: "Ready", builtAt: new Date(Date.now() - 5 * 60 * 60 * 1000), dimension: 384, graphGenerationLabel: "G_abc" }); // 5h old, 1h ceiling

    const { runBoundedRetrieval } = await import("./retrieval-executor.js");
    const result = await runBoundedRetrieval(ctx, {
      query: "What is the refund window?",
      config: BASE_CONFIG,
      plannerRouteVersionId: "planner1",
      answerRouteVersionId: "answer1",
    });

    expect(result.outcome).toBe("Stale");
    expect(result.answerText).toBeNull();
    expect(runVectorRetrievalMock).not.toHaveBeenCalled();
    expect(insertRetrievalEventMock).toHaveBeenCalledTimes(1);
  });

  it("`auto` strategy classifies once via the real classifier function, never re-classifying per expansion", async () => {
    classifyRetrievalStrategyMock.mockResolvedValue({ strategy: "GraphLocal", anchorCount: 1, costUsd: "0.00000001" });
    runGraphLocalRetrievalMock.mockResolvedValue({ strategy: "GraphLocal", items: [chunkItem({ relationPath: [{ srcName: "Acme", relation: "PARTNERED_WITH", dstName: "Globex", provenanceChunkId: "chunk1" }] })], metrics: { groundednessScore: 0.9, latencyMs: 5, costUsd: "0.00000000" } });
    checkSufficiencyMock.mockResolvedValue({ sufficient: true, missingConcepts: [], costUsd: "0.00000000" });
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ answer: "Yes, they are partnered." });

    const { runBoundedRetrieval } = await import("./retrieval-executor.js");
    const result = await runBoundedRetrieval(ctx, {
      query: "Does Acme partner with Globex?",
      config: { ...BASE_CONFIG, strategy: "auto" },
      plannerRouteVersionId: "planner1",
      answerRouteVersionId: "answer1",
    });

    expect(classifyRetrievalStrategyMock).toHaveBeenCalledTimes(1);
    expect(result.strategyUsed).toBe("GraphLocal");
    expect(runVectorRetrievalMock).not.toHaveBeenCalled();
    const [, writtenEvent] = insertRetrievalEventMock.mock.calls[0] as [unknown, { strategySource: string }];
    expect(writtenEvent.strategySource).toBe("Auto");
  });

  it("a pinned (non-auto) strategy never calls the classifier", async () => {
    runHybridRetrievalMock.mockResolvedValue({ strategy: "Hybrid", items: [chunkItem()], metrics: { groundednessScore: 0.9, latencyMs: 5, costUsd: "0.00000000" } });
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ answer: "Refunds are processed within 14 days." });

    const { runBoundedRetrieval } = await import("./retrieval-executor.js");
    const result = await runBoundedRetrieval(ctx, {
      query: "What is the refund window?",
      config: { ...BASE_CONFIG, strategy: "Hybrid" },
      plannerRouteVersionId: "planner1",
      answerRouteVersionId: "answer1",
    });

    expect(classifyRetrievalStrategyMock).not.toHaveBeenCalled();
    expect(result.strategyUsed).toBe("Hybrid");
  });

  it("GraphGlobal's community-shaped evidence is derived into real chunk-grounded citations rather than left uncitable", async () => {
    runGraphGlobalRetrievalMock.mockResolvedValue({
      strategy: "GraphGlobal",
      items: [{ kind: "CommunitySummary", score: 0.8, communityId: "comm1", communityTitle: "Refund Policy Theme", summary: "Refunds generally take 14 days." }],
      metrics: { groundednessScore: 0.8, latencyMs: 5, costUsd: "0.00000005" },
    });
    listEntitiesForCommunityMock.mockResolvedValue([{ id: "e1", degree: 3, canonicalName: "Refund Policy" }]);
    listEdgesForEntityMock.mockResolvedValue([{ id: "edge1", srcEntityId: "e1", dstEntityId: "e2", relation: "DEFINES", confidence: 0.9, provenanceChunkId: "chunk1" }]);
    listEntitiesByIdsMock.mockResolvedValue([
      { id: "e1", canonicalName: "Refund Policy" },
      { id: "e2", canonicalName: "14-day window" },
    ]);
    listChunksByIdsMock.mockResolvedValue([{ id: "chunk1", documentId: "doc1", sourceId: "src1", provenance: { documentTitle: "Refund Policy" }, text: "Refunds are processed within 14 days of return." }]);
    listSourcesByIdsMock.mockResolvedValue([{ id: "src1", name: "policy.md" }]);
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ answer: "Refunds generally take 14 days." });

    const { runBoundedRetrieval } = await import("./retrieval-executor.js");
    const result = await runBoundedRetrieval(ctx, {
      query: "What does our refund policy cover overall?",
      config: { ...BASE_CONFIG, strategy: "GraphGlobal" },
      plannerRouteVersionId: "planner1",
      answerRouteVersionId: "answer1",
    });

    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]?.chunkId).toBe("chunk1");
    expect(result.citations[0]?.relationPath?.[0]).toEqual({ srcName: "Refund Policy", relation: "DEFINES", dstName: "14-day window", provenanceChunkId: "chunk1" });
    expect(result.outcome).toBe("Grounded");
  });

  it("Target Architecture Blueprint Phase 11 (FR-KB-08): passes the agent version's own resolved aclTags straight through to the strategy runner, not the whole-collection union", async () => {
    runVectorRetrievalMock.mockResolvedValue({ strategy: "Vector", items: [chunkItem()], metrics: { groundednessScore: 0.9, latencyMs: 5, costUsd: "0.00000010" } });
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ answer: "Refunds are processed within 14 days." });

    const { runBoundedRetrieval } = await import("./retrieval-executor.js");
    await runBoundedRetrieval(ctx, {
      query: "What is the refund window?",
      config: { ...BASE_CONFIG, aclTags: ["caller-only-tag"] },
      plannerRouteVersionId: "planner1",
      answerRouteVersionId: "answer1",
    });

    const [passedParams] = runVectorRetrievalMock.mock.calls[0] as [{ aclTags: string[] }];
    expect(passedParams.aclTags).toEqual(["caller-only-tag"]);
  });

  it("falls back to a Tenant-visibility-only default (never the old whole-collection behavior) when a legacy config predates the aclTags field", async () => {
    runVectorRetrievalMock.mockResolvedValue({ strategy: "Vector", items: [chunkItem()], metrics: { groundednessScore: 0.9, latencyMs: 5, costUsd: "0.00000010" } });
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ answer: "Refunds are processed within 14 days." });

    const { runBoundedRetrieval } = await import("./retrieval-executor.js");
    // BASE_CONFIG carries no `aclTags` at all — simulates a pre-Phase-11 persisted row.
    await runBoundedRetrieval(ctx, { query: "What is the refund window?", config: BASE_CONFIG, plannerRouteVersionId: "planner1", answerRouteVersionId: "answer1" });

    const [passedParams] = runVectorRetrievalMock.mock.calls[0] as [{ aclTags: string[] }];
    expect(passedParams.aclTags.length).toBeGreaterThan(0); // a real, non-empty tag set (the Tenant-visibility hash) — never an empty "matches nothing" array
    expect(passedParams.aclTags).not.toEqual([]);
  });

  it("Target Architecture Blueprint Phase 11 (FR-KB-08): re-evaluates each citation's snippet against the agent version's own callerTrustLevel via resolveChunkTextForCaller", async () => {
    runVectorRetrievalMock.mockResolvedValue({ strategy: "Vector", items: [chunkItem()], metrics: { groundednessScore: 0.9, latencyMs: 5, costUsd: "0.00000010" } });
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ answer: "Refunds are processed within 14 days." });
    listChunksByIdsMock.mockResolvedValue([{ id: "chunk1", text: "*** are processed within 14 days.", textUnmaskedRef: "ref-1" }]);
    resolveChunkTextForCallerMock.mockResolvedValue("Refunds are processed within 14 days. (re-evaluated, less masked)");

    const { runBoundedRetrieval } = await import("./retrieval-executor.js");
    const result = await runBoundedRetrieval(ctx, {
      query: "What is the refund window?",
      config: { ...BASE_CONFIG, callerTrustLevel: "Trusted" },
      plannerRouteVersionId: "planner1",
      answerRouteVersionId: "answer1",
    });

    expect(resolveChunkTextForCallerMock).toHaveBeenCalledWith(ctx, expect.objectContaining({ id: "chunk1" }), "Trusted");
    expect(result.citations[0]?.snippet).toBe("Refunds are processed within 14 days. (re-evaluated, less masked)");
  });

  it("defaults callerTrustLevel to SemiTrusted when a legacy config predates the field", async () => {
    runVectorRetrievalMock.mockResolvedValue({ strategy: "Vector", items: [chunkItem()], metrics: { groundednessScore: 0.9, latencyMs: 5, costUsd: "0.00000010" } });
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ answer: "Refunds are processed within 14 days." });
    listChunksByIdsMock.mockResolvedValue([{ id: "chunk1", text: "Refunds are processed within 14 days.", textUnmaskedRef: "ref-1" }]);

    const { runBoundedRetrieval } = await import("./retrieval-executor.js");
    await runBoundedRetrieval(ctx, { query: "What is the refund window?", config: BASE_CONFIG, plannerRouteVersionId: "planner1", answerRouteVersionId: "answer1" });

    expect(resolveChunkTextForCallerMock).toHaveBeenCalledWith(ctx, expect.objectContaining({ id: "chunk1" }), "SemiTrusted");
  });

  it("propagates KnowledgeGenerationNotReadyError when the collection has no Ready generation at all — the caller (turn-pipeline) is expected to degrade, not this function", async () => {
    getCollectionOrThrowMock.mockResolvedValue({ id: "col1", name: "Empty Collection", currentGenerationId: null, maxStalenessHours: null });
    const { runBoundedRetrieval } = await import("./retrieval-executor.js");
    await expect(
      runBoundedRetrieval(ctx, { query: "anything", config: BASE_CONFIG, plannerRouteVersionId: "planner1", answerRouteVersionId: "answer1" }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_GENERATION_NOT_READY" });
  });
});
