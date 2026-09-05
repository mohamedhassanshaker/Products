import { describe, expect, it, vi, beforeEach } from "vitest";

const callModelGatewayEmbeddingMock = vi.fn();
const callModelGatewayStructuredPinnedMock = vi.fn();
vi.mock("@nextbot/model-gateway", () => ({
  callModelGatewayEmbedding: (...a: unknown[]) => callModelGatewayEmbeddingMock(...a),
  callModelGatewayStructuredPinned: (...a: unknown[]) => callModelGatewayStructuredPinnedMock(...a),
  getCatalogEntry: vi.fn().mockResolvedValue(null),
  resolveModelChainForRouteVersion: vi.fn().mockResolvedValue({ hopAttribution: [] }),
}));

const topKByCosineSimilarityMock = vi.fn();
vi.mock("../../infrastructure/embedding-table.js", () => ({
  topKByCosineSimilarity: (...a: unknown[]) => topKByCosineSimilarityMock(...a),
}));

const listCommunitiesByIdsMock = vi.fn();
vi.mock("../../infrastructure/graph-repository.js", () => ({
  listCommunitiesByIds: (...a: unknown[]) => listCommunitiesByIdsMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };
const collection = { id: "c1", embeddingRouteVersionId: "rv-embed", extractionRouteVersionId: "rv-extract" } as never;
const generation = { id: "g1", graphGenerationLabel: "G_abc", dimension: 384 } as never;

describe("runGraphGlobalRetrieval (unit, mocked infra/model-gateway)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callModelGatewayEmbeddingMock.mockResolvedValue({ embedding: [0.1, 0.2], catalogEntryId: undefined });
  });

  it("returns an empty result with a note when no community summaries exist yet for this generation", async () => {
    topKByCosineSimilarityMock.mockResolvedValue([]);
    const { runGraphGlobalRetrieval } = await import("./graph-global-strategy.js");
    const result = await runGraphGlobalRetrieval({ ctx, collection, generation, query: "what does our policy cover?" });
    expect(result.items).toEqual([]);
    expect(result.note).toMatch(/No community summaries/);
    expect(callModelGatewayStructuredPinnedMock).not.toHaveBeenCalled(); // never reduces over nothing
  });

  it("maps top community summaries and reduces them into a real synthesized answer", async () => {
    topKByCosineSimilarityMock.mockResolvedValue([{ ownerId: "com1", score: 0.8 }]);
    listCommunitiesByIdsMock.mockResolvedValue([{ id: "com1", title: "Acme-Globex Partnership", summary: "Acme and Globex partnered." }]);
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ answer: "They have a partnership." });
    const { runGraphGlobalRetrieval } = await import("./graph-global-strategy.js");
    const result = await runGraphGlobalRetrieval({ ctx, collection, generation, query: "what does our policy cover?" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.kind).toBe("CommunitySummary");
    expect(result.synthesizedAnswer).toBe("They have a partnership.");
    expect(result.metrics.groundednessScore).toBe(0.8);
  });

  it("still returns the map step's real evidence when the reduce completion call fails", async () => {
    topKByCosineSimilarityMock.mockResolvedValue([{ ownerId: "com1", score: 0.8 }]);
    listCommunitiesByIdsMock.mockResolvedValue([{ id: "com1", title: "Acme-Globex Partnership", summary: "Acme and Globex partnered." }]);
    callModelGatewayStructuredPinnedMock.mockRejectedValue(new Error("provider outage"));
    const { runGraphGlobalRetrieval } = await import("./graph-global-strategy.js");
    const result = await runGraphGlobalRetrieval({ ctx, collection, generation, query: "what does our policy cover?" });
    expect(result.items).toHaveLength(1);
    expect(result.synthesizedAnswer).toBeUndefined();
  });

  it("skips a similarity hit whose community row no longer exists, rather than throwing", async () => {
    topKByCosineSimilarityMock.mockResolvedValue([{ ownerId: "com-deleted", score: 0.5 }]);
    listCommunitiesByIdsMock.mockResolvedValue([]); // the community was purged since the hit was indexed
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ answer: "no answer" });
    const { runGraphGlobalRetrieval } = await import("./graph-global-strategy.js");
    const result = await runGraphGlobalRetrieval({ ctx, collection, generation, query: "test" });
    expect(result.items).toEqual([]);
  });

  it("passes the caller-supplied aclTags straight through to the map step's own pre-ranking similarity query (FR-KB-08)", async () => {
    topKByCosineSimilarityMock.mockResolvedValue([]);
    const { runGraphGlobalRetrieval } = await import("./graph-global-strategy.js");
    await runGraphGlobalRetrieval({ ctx, collection, generation, query: "test", aclTags: ["caller-tag-1"] });
    expect(topKByCosineSimilarityMock).toHaveBeenCalledWith(ctx, 384, "g1", "CommunitySummary", [0.1, 0.2], expect.any(Number), ["caller-tag-1"]);
  });
});
