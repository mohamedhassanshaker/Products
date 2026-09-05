import { describe, expect, it, vi, beforeEach } from "vitest";
import { GraphCommunityNotFoundError, GraphEntityNotFoundError } from "@nextbot/contracts";

const getGenerationOrThrowMock = vi.fn();
vi.mock("../infrastructure/generation-repository.js", () => ({
  getGenerationOrThrow: (...a: unknown[]) => getGenerationOrThrowMock(...a),
}));

const getSourceMock = vi.fn();
vi.mock("../infrastructure/source-repository.js", () => ({
  getSource: (...a: unknown[]) => getSourceMock(...a),
}));

const getDocumentMock = vi.fn();
const getChunkOrThrowMock = vi.fn();
const listChunksByIdsMock = vi.fn();
vi.mock("../infrastructure/document-chunk-repository.js", () => ({
  getDocument: (...a: unknown[]) => getDocumentMock(...a),
  getChunkOrThrow: (...a: unknown[]) => getChunkOrThrowMock(...a),
  listChunksByIds: (...a: unknown[]) => listChunksByIdsMock(...a),
}));

const getEntityOrThrowMock = vi.fn();
const listEntitiesByIdsMock = vi.fn();
const listEntitiesForGenerationPageMock = vi.fn();
const listEdgesForEntityMock = vi.fn();
const listCommunitiesForGenerationMock = vi.fn();
const listCommunitiesByIdsMock = vi.fn();
const getCommunityOrThrowMock = vi.fn();
const listEntitiesForCommunityMock = vi.fn();
vi.mock("../infrastructure/graph-repository.js", () => ({
  getEntityOrThrow: (...a: unknown[]) => getEntityOrThrowMock(...a),
  listEntitiesByIds: (...a: unknown[]) => listEntitiesByIdsMock(...a),
  listEntitiesForGenerationPage: (...a: unknown[]) => listEntitiesForGenerationPageMock(...a),
  listEdgesForEntity: (...a: unknown[]) => listEdgesForEntityMock(...a),
  listCommunitiesForGeneration: (...a: unknown[]) => listCommunitiesForGenerationMock(...a),
  listCommunitiesByIds: (...a: unknown[]) => listCommunitiesByIdsMock(...a),
  getCommunityOrThrow: (...a: unknown[]) => getCommunityOrThrowMock(...a),
  listEntitiesForCommunity: (...a: unknown[]) => listEntitiesForCommunityMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

function entityRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "e1",
    tenantId: "t1",
    generationId: "gen1",
    canonicalName: "acme corp",
    type: "Organization",
    aliases: [],
    summary: null,
    communityId: null,
    degree: 1,
    aclTags: [],
    mentionCount: 1,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("graph-explorer-service (Phase 8, FR-KB-04) — unit, mocked repositories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGenerationOrThrowMock.mockResolvedValue({ id: "gen1" });
    listCommunitiesByIdsMock.mockResolvedValue([]);
  });

  describe("listGraphEntities", () => {
    it("404s via getGenerationOrThrow before touching the entity table when the generation doesn't exist for this tenant", async () => {
      getGenerationOrThrowMock.mockRejectedValue(new Error("not found"));
      const { listGraphEntities } = await import("./graph-explorer-service.js");
      await expect(listGraphEntities(ctx, "missing-gen", { limit: 50 })).rejects.toThrow("not found");
      expect(listEntitiesForGenerationPageMock).not.toHaveBeenCalled();
    });

    it("clamps an out-of-range limit into [1, 200]", async () => {
      listEntitiesForGenerationPageMock.mockResolvedValue({ rows: [], hasMore: false });
      listCommunitiesByIdsMock.mockResolvedValue([]);
      const { listGraphEntities } = await import("./graph-explorer-service.js");

      await listGraphEntities(ctx, "gen1", { limit: 5000 });
      expect(listEntitiesForGenerationPageMock).toHaveBeenLastCalledWith(ctx, "gen1", expect.objectContaining({ limit: 200 }));

      await listGraphEntities(ctx, "gen1", { limit: -3 });
      expect(listEntitiesForGenerationPageMock).toHaveBeenLastCalledWith(ctx, "gen1", expect.objectContaining({ limit: 1 }));
    });

    it("joins each row's community title in one batched lookup, leaving communityId: null rows with communityTitle: null", async () => {
      listEntitiesForGenerationPageMock.mockResolvedValue({
        rows: [entityRow({ id: "e1", communityId: "com1" }), entityRow({ id: "e2", communityId: null })],
        hasMore: false,
      });
      listCommunitiesByIdsMock.mockResolvedValue([{ id: "com1", title: "Acme-Globex Partnership" }]);
      const { listGraphEntities } = await import("./graph-explorer-service.js");

      const result = await listGraphEntities(ctx, "gen1", { limit: 50 });
      expect(listCommunitiesByIdsMock).toHaveBeenCalledWith(ctx, ["com1"]);
      expect(result.entities).toEqual([
        expect.objectContaining({ id: "e1", communityId: "com1", communityTitle: "Acme-Globex Partnership" }),
        expect.objectContaining({ id: "e2", communityId: null, communityTitle: null }),
      ]);
    });

    it("defaults communityTitle to null when a row's communityId doesn't resolve in the batched lookup (defensive — shouldn't happen given the FK, but never silently mislabels)", async () => {
      listEntitiesForGenerationPageMock.mockResolvedValue({ rows: [entityRow({ id: "e1", communityId: "com-missing" })], hasMore: false });
      listCommunitiesByIdsMock.mockResolvedValue([]); // the community row can't be resolved
      const { listGraphEntities } = await import("./graph-explorer-service.js");
      const result = await listGraphEntities(ctx, "gen1", { limit: 50 });
      expect(result.entities[0]!.communityTitle).toBeNull();
    });

    it("defaults limit to 50 when omitted entirely", async () => {
      listEntitiesForGenerationPageMock.mockResolvedValue({ rows: [], hasMore: false });
      const { listGraphEntities } = await import("./graph-explorer-service.js");
      await listGraphEntities(ctx, "gen1", {});
      expect(listEntitiesForGenerationPageMock).toHaveBeenCalledWith(ctx, "gen1", expect.objectContaining({ limit: 50 }));
    });

    it("mints a nextCursor only when the repository reports hasMore, and passes a decoded cursor through on the next call", async () => {
      listEntitiesForGenerationPageMock.mockResolvedValueOnce({ rows: [entityRow({ id: "e1", degree: 7 })], hasMore: true });
      listCommunitiesByIdsMock.mockResolvedValue([]);
      const { listGraphEntities } = await import("./graph-explorer-service.js");

      const page1 = await listGraphEntities(ctx, "gen1", { limit: 1 });
      expect(page1.nextCursor).not.toBeNull();

      listEntitiesForGenerationPageMock.mockResolvedValueOnce({ rows: [], hasMore: false });
      await listGraphEntities(ctx, "gen1", { limit: 1, cursor: page1.nextCursor! });
      expect(listEntitiesForGenerationPageMock).toHaveBeenLastCalledWith(ctx, "gen1", expect.objectContaining({ cursor: { degree: 7, id: "e1" } }));
    });

    it("treats a malformed/tampered cursor as no cursor (fails open to page 1) rather than throwing", async () => {
      listEntitiesForGenerationPageMock.mockResolvedValue({ rows: [], hasMore: false });
      const { listGraphEntities } = await import("./graph-explorer-service.js");
      await listGraphEntities(ctx, "gen1", { limit: 50, cursor: "not-valid-base64url-json!!" });
      expect(listEntitiesForGenerationPageMock).toHaveBeenCalledWith(ctx, "gen1", expect.objectContaining({ cursor: undefined }));
    });

    it("forwards q/type/communityId/minDegree filters unchanged", async () => {
      listEntitiesForGenerationPageMock.mockResolvedValue({ rows: [], hasMore: false });
      const { listGraphEntities } = await import("./graph-explorer-service.js");
      await listGraphEntities(ctx, "gen1", { q: "acme", type: "Organization", communityId: "com1", minDegree: 3, limit: 50 });
      expect(listEntitiesForGenerationPageMock).toHaveBeenCalledWith(
        ctx,
        "gen1",
        expect.objectContaining({ q: "acme", type: "Organization", communityId: "com1", minDegree: 3 }),
      );
    });
  });

  describe("getGraphEntityDetail", () => {
    it("404s (GraphEntityNotFoundError) when the entity exists but belongs to a DIFFERENT generation than the one in the URL", async () => {
      getEntityOrThrowMock.mockResolvedValue(entityRow({ generationId: "some-other-generation" }));
      const { getGraphEntityDetail } = await import("./graph-explorer-service.js");
      await expect(getGraphEntityDetail(ctx, "gen1", "e1")).rejects.toThrow(GraphEntityNotFoundError);
      expect(listEdgesForEntityMock).not.toHaveBeenCalled();
    });

    it("tags each edge's direction relative to the requested entity and resolves the other side's name/type", async () => {
      getEntityOrThrowMock.mockResolvedValue(entityRow({ id: "e1", generationId: "gen1", communityId: null }));
      listEdgesForEntityMock.mockResolvedValue([
        { id: "edge-out", srcEntityId: "e1", dstEntityId: "e2", relation: "PARTNERED_WITH", weight: 1, confidence: 0.9, provenanceChunkId: "chunk1", provenanceSpan: null },
        { id: "edge-in", srcEntityId: "e3", dstEntityId: "e1", relation: "MENTIONS", weight: 1, confidence: 0.8, provenanceChunkId: "chunk2", provenanceSpan: { charStart: 0, charEnd: 5 } },
      ]);
      listEntitiesByIdsMock.mockResolvedValue([
        { id: "e2", canonicalName: "globex corporation", type: "Organization" },
        { id: "e3", canonicalName: "springfield", type: "Location" },
      ]);
      listChunksByIdsMock.mockResolvedValue([
        { id: "chunk1", provenance: { documentTitle: "Acme doc", page: 1, section: "Intro", blockIndex: 0, charStart: 0, charEnd: 50 } },
        { id: "chunk2", provenance: { documentTitle: "Acme doc", blockIndex: 1, charStart: 0, charEnd: 10 } },
      ]);

      const { getGraphEntityDetail } = await import("./graph-explorer-service.js");
      const result = await getGraphEntityDetail(ctx, "gen1", "e1");

      const outgoing = result.relations.find((r) => r.edgeId === "edge-out")!;
      expect(outgoing.direction).toBe("outgoing");
      expect(outgoing.otherEntity).toEqual({ id: "e2", canonicalName: "globex corporation", type: "Organization" });
      expect(outgoing.provenance).toEqual({ chunkId: "chunk1", documentTitle: "Acme doc", page: 1, section: "Intro", blockIndex: 0, span: null });

      const incoming = result.relations.find((r) => r.edgeId === "edge-in")!;
      expect(incoming.direction).toBe("incoming");
      expect(incoming.otherEntity).toEqual({ id: "e3", canonicalName: "springfield", type: "Location" });
      expect(incoming.provenance.span).toEqual({ charStart: 0, charEnd: 5 });
    });

    it("degrades to a labelled placeholder rather than throwing when the 'other side' entity can't be resolved (structurally shouldn't happen, but never hidden)", async () => {
      getEntityOrThrowMock.mockResolvedValue(entityRow({ id: "e1", generationId: "gen1" }));
      listEdgesForEntityMock.mockResolvedValue([{ id: "edge1", srcEntityId: "e1", dstEntityId: "missing", relation: "X", weight: 1, confidence: 0.5, provenanceChunkId: "chunk1", provenanceSpan: null }]);
      listEntitiesByIdsMock.mockResolvedValue([]);
      listChunksByIdsMock.mockResolvedValue([]);

      const { getGraphEntityDetail } = await import("./graph-explorer-service.js");
      const result = await getGraphEntityDetail(ctx, "gen1", "e1");
      expect(result.relations[0]!.otherEntity).toEqual({ id: "missing", canonicalName: "(entity not found)", type: "Unknown" });
      // A missing chunk row degrades every provenance field to a safe default rather than throwing.
      expect(result.relations[0]!.provenance).toEqual({ chunkId: "chunk1", documentTitle: null, page: undefined, section: undefined, blockIndex: 0, span: null });
    });

    it("resolves the entity's own community title only when it has one", async () => {
      getEntityOrThrowMock.mockResolvedValue(entityRow({ id: "e1", generationId: "gen1", communityId: "com1" }));
      listEdgesForEntityMock.mockResolvedValue([]);
      listEntitiesByIdsMock.mockResolvedValue([]);
      listChunksByIdsMock.mockResolvedValue([]);
      getCommunityOrThrowMock.mockResolvedValue({ id: "com1", title: "Acme-Globex Partnership" });

      const { getGraphEntityDetail } = await import("./graph-explorer-service.js");
      const result = await getGraphEntityDetail(ctx, "gen1", "e1");
      expect(result.entity.communityTitle).toBe("Acme-Globex Partnership");
      expect(getCommunityOrThrowMock).toHaveBeenCalledWith(ctx, "com1");
    });
  });

  describe("listGraphCommunities", () => {
    it("forwards the level filter through unchanged", async () => {
      listCommunitiesForGenerationMock.mockResolvedValue([]);
      const { listGraphCommunities } = await import("./graph-explorer-service.js");
      await listGraphCommunities(ctx, "gen1", 0);
      expect(listCommunitiesForGenerationMock).toHaveBeenCalledWith(ctx, "gen1", 0);
    });
  });

  describe("getGraphCommunityDetail", () => {
    it("404s (GraphCommunityNotFoundError) when the community exists but belongs to a DIFFERENT generation than the one in the URL", async () => {
      getCommunityOrThrowMock.mockResolvedValue({ id: "com1", generationId: "some-other-generation" });
      const { getGraphCommunityDetail } = await import("./graph-explorer-service.js");
      await expect(getGraphCommunityDetail(ctx, "gen1", "com1")).rejects.toThrow(GraphCommunityNotFoundError);
      expect(listEntitiesForCommunityMock).not.toHaveBeenCalled();
    });

    it("returns members stamped with the community's own title", async () => {
      getCommunityOrThrowMock.mockResolvedValue({ id: "com1", generationId: "gen1", title: "Acme-Globex Partnership", level: 0, summary: "s", summaryStale: false, entityCount: 2 });
      listEntitiesForCommunityMock.mockResolvedValue([entityRow({ id: "e1" }), entityRow({ id: "e2", canonicalName: "globex corporation" })]);
      const { getGraphCommunityDetail } = await import("./graph-explorer-service.js");
      const result = await getGraphCommunityDetail(ctx, "gen1", "com1");
      expect(result.members).toHaveLength(2);
      expect(result.members.every((m) => m.communityTitle === "Acme-Globex Partnership")).toBe(true);
    });
  });

  describe("getChunkDetail", () => {
    it("prefers the document row's own title, falling back to the chunk's denormalised provenance.documentTitle when the document can't be resolved", async () => {
      getChunkOrThrowMock.mockResolvedValue({ id: "chunk1", text: "Acme Corp signed a partnership agreement.", tokenCount: 8, provenance: { documentTitle: "Fallback Title", blockIndex: 0, charStart: 0, charEnd: 40 }, documentId: "doc1", sourceId: "src1", generationId: "gen1" });
      getDocumentMock.mockResolvedValue(null);
      getSourceMock.mockResolvedValue(null);
      const { getChunkDetail } = await import("./graph-explorer-service.js");
      const result = await getChunkDetail(ctx, "chunk1");
      expect(result.documentTitle).toBe("Fallback Title");
      expect(result.sourceName).toBe("(unknown source)");
      expect(result.text).toBe("Acme Corp signed a partnership agreement.");
    });

    it("prefers the real document/source rows when they resolve", async () => {
      getChunkOrThrowMock.mockResolvedValue({ id: "chunk1", text: "text", tokenCount: 1, provenance: { documentTitle: "Denormalised", blockIndex: 0, charStart: 0, charEnd: 4 }, documentId: "doc1", sourceId: "src1", generationId: "gen1" });
      getDocumentMock.mockResolvedValue({ id: "doc1", title: "Real Document Title" });
      getSourceMock.mockResolvedValue({ id: "src1", name: "Acme/Globex test document" });
      const { getChunkDetail } = await import("./graph-explorer-service.js");
      const result = await getChunkDetail(ctx, "chunk1");
      expect(result.documentTitle).toBe("Real Document Title");
      expect(result.sourceName).toBe("Acme/Globex test document");
    });
  });
});
