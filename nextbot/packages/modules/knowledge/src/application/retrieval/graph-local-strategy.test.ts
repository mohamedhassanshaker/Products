import { describe, expect, it, vi, beforeEach } from "vitest";

const findAnchorEntitiesByQueryMentionMock = vi.fn();
const listEdgesByIdsMock = vi.fn();
const listEntitiesByIdsMock = vi.fn();
vi.mock("../../infrastructure/graph-repository.js", () => ({
  findAnchorEntitiesByQueryMention: (...a: unknown[]) => findAnchorEntitiesByQueryMentionMock(...a),
  listEdgesByIds: (...a: unknown[]) => listEdgesByIdsMock(...a),
  listEntitiesByIds: (...a: unknown[]) => listEntitiesByIdsMock(...a),
}));

const listChunksByIdsMock = vi.fn();
vi.mock("../../infrastructure/document-chunk-repository.js", () => ({
  listChunksByIds: (...a: unknown[]) => listChunksByIdsMock(...a),
}));

const listSourcesByIdsMock = vi.fn();
vi.mock("../../infrastructure/source-repository.js", () => ({
  listSourcesByIds: (...a: unknown[]) => listSourcesByIdsMock(...a),
}));

const neighbourhoodMock = vi.fn();
vi.mock("@nextbot/graph-store", () => ({
  Neo4jGraphStore: vi.fn().mockImplementation(() => ({ neighbourhood: (...a: unknown[]) => neighbourhoodMock(...a) })),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };
const collection = { id: "c1" } as never;
const generation = { id: "g1", graphGenerationLabel: "G_abc", dimension: 384 } as never;
// Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — every real caller now
// supplies its own resolved `aclTags` explicitly (no more internal
// `listAllAclTagsForGeneration` call inside the strategy itself); tests pass a
// representative non-empty set through so `neighbourhood()`'s own `aclTags` argument
// is asserted against a real, caller-supplied value rather than an internally-fetched
// union.
const aclTags = ["tag-tenant-visible"];

describe("runGraphLocalRetrieval (unit, mocked infra/graph-store)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty result with a note when no anchor entity is found in the query text", async () => {
    findAnchorEntitiesByQueryMentionMock.mockResolvedValue([]);
    const { runGraphLocalRetrieval } = await import("./graph-local-strategy.js");
    const result = await runGraphLocalRetrieval({ ctx, collection, generation, query: "totally unrelated question", aclTags });
    expect(result.items).toEqual([]);
    expect(result.metrics.groundednessScore).toBeNull();
    expect(result.metrics.costUsd).toBe("0.00000000");
    expect(result.note).toMatch(/No entity mentioned/);
    expect(neighbourhoodMock).not.toHaveBeenCalled();
  });

  it("returns an empty result with a note when anchors resolve but no relations exist within the hop bound", async () => {
    findAnchorEntitiesByQueryMentionMock.mockResolvedValue([{ id: "e1", canonicalName: "acme corp" }]);
    neighbourhoodMock.mockResolvedValue({ nodeIds: ["e1"], edgeIds: [], paths: [], truncated: false });
    const { runGraphLocalRetrieval } = await import("./graph-local-strategy.js");
    const result = await runGraphLocalRetrieval({ ctx, collection, generation, query: "acme corp", maxHops: 2, aclTags });
    expect(result.items).toEqual([]);
    expect(result.note).toMatch(/no relations within 2 hop/);
  });

  it("passes the caller-supplied aclTags straight through to the graph store's own pre-ranking predicate", async () => {
    findAnchorEntitiesByQueryMentionMock.mockResolvedValue([{ id: "e1", canonicalName: "acme corp" }]);
    neighbourhoodMock.mockResolvedValue({ nodeIds: ["e1"], edgeIds: [], paths: [], truncated: false });
    const { runGraphLocalRetrieval } = await import("./graph-local-strategy.js");
    await runGraphLocalRetrieval({ ctx, collection, generation, query: "acme corp", aclTags: ["only-this-caller-has"] });
    expect(neighbourhoodMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ aclTags: ["only-this-caller-has"] }));
  });

  it("resolves the graph store's structure-only edge ids into real relation-path evidence", async () => {
    findAnchorEntitiesByQueryMentionMock.mockResolvedValue([{ id: "e1", canonicalName: "acme corp" }]);
    neighbourhoodMock.mockResolvedValue({ nodeIds: ["e1", "e2"], edgeIds: ["edge1"], paths: [{ nodeIds: ["e1", "e2"], edgeIds: ["edge1"], totalWeight: 1 }], truncated: false });
    listEdgesByIdsMock.mockResolvedValue([{ id: "edge1", srcEntityId: "e1", dstEntityId: "e2", relation: "PARTNERED_WITH", weight: 1, confidence: 0.9, provenanceChunkId: "chunk1" }]);
    listEntitiesByIdsMock.mockResolvedValue([
      { id: "e1", canonicalName: "acme corp" },
      { id: "e2", canonicalName: "globex corporation" },
    ]);
    listChunksByIdsMock.mockResolvedValue([{ id: "chunk1", documentId: "doc1", sourceId: "src1", provenance: { documentTitle: "Acme Corp" }, text: "Acme Corp partnered with Globex Corporation." }]);
    listSourcesByIdsMock.mockResolvedValue([{ id: "src1", name: "acme-globex.md" }]);

    const { runGraphLocalRetrieval } = await import("./graph-local-strategy.js");
    const result = await runGraphLocalRetrieval({ ctx, collection, generation, query: "acme corp", aclTags });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.relationPath).toEqual([{ srcName: "acme corp", relation: "PARTNERED_WITH", dstName: "globex corporation", provenanceChunkId: "chunk1" }]);
    expect(result.items[0]?.snippet).toBe("Acme Corp partnered with Globex Corporation.");
    expect(result.metrics.groundednessScore).toBe(0.9);
    expect(result.metrics.costUsd).toBe("0.00000000"); // pure structural traversal, no model call
  });

  it("degrades gracefully (labelled placeholder) when an edge's chunk/entity can't be resolved, rather than throwing", async () => {
    findAnchorEntitiesByQueryMentionMock.mockResolvedValue([{ id: "e1", canonicalName: "acme corp" }]);
    neighbourhoodMock.mockResolvedValue({ nodeIds: ["e1", "e2"], edgeIds: ["edge1"], paths: [], truncated: false });
    listEdgesByIdsMock.mockResolvedValue([{ id: "edge1", srcEntityId: "e1", dstEntityId: "e2", relation: "PARTNERED_WITH", weight: 1, confidence: 0.5, provenanceChunkId: "missing-chunk" }]);
    listEntitiesByIdsMock.mockResolvedValue([]); // neither side resolves
    listChunksByIdsMock.mockResolvedValue([]); // the provenance chunk itself is gone
    listSourcesByIdsMock.mockResolvedValue([]);

    const { runGraphLocalRetrieval } = await import("./graph-local-strategy.js");
    const result = await runGraphLocalRetrieval({ ctx, collection, generation, query: "acme corp", aclTags });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.relationPath?.[0]?.srcName).toBe("(unknown entity)");
    expect(result.items[0]?.snippet).toBeUndefined();
  });
});
