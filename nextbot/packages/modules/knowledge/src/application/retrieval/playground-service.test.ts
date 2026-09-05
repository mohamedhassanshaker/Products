import { describe, expect, it, vi, beforeEach } from "vitest";

// `./retrieval-types.js`'s own cost-estimation helpers import `@nextbot/model-
// gateway` directly — stubbed here (even though this file's own mocked strategy
// runners never call it) purely to keep this a genuine fast unit test, the same
// heavy-import-cost fix `http/admin-routes.test.ts` needed for the same reason.
vi.mock("@nextbot/model-gateway", () => ({
  getCatalogEntry: vi.fn().mockResolvedValue(null),
  resolveModelChainForRouteVersion: vi.fn().mockResolvedValue({ hopAttribution: [] }),
}));

const getCollectionOrThrowMock = vi.fn();
vi.mock("../../infrastructure/collection-repository.js", () => ({
  getCollectionOrThrow: (...a: unknown[]) => getCollectionOrThrowMock(...a),
}));

const getGenerationOrThrowMock = vi.fn();
vi.mock("../../infrastructure/generation-repository.js", () => ({
  getGenerationOrThrow: (...a: unknown[]) => getGenerationOrThrowMock(...a),
}));

// Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — the Playground now
// explicitly resolves the generation's own whole-collection ACL-tag union itself
// (previously each strategy reached for this internally) before running any
// strategy, so this real-DB-backed function must be mocked here too.
const listAllAclTagsForGenerationMock = vi.fn();
vi.mock("../../infrastructure/graph-repository.js", () => ({
  listAllAclTagsForGeneration: (...a: unknown[]) => listAllAclTagsForGenerationMock(...a),
}));

const runVectorRetrievalMock = vi.fn();
vi.mock("./vector-strategy.js", () => ({ runVectorRetrieval: (...a: unknown[]) => runVectorRetrievalMock(...a) }));
const runGraphLocalRetrievalMock = vi.fn();
vi.mock("./graph-local-strategy.js", () => ({ runGraphLocalRetrieval: (...a: unknown[]) => runGraphLocalRetrievalMock(...a) }));
const runGraphGlobalRetrievalMock = vi.fn();
vi.mock("./graph-global-strategy.js", () => ({ runGraphGlobalRetrieval: (...a: unknown[]) => runGraphGlobalRetrievalMock(...a) }));
const runHybridRetrievalMock = vi.fn();
vi.mock("./hybrid-strategy.js", () => ({ runHybridRetrieval: (...a: unknown[]) => runHybridRetrievalMock(...a) }));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

function okResult(strategy: string) {
  return { strategy, items: [], metrics: { groundednessScore: null, latencyMs: 1, costUsd: "0.00000000" } };
}

describe("runRetrievalPlayground (unit, mocked infra + strategy runners)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runVectorRetrievalMock.mockResolvedValue(okResult("Vector"));
    runGraphLocalRetrievalMock.mockResolvedValue(okResult("GraphLocal"));
    runGraphGlobalRetrievalMock.mockResolvedValue(okResult("GraphGlobal"));
    runHybridRetrievalMock.mockResolvedValue(okResult("Hybrid"));
    listAllAclTagsForGenerationMock.mockResolvedValue(["tag1"]);
  });

  it("rejects an empty/whitespace-only query before touching any repository", async () => {
    const { runRetrievalPlayground } = await import("./playground-service.js");
    await expect(runRetrievalPlayground(ctx, "c1", { query: "   " })).rejects.toMatchObject({ code: "RETRIEVAL_QUERY_REQUIRED" });
    expect(getCollectionOrThrowMock).not.toHaveBeenCalled();
  });

  it("rejects with KNOWLEDGE_GENERATION_NOT_READY when the collection has no current generation", async () => {
    getCollectionOrThrowMock.mockResolvedValue({ id: "c1", currentGenerationId: null });
    const { runRetrievalPlayground } = await import("./playground-service.js");
    await expect(runRetrievalPlayground(ctx, "c1", { query: "test" })).rejects.toMatchObject({ code: "KNOWLEDGE_GENERATION_NOT_READY" });
  });

  it("rejects with KNOWLEDGE_GENERATION_NOT_READY when the current generation isn't actually Ready", async () => {
    getCollectionOrThrowMock.mockResolvedValue({ id: "c1", currentGenerationId: "g1" });
    getGenerationOrThrowMock.mockResolvedValue({ id: "g1", status: "Building" });
    const { runRetrievalPlayground } = await import("./playground-service.js");
    await expect(runRetrievalPlayground(ctx, "c1", { query: "test" })).rejects.toMatchObject({ code: "KNOWLEDGE_GENERATION_NOT_READY" });
  });

  it("runs only the requested subset of strategies, deduplicated", async () => {
    getCollectionOrThrowMock.mockResolvedValue({ id: "c1", currentGenerationId: "g1" });
    getGenerationOrThrowMock.mockResolvedValue({ id: "g1", status: "Ready" });
    const { runRetrievalPlayground } = await import("./playground-service.js");
    const result = await runRetrievalPlayground(ctx, "c1", { query: "test", strategies: ["Vector", "Vector"] });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.strategy).toBe("Vector");
    expect(runGraphLocalRetrievalMock).not.toHaveBeenCalled();
  });

  it("runs all four strategies by default and returns exactly four results", async () => {
    getCollectionOrThrowMock.mockResolvedValue({ id: "c1", currentGenerationId: "g1" });
    getGenerationOrThrowMock.mockResolvedValue({ id: "g1", status: "Ready" });
    const { runRetrievalPlayground } = await import("./playground-service.js");
    const result = await runRetrievalPlayground(ctx, "c1", { query: "test" });
    expect(result.results.map((r) => r.strategy).sort()).toEqual(["GraphGlobal", "GraphLocal", "Hybrid", "Vector"]);
  });

  it("catches one strategy's failure and surfaces it as a zero-evidence result with a note, without hiding the others", async () => {
    getCollectionOrThrowMock.mockResolvedValue({ id: "c1", currentGenerationId: "g1" });
    getGenerationOrThrowMock.mockResolvedValue({ id: "g1", status: "Ready" });
    runGraphGlobalRetrievalMock.mockRejectedValue(new Error("provider outage"));
    const { runRetrievalPlayground } = await import("./playground-service.js");
    const result = await runRetrievalPlayground(ctx, "c1", { query: "test" });
    expect(result.results).toHaveLength(4);
    const failed = result.results.find((r) => r.strategy === "GraphGlobal");
    expect(failed?.items).toEqual([]);
    expect(failed?.note).toMatch(/This strategy failed: provider outage/);
    const others = result.results.filter((r) => r.strategy !== "GraphGlobal");
    expect(others.every((r) => r.note === undefined)).toBe(true);
  });

  it("Target Architecture Blueprint Phase 11 (FR-KB-08): passes the generation's own whole-collection ACL-tag union to every strategy (the disclosed admin-tool-only precedent)", async () => {
    getCollectionOrThrowMock.mockResolvedValue({ id: "c1", currentGenerationId: "g1" });
    getGenerationOrThrowMock.mockResolvedValue({ id: "g1", status: "Ready" });
    listAllAclTagsForGenerationMock.mockResolvedValue(["whole-collection-tag"]);
    const { runRetrievalPlayground } = await import("./playground-service.js");
    await runRetrievalPlayground(ctx, "c1", { query: "test", strategies: ["Vector"] });
    const [passedParams] = runVectorRetrievalMock.mock.calls[0] as [{ aclTags: string[] }];
    expect(passedParams.aclTags).toEqual(["whole-collection-tag"]);
  });
});
