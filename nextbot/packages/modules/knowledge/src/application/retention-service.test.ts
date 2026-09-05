import { describe, expect, it, vi, beforeEach } from "vitest";

const getSourceOrThrowMock = vi.fn();
const markSourcePurgedMock = vi.fn();
const listSourcesForCollectionMock = vi.fn();
vi.mock("../infrastructure/source-repository.js", () => ({
  getSourceOrThrow: (...a: unknown[]) => getSourceOrThrowMock(...a),
  deleteSource: (...a: unknown[]) => markSourcePurgedMock(...a),
  listSourcesForCollection: (...a: unknown[]) => listSourcesForCollectionMock(...a),
}));

const listCollectionsMock = vi.fn();
vi.mock("../infrastructure/collection-repository.js", () => ({
  listCollections: (...a: unknown[]) => listCollectionsMock(...a),
}));

const getGenerationOrThrowMock = vi.fn();
vi.mock("../infrastructure/generation-repository.js", () => ({
  getGenerationOrThrow: (...a: unknown[]) => getGenerationOrThrowMock(...a),
}));

const listChunksForSourceMock = vi.fn();
const deleteChunksByIdsMock = vi.fn();
vi.mock("../infrastructure/document-chunk-repository.js", () => ({
  listChunksForSource: (...a: unknown[]) => listChunksForSourceMock(...a),
  deleteChunksByIds: (...a: unknown[]) => deleteChunksByIdsMock(...a),
}));

const listEdgesByProvenanceChunkIdsMock = vi.fn();
const listEdgesForEntityMock = vi.fn();
const listEntitiesByIdsMock = vi.fn();
const listEntitiesForCommunityMock = vi.fn();
const deleteEdgesByIdsMock = vi.fn();
const deleteEntitiesByIdsMock = vi.fn();
const deleteCommunitiesByIdsMock = vi.fn();
const markCommunitiesStaleMock = vi.fn();
const updateCommunityAclTagsMock = vi.fn();
vi.mock("../infrastructure/graph-repository.js", () => ({
  listEdgesByProvenanceChunkIds: (...a: unknown[]) => listEdgesByProvenanceChunkIdsMock(...a),
  listEdgesForEntity: (...a: unknown[]) => listEdgesForEntityMock(...a),
  listEntitiesByIds: (...a: unknown[]) => listEntitiesByIdsMock(...a),
  listEntitiesForCommunity: (...a: unknown[]) => listEntitiesForCommunityMock(...a),
  deleteEdgesByIds: (...a: unknown[]) => deleteEdgesByIdsMock(...a),
  deleteEntitiesByIds: (...a: unknown[]) => deleteEntitiesByIdsMock(...a),
  deleteCommunitiesByIds: (...a: unknown[]) => deleteCommunitiesByIdsMock(...a),
  markCommunitiesStale: (...a: unknown[]) => markCommunitiesStaleMock(...a),
  updateCommunityAclTags: (...a: unknown[]) => updateCommunityAclTagsMock(...a),
}));

const enqueueJobMock = vi.fn();
vi.mock("../infrastructure/ingestion-job-repository.js", () => ({
  enqueueJob: (...a: unknown[]) => enqueueJobMock(...a),
}));

const deleteNodesMock = vi.fn();
vi.mock("@nextbot/graph-store", () => ({
  Neo4jGraphStore: vi.fn().mockImplementation(() => ({ deleteNodes: (...a: unknown[]) => deleteNodesMock(...a) })),
}));

const listActiveTenantContextsMock = vi.fn();
const computePurgeCutoffMock = vi.fn();
vi.mock("@nextbot/tenancy", () => ({
  listActiveTenantContexts: (...a: unknown[]) => listActiveTenantContextsMock(...a),
  computePurgeCutoff: (...a: unknown[]) => computePurgeCutoffMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

describe("purgeSourceContent (Target Architecture Blueprint Phase 11, BL-42, FR-KB-08/FR-ADM-06)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSourceOrThrowMock.mockResolvedValue({ id: "src1" });
    getGenerationOrThrowMock.mockResolvedValue({ id: "gen1", graphGenerationLabel: "G_abc" });
  });

  it("removes chunks and reports zero graph impact when the source's chunks have no edges at all", async () => {
    listChunksForSourceMock.mockResolvedValue([{ id: "chunk1", generationId: "gen1" }]);
    listEdgesByProvenanceChunkIdsMock.mockResolvedValue([]);
    const { purgeSourceContent } = await import("./retention-service.js");
    const result = await purgeSourceContent(ctx, "src1");
    expect(result.chunksDeleted).toBe(1);
    expect(result.edgesDeleted).toBe(0);
    expect(deleteChunksByIdsMock).toHaveBeenCalledWith(ctx, ["chunk1"]);
    expect(markSourcePurgedMock).toHaveBeenCalledWith(ctx, "src1");
  });

  it("removes an entity that has NO remaining edge after its provenance chunk is purged (no other provenance)", async () => {
    listChunksForSourceMock.mockResolvedValue([{ id: "chunk1", generationId: "gen1" }]);
    listEdgesByProvenanceChunkIdsMock.mockResolvedValue([{ id: "edge1", srcEntityId: "e1", dstEntityId: "e2", provenanceChunkId: "chunk1" }]);
    listEdgesForEntityMock.mockResolvedValue([]); // neither e1 nor e2 has any OTHER edge left
    listEntitiesByIdsMock.mockResolvedValue([
      { id: "e1", communityId: "com1" },
      { id: "e2", communityId: null },
    ]);
    listEntitiesForCommunityMock.mockResolvedValue([{ id: "e-other", aclTags: ["tag-other"] }]); // com1 still has other members

    const { purgeSourceContent } = await import("./retention-service.js");
    const result = await purgeSourceContent(ctx, "src1");

    expect(result.edgesDeleted).toBe(1);
    expect(result.entitiesDeleted).toBe(2);
    expect(deleteEntitiesByIdsMock).toHaveBeenCalledWith(ctx, expect.arrayContaining(["e1", "e2"]));
    expect(deleteNodesMock).toHaveBeenCalledWith({ tenantId: "t1", generationId: "G_abc" }, expect.arrayContaining(["e1", "e2"]));
    // com1 lost a member but still has one left -> marked stale, never deleted.
    expect(markCommunitiesStaleMock).toHaveBeenCalledWith(ctx, ["com1"]);
    expect(deleteCommunitiesByIdsMock).not.toHaveBeenCalled();
    // The community's own denormalized acl_tags is recomputed from its SURVIVING
    // members only — a purged entity's grant must not stay baked in forever.
    expect(updateCommunityAclTagsMock).toHaveBeenCalledWith(ctx, "com1", ["tag-other"]);
    expect(enqueueJobMock).toHaveBeenCalledWith(ctx, { generationId: "gen1", stage: "CommunitySummaries", input: {} });
  });

  it("preserves an entity that STILL has another edge from a different source (real 'no other provenance' check, not assumed)", async () => {
    listChunksForSourceMock.mockResolvedValue([{ id: "chunk1", generationId: "gen1" }]);
    listEdgesByProvenanceChunkIdsMock.mockResolvedValue([{ id: "edge1", srcEntityId: "e1", dstEntityId: "e2", provenanceChunkId: "chunk1" }]);
    // e1 still has a real remaining edge (from another source's chunk) — must survive.
    listEdgesForEntityMock.mockImplementation(async (_ctx: unknown, _genId: string, entityId: string) => (entityId === "e1" ? [{ id: "edge-other" }] : []));
    listEntitiesByIdsMock.mockResolvedValue([{ id: "e2", communityId: null }]);

    const { purgeSourceContent } = await import("./retention-service.js");
    const result = await purgeSourceContent(ctx, "src1");

    expect(result.entitiesDeleted).toBe(1);
    expect(deleteEntitiesByIdsMock).toHaveBeenCalledWith(ctx, ["e2"]); // e1 is NEVER included
  });

  it("deletes a community outright when its membership drops to zero, rather than marking it stale for re-summarization", async () => {
    listChunksForSourceMock.mockResolvedValue([{ id: "chunk1", generationId: "gen1" }]);
    listEdgesByProvenanceChunkIdsMock.mockResolvedValue([{ id: "edge1", srcEntityId: "e1", dstEntityId: "e2", provenanceChunkId: "chunk1" }]);
    listEdgesForEntityMock.mockResolvedValue([]);
    listEntitiesByIdsMock.mockResolvedValue([{ id: "e1", communityId: "com1" }, { id: "e2", communityId: "com1" }]);
    listEntitiesForCommunityMock.mockResolvedValue([]); // com1 has zero members left

    const { purgeSourceContent } = await import("./retention-service.js");
    const result = await purgeSourceContent(ctx, "src1");

    expect(result.communitiesDeleted).toBe(1);
    expect(result.communitiesMarkedStaleForResummarization).toBe(0);
    expect(deleteCommunitiesByIdsMock).toHaveBeenCalledWith(ctx, ["com1"]);
    expect(markCommunitiesStaleMock).not.toHaveBeenCalled();
    expect(enqueueJobMock).not.toHaveBeenCalled(); // nothing to re-summarize
  });
});

describe("sweepKnowledgeRetention (scheduled worker sweep)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never purges a collection with no configured retention_days", async () => {
    listActiveTenantContextsMock.mockResolvedValue([ctx]);
    listCollectionsMock.mockResolvedValue([{ id: "col1", retentionDays: null }]);
    const { sweepKnowledgeRetention } = await import("./retention-service.js");
    const result = await sweepKnowledgeRetention();
    expect(result.sourcesPurged).toBe(0);
    expect(listSourcesForCollectionMock).not.toHaveBeenCalled();
  });

  it("never purges a collection configured as Indefinite (-1)", async () => {
    listActiveTenantContextsMock.mockResolvedValue([ctx]);
    listCollectionsMock.mockResolvedValue([{ id: "col1", retentionDays: -1 }]);
    computePurgeCutoffMock.mockReturnValue(null);
    const { sweepKnowledgeRetention } = await import("./retention-service.js");
    const result = await sweepKnowledgeRetention();
    expect(result.sourcesPurged).toBe(0);
  });

  it("purges a source aged past its collection's configured retention cutoff", async () => {
    listActiveTenantContextsMock.mockResolvedValue([ctx]);
    listCollectionsMock.mockResolvedValue([{ id: "col1", retentionDays: 30 }]);
    computePurgeCutoffMock.mockReturnValue(new Date("2020-06-01"));
    listSourcesForCollectionMock.mockResolvedValue([{ id: "src-old", purgedAt: null, createdAt: new Date("2020-01-01") }]);
    listChunksForSourceMock.mockResolvedValue([]);

    const { sweepKnowledgeRetention } = await import("./retention-service.js");
    const result = await sweepKnowledgeRetention();

    expect(result.sourcesPurged).toBe(1);
    expect(getSourceOrThrowMock).toHaveBeenCalledWith(ctx, "src-old");
  });

  it("skips a source that is not yet aged past the cutoff", async () => {
    listActiveTenantContextsMock.mockResolvedValue([ctx]);
    listCollectionsMock.mockResolvedValue([{ id: "col1", retentionDays: 30 }]);
    computePurgeCutoffMock.mockReturnValue(new Date("2020-06-01"));
    listSourcesForCollectionMock.mockResolvedValue([{ id: "src-recent", purgedAt: null, createdAt: new Date("2020-12-01") }]);

    const { sweepKnowledgeRetention } = await import("./retention-service.js");
    const result = await sweepKnowledgeRetention();
    expect(result.sourcesPurged).toBe(0);
    expect(getSourceOrThrowMock).not.toHaveBeenCalled();
  });

  it("skips a source that is already purged, and isolates one tenant's failure from the rest of the sweep", async () => {
    const ctx2 = { tenantId: "t2", region: "US" as const, environment: "Sandbox" as const };
    listActiveTenantContextsMock.mockResolvedValue([ctx, ctx2]);
    listCollectionsMock.mockImplementation(async (c: { tenantId: string }) => {
      if (c.tenantId === "t1") throw new Error("transient DB error");
      return [{ id: "col2", retentionDays: 30 }];
    });
    computePurgeCutoffMock.mockReturnValue(new Date("2020-06-01"));
    listSourcesForCollectionMock.mockResolvedValue([{ id: "src-already-purged", purgedAt: new Date(), createdAt: new Date("2020-01-01") }]);

    const { sweepKnowledgeRetention } = await import("./retention-service.js");
    const result = await sweepKnowledgeRetention();
    expect(result.tenantsChecked).toBe(2);
    expect(result.sourcesPurged).toBe(0); // t1 failed (isolated), t2's only source was already purged
  });
});
