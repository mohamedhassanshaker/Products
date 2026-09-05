import { describe, expect, it, vi, beforeEach } from "vitest";

const callModelGatewayEmbeddingMock = vi.fn();
vi.mock("@nextbot/model-gateway", () => ({
  callModelGatewayEmbedding: (...a: unknown[]) => callModelGatewayEmbeddingMock(...a),
  getCatalogEntry: vi.fn().mockResolvedValue(null),
}));

const topKByCosineSimilarityMock = vi.fn();
vi.mock("../../infrastructure/embedding-table.js", () => ({
  topKByCosineSimilarity: (...a: unknown[]) => topKByCosineSimilarityMock(...a),
}));

const listChunksByIdsMock = vi.fn();
vi.mock("../../infrastructure/document-chunk-repository.js", () => ({
  listChunksByIds: (...a: unknown[]) => listChunksByIdsMock(...a),
}));

const listSourcesByIdsMock = vi.fn();
vi.mock("../../infrastructure/source-repository.js", () => ({
  listSourcesByIds: (...a: unknown[]) => listSourcesByIdsMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };
const collection = { id: "c1", embeddingRouteVersionId: "rv-embed" } as never;
const generation = { id: "g1", dimension: 384 } as never;

describe("runVectorRetrieval (unit, mocked infra/model-gateway)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callModelGatewayEmbeddingMock.mockResolvedValue({ embedding: [0.1], catalogEntryId: undefined });
  });

  it("returns an empty result with a null groundedness score when nothing similar is indexed yet", async () => {
    topKByCosineSimilarityMock.mockResolvedValue([]);
    listChunksByIdsMock.mockResolvedValue([]);
    listSourcesByIdsMock.mockResolvedValue([]);
    const { runVectorRetrieval } = await import("./vector-strategy.js");
    const result = await runVectorRetrieval({ ctx, collection, generation, query: "test" });
    expect(result.items).toEqual([]);
    expect(result.metrics.groundednessScore).toBeNull();
  });

  it("skips a similarity hit whose chunk row no longer exists, rather than throwing", async () => {
    topKByCosineSimilarityMock.mockResolvedValue([
      { ownerId: "chunk-gone", score: 0.9 },
      { ownerId: "chunk1", score: 0.7 },
    ]);
    listChunksByIdsMock.mockResolvedValue([{ id: "chunk1", documentId: "doc1", sourceId: "src1", provenance: { documentTitle: "Doc" }, text: "real passage" }]);
    listSourcesByIdsMock.mockResolvedValue([{ id: "src1", name: "doc.md" }]);
    const { runVectorRetrieval } = await import("./vector-strategy.js");
    const result = await runVectorRetrieval({ ctx, collection, generation, query: "test" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.chunkId).toBe("chunk1");
    // The FIRST hit's score (0.9, for the deleted chunk) is never surfaced as
    // groundedness — only a real, resolvable item's own score counts.
    expect(result.metrics.groundednessScore).toBe(0.7);
  });

  it("passes the caller-supplied aclTags straight through to the pre-ranking similarity query (FR-KB-08)", async () => {
    topKByCosineSimilarityMock.mockResolvedValue([]);
    listChunksByIdsMock.mockResolvedValue([]);
    listSourcesByIdsMock.mockResolvedValue([]);
    const { runVectorRetrieval } = await import("./vector-strategy.js");
    await runVectorRetrieval({ ctx, collection, generation, query: "test", aclTags: ["caller-tag-1"] });
    expect(topKByCosineSimilarityMock).toHaveBeenCalledWith(ctx, 384, "g1", "Chunk", [0.1], expect.any(Number), ["caller-tag-1"]);
  });
});
