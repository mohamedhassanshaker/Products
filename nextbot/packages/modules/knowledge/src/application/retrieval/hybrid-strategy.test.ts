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

const listEdgesByProvenanceChunkIdsMock = vi.fn();
const listEdgesByIdsMock = vi.fn();
const listEntitiesByIdsMock = vi.fn();
vi.mock("../../infrastructure/graph-repository.js", () => ({
  listEdgesByProvenanceChunkIds: (...a: unknown[]) => listEdgesByProvenanceChunkIdsMock(...a),
  listEdgesByIds: (...a: unknown[]) => listEdgesByIdsMock(...a),
  listEntitiesByIds: (...a: unknown[]) => listEntitiesByIdsMock(...a),
}));

const neighbourhoodMock = vi.fn();
vi.mock("@nextbot/graph-store", () => ({
  Neo4jGraphStore: vi.fn().mockImplementation(() => ({ neighbourhood: (...a: unknown[]) => neighbourhoodMock(...a) })),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };
const collection = { id: "c1", embeddingRouteVersionId: "rv-embed" } as never;
const generation = { id: "g1", graphGenerationLabel: "G_abc", dimension: 384 } as never;
// Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — every real caller now
// supplies its own resolved `aclTags` explicitly; no more internal
// `listAllAclTagsForGeneration` call inside this strategy.
const aclTags = ["tag-tenant-visible"];

describe("runHybridRetrieval (unit, mocked infra/graph-store)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callModelGatewayEmbeddingMock.mockResolvedValue({ embedding: [0.1], catalogEntryId: undefined });
    listEntitiesByIdsMock.mockResolvedValue([]);
  });

  it("returns an empty result with a note when vector recall itself returns nothing to expand", async () => {
    topKByCosineSimilarityMock.mockResolvedValue([]);
    const { runHybridRetrieval } = await import("./hybrid-strategy.js");
    const result = await runHybridRetrieval({ ctx, collection, generation, query: "test", aclTags });
    expect(result.items).toEqual([]);
    expect(result.note).toMatch(/Vector recall returned nothing/);
    expect(neighbourhoodMock).not.toHaveBeenCalled();
  });

  it("passes the caller-supplied aclTags straight through to the vector-recall step's own pre-ranking filter", async () => {
    topKByCosineSimilarityMock.mockResolvedValue([]);
    const { runHybridRetrieval } = await import("./hybrid-strategy.js");
    await runHybridRetrieval({ ctx, collection, generation, query: "test", aclTags: ["only-this-caller-has"] });
    expect(topKByCosineSimilarityMock).toHaveBeenCalledWith(ctx, 384, "g1", "Chunk", [0.1], expect.any(Number), ["only-this-caller-has"]);
  });

  it("skips the graph-expansion step entirely when recalled chunks mention no entities, leaving items unboosted", async () => {
    topKByCosineSimilarityMock.mockResolvedValue([{ ownerId: "chunk1", score: 0.6 }]);
    listChunksByIdsMock.mockResolvedValue([{ id: "chunk1", documentId: "doc1", sourceId: "src1", provenance: { documentTitle: "Doc" }, text: "some passage" }]);
    listEdgesByProvenanceChunkIdsMock.mockResolvedValue([]); // no entities mentioned in the recalled chunk
    listSourcesByIdsMock.mockResolvedValue([{ id: "src1", name: "doc.md" }]);

    const { runHybridRetrieval } = await import("./hybrid-strategy.js");
    const result = await runHybridRetrieval({ ctx, collection, generation, query: "test", aclTags });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.score).toBe(0.6); // no graph boost applied
    expect(result.items[0]?.relationPath).toBeUndefined();
    expect(neighbourhoodMock).not.toHaveBeenCalled(); // no candidate entities -> no expansion call at all
  });

  it("boosts a recalled chunk whose own entity survived the graph expansion, and attaches the relation path", async () => {
    topKByCosineSimilarityMock.mockResolvedValue([{ ownerId: "chunk1", score: 0.6 }]);
    listChunksByIdsMock.mockResolvedValue([{ id: "chunk1", documentId: "doc1", sourceId: "src1", provenance: { documentTitle: "Doc" }, text: "Acme partnered with Globex." }]);
    listEdgesByProvenanceChunkIdsMock.mockResolvedValue([{ id: "edge0", srcEntityId: "e1", dstEntityId: "e2", relation: "PARTNERED_WITH", provenanceChunkId: "chunk1" }]);
    neighbourhoodMock.mockResolvedValue({ nodeIds: ["e1", "e2"], edgeIds: ["edge0"], paths: [], truncated: false });
    listEdgesByIdsMock.mockResolvedValue([{ id: "edge0", srcEntityId: "e1", dstEntityId: "e2", relation: "PARTNERED_WITH", provenanceChunkId: "chunk1" }]);
    listEntitiesByIdsMock.mockResolvedValue([
      { id: "e1", canonicalName: "acme corp" },
      { id: "e2", canonicalName: "globex corporation" },
    ]);
    listSourcesByIdsMock.mockResolvedValue([{ id: "src1", name: "doc.md" }]);

    const { runHybridRetrieval } = await import("./hybrid-strategy.js");
    const result = await runHybridRetrieval({ ctx, collection, generation, query: "test", aclTags });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.score).toBeCloseTo(0.75); // 0.6 + the 0.15 graph boost
    expect(result.items[0]?.relationPath).toEqual([{ srcName: "acme corp", relation: "PARTNERED_WITH", dstName: "globex corporation", provenanceChunkId: "chunk1" }]);
    expect(neighbourhoodMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ aclTags }));
  });
});
