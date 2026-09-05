import { describe, expect, it, vi, beforeEach } from "vitest";

const createCollectionMock = vi.fn();
const listCollectionsMock = vi.fn();
const getCollectionOrThrowMock = vi.fn();
const updateCollectionMock = vi.fn();
const updateCollectionConfigurationMock = vi.fn();
const softDeleteCollectionMock = vi.fn();

vi.mock("../application/collection-service.js", () => ({
  createCollection: (...a: unknown[]) => createCollectionMock(...a),
  listCollections: (...a: unknown[]) => listCollectionsMock(...a),
  getCollectionOrThrow: (...a: unknown[]) => getCollectionOrThrowMock(...a),
  updateCollection: (...a: unknown[]) => updateCollectionMock(...a),
  updateCollectionConfiguration: (...a: unknown[]) => updateCollectionConfigurationMock(...a),
  softDeleteCollection: (...a: unknown[]) => softDeleteCollectionMock(...a),
}));

const createSourceMock = vi.fn();
const listSourcesForCollectionMock = vi.fn();
const getSourceOrThrowMock = vi.fn();
const deleteSourceMock = vi.fn();
const triggerSourceSyncMock = vi.fn();
const storeUploadAndBuildLocatorMock = vi.fn();

vi.mock("../application/source-service.js", () => ({
  createSource: (...a: unknown[]) => createSourceMock(...a),
  listSourcesForCollection: (...a: unknown[]) => listSourcesForCollectionMock(...a),
  getSourceOrThrow: (...a: unknown[]) => getSourceOrThrowMock(...a),
  deleteSource: (...a: unknown[]) => deleteSourceMock(...a),
  triggerSourceSync: (...a: unknown[]) => triggerSourceSyncMock(...a),
  storeUploadAndBuildLocator: (...a: unknown[]) => storeUploadAndBuildLocatorMock(...a),
}));

const buildGenerationMock = vi.fn();
const listGenerationsForCollectionMock = vi.fn();
const getGenerationOrThrowMock = vi.fn();
const cancelGenerationMock = vi.fn();

vi.mock("../application/generation-service.js", () => ({
  buildGeneration: (...a: unknown[]) => buildGenerationMock(...a),
  listGenerationsForCollection: (...a: unknown[]) => listGenerationsForCollectionMock(...a),
  getGenerationOrThrow: (...a: unknown[]) => getGenerationOrThrowMock(...a),
  cancelGeneration: (...a: unknown[]) => cancelGenerationMock(...a),
}));

const listGraphEntitiesMock = vi.fn();
const getGraphEntityDetailMock = vi.fn();
const listGraphCommunitiesMock = vi.fn();
const getGraphCommunityDetailMock = vi.fn();
const getChunkDetailMock = vi.fn();

vi.mock("../application/graph-explorer-service.js", () => ({
  listGraphEntities: (...a: unknown[]) => listGraphEntitiesMock(...a),
  getGraphEntityDetail: (...a: unknown[]) => getGraphEntityDetailMock(...a),
  listGraphCommunities: (...a: unknown[]) => listGraphCommunitiesMock(...a),
  getGraphCommunityDetail: (...a: unknown[]) => getGraphCommunityDetailMock(...a),
  getChunkDetail: (...a: unknown[]) => getChunkDetailMock(...a),
}));

const runRetrievalPlaygroundMock = vi.fn();

// Target Architecture Blueprint Phase 9 (BL-40) — mocked exactly like every other
// application-layer module above, so this pure unit-test file never pulls in the
// real `@nextbot/model-gateway`/`@nextbot/graph-store` module graph the playground
// service's strategies depend on (that heavier chain is exercised for real by
// `retrieval-playground.int.test.ts` against real Postgres/Neo4j instead).
vi.mock("../application/retrieval/playground-service.js", () => ({
  runRetrievalPlayground: (...a: unknown[]) => runRetrievalPlaygroundMock(...a),
}));

const getCollectionFreshnessMock = vi.fn();
vi.mock("../application/freshness-service.js", () => ({
  getCollectionFreshness: (...a: unknown[]) => getCollectionFreshnessMock(...a),
}));

const getCoverageReportMock = vi.fn();
vi.mock("../application/coverage-service.js", () => ({
  getCoverageReport: (...a: unknown[]) => getCoverageReportMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

/** Unit coverage for the thin `http/` pass-through layer (LLD §2.2) — every
 *  `handle*` here is a one-line delegation; these tests assert the delegation
 *  itself (correct target, correct argument order/shape) rather than re-testing
 *  the application layer's own logic (already covered by the real-Postgres/
 *  real-Neo4j integration suites). */
describe("knowledge http/admin-routes (unit, mocked application layer)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handleListCollections delegates to listCollections", async () => {
    listCollectionsMock.mockResolvedValue([{ id: "c1" }]);
    const { handleListCollections } = await import("./admin-routes.js");
    expect(await handleListCollections(ctx)).toEqual([{ id: "c1" }]);
    expect(listCollectionsMock).toHaveBeenCalledWith(ctx);
  });

  it("handleCreateCollection delegates to createCollection", async () => {
    createCollectionMock.mockResolvedValue({ id: "c1" });
    const { handleCreateCollection } = await import("./admin-routes.js");
    const body = { name: "x" } as never;
    expect(await handleCreateCollection(ctx, body)).toEqual({ id: "c1" });
    expect(createCollectionMock).toHaveBeenCalledWith(ctx, body);
  });

  it("handleGetCollection delegates to getCollectionOrThrow", async () => {
    getCollectionOrThrowMock.mockResolvedValue({ id: "c1" });
    const { handleGetCollection } = await import("./admin-routes.js");
    expect(await handleGetCollection(ctx, "c1")).toEqual({ id: "c1" });
    expect(getCollectionOrThrowMock).toHaveBeenCalledWith(ctx, "c1");
  });

  it("handleUpdateCollection delegates to updateCollection", async () => {
    updateCollectionMock.mockResolvedValue({ id: "c1", name: "y" });
    const { handleUpdateCollection } = await import("./admin-routes.js");
    const body = { name: "y" };
    expect(await handleUpdateCollection(ctx, "c1", body)).toEqual({ id: "c1", name: "y" });
    expect(updateCollectionMock).toHaveBeenCalledWith(ctx, "c1", body);
  });

  it("handleUpdateCollectionConfig delegates to updateCollectionConfiguration", async () => {
    updateCollectionConfigurationMock.mockResolvedValue({ id: "c1" });
    const { handleUpdateCollectionConfig } = await import("./admin-routes.js");
    const body = { embeddingRouteKey: "embed.v2" };
    expect(await handleUpdateCollectionConfig(ctx, "c1", body)).toEqual({ id: "c1" });
    expect(updateCollectionConfigurationMock).toHaveBeenCalledWith(ctx, "c1", body);
  });

  it("handleDeleteCollection delegates to softDeleteCollection and reports deleted:true", async () => {
    const { handleDeleteCollection } = await import("./admin-routes.js");
    expect(await handleDeleteCollection(ctx, "c1")).toEqual({ deleted: true });
    expect(softDeleteCollectionMock).toHaveBeenCalledWith(ctx, "c1");
  });

  it("handleListSources delegates to listSourcesForCollection", async () => {
    listSourcesForCollectionMock.mockResolvedValue([{ id: "s1" }]);
    const { handleListSources } = await import("./admin-routes.js");
    expect(await handleListSources(ctx, "c1")).toEqual([{ id: "s1" }]);
    expect(listSourcesForCollectionMock).toHaveBeenCalledWith(ctx, "c1");
  });

  it("handleCreateSource delegates to createSource", async () => {
    createSourceMock.mockResolvedValue({ id: "s1" });
    const { handleCreateSource } = await import("./admin-routes.js");
    const body = { collectionId: "c1", kind: "Upload" } as never;
    expect(await handleCreateSource(ctx, body)).toEqual({ id: "s1" });
    expect(createSourceMock).toHaveBeenCalledWith(ctx, body);
  });

  it("handleUploadFile delegates to storeUploadAndBuildLocator", async () => {
    storeUploadAndBuildLocatorMock.mockResolvedValue({ kind: "Upload", storageRef: "r1" });
    const { handleUploadFile } = await import("./admin-routes.js");
    expect(await handleUploadFile(ctx, "f.txt", "text/plain", "content")).toEqual({ kind: "Upload", storageRef: "r1" });
    expect(storeUploadAndBuildLocatorMock).toHaveBeenCalledWith(ctx, "f.txt", "text/plain", "content");
  });

  it("handleGetSource delegates to getSourceOrThrow", async () => {
    getSourceOrThrowMock.mockResolvedValue({ id: "s1" });
    const { handleGetSource } = await import("./admin-routes.js");
    expect(await handleGetSource(ctx, "s1")).toEqual({ id: "s1" });
    expect(getSourceOrThrowMock).toHaveBeenCalledWith(ctx, "s1");
  });

  it("handleDeleteSource delegates to deleteSource and reports deleted:true", async () => {
    const { handleDeleteSource } = await import("./admin-routes.js");
    expect(await handleDeleteSource(ctx, "s1")).toEqual({ deleted: true });
    expect(deleteSourceMock).toHaveBeenCalledWith(ctx, "s1");
  });

  it("handleSyncSource delegates to triggerSourceSync", async () => {
    triggerSourceSyncMock.mockResolvedValue({ enqueued: true });
    const { handleSyncSource } = await import("./admin-routes.js");
    expect(await handleSyncSource(ctx, "s1")).toEqual({ enqueued: true });
    expect(triggerSourceSyncMock).toHaveBeenCalledWith(ctx, "s1");
  });

  it("handleGetSourceFailures reports the source's own failures array (empty when null)", async () => {
    getSourceOrThrowMock.mockResolvedValue({ id: "s1", failures: null });
    const { handleGetSourceFailures } = await import("./admin-routes.js");
    expect(await handleGetSourceFailures(ctx, "s1")).toEqual({ failures: [] });
  });

  it("handleListGenerations delegates to listGenerationsForCollection", async () => {
    listGenerationsForCollectionMock.mockResolvedValue([{ id: "g1" }]);
    const { handleListGenerations } = await import("./admin-routes.js");
    expect(await handleListGenerations(ctx, "c1")).toEqual([{ id: "g1" }]);
    expect(listGenerationsForCollectionMock).toHaveBeenCalledWith(ctx, "c1");
  });

  it("handleBuildGeneration delegates to buildGeneration", async () => {
    buildGenerationMock.mockResolvedValue({ id: "g1" });
    const { handleBuildGeneration } = await import("./admin-routes.js");
    const body = { confirmReEmbed: true };
    expect(await handleBuildGeneration(ctx, "c1", body)).toEqual({ id: "g1" });
    expect(buildGenerationMock).toHaveBeenCalledWith(ctx, "c1", body);
  });

  it("handleGetGenerationProgress reports the generation's own progress fields", async () => {
    getGenerationOrThrowMock.mockResolvedValue({ status: "Building", stageProgress: {}, chunkCount: 1, entityCount: 2, edgeCount: 3, communityCount: 4 });
    const { handleGetGenerationProgress } = await import("./admin-routes.js");
    expect(await handleGetGenerationProgress(ctx, "g1")).toEqual({ status: "Building", stageProgress: {}, chunkCount: 1, entityCount: 2, edgeCount: 3, communityCount: 4 });
  });

  it("handleCancelGeneration delegates to cancelGeneration and reports cancelled:true", async () => {
    const { handleCancelGeneration } = await import("./admin-routes.js");
    expect(await handleCancelGeneration(ctx, "g1")).toEqual({ cancelled: true });
    expect(cancelGenerationMock).toHaveBeenCalledWith(ctx, "g1");
  });

  it("handleListGraphEntities delegates to listGraphEntities", async () => {
    listGraphEntitiesMock.mockResolvedValue({ entities: [{ id: "e1" }], nextCursor: null });
    const { handleListGraphEntities } = await import("./admin-routes.js");
    const query = { q: "acme", limit: 50 };
    expect(await handleListGraphEntities(ctx, "gen1", query)).toEqual({ entities: [{ id: "e1" }], nextCursor: null });
    expect(listGraphEntitiesMock).toHaveBeenCalledWith(ctx, "gen1", query);
  });

  it("handleGetGraphEntity delegates to getGraphEntityDetail", async () => {
    getGraphEntityDetailMock.mockResolvedValue({ entity: { id: "e1" }, relations: [] });
    const { handleGetGraphEntity } = await import("./admin-routes.js");
    expect(await handleGetGraphEntity(ctx, "gen1", "e1")).toEqual({ entity: { id: "e1" }, relations: [] });
    expect(getGraphEntityDetailMock).toHaveBeenCalledWith(ctx, "gen1", "e1");
  });

  it("handleListGraphCommunities delegates to listGraphCommunities", async () => {
    listGraphCommunitiesMock.mockResolvedValue([{ id: "c1" }]);
    const { handleListGraphCommunities } = await import("./admin-routes.js");
    expect(await handleListGraphCommunities(ctx, "gen1", 0)).toEqual([{ id: "c1" }]);
    expect(listGraphCommunitiesMock).toHaveBeenCalledWith(ctx, "gen1", 0);
  });

  it("handleGetGraphCommunity delegates to getGraphCommunityDetail", async () => {
    getGraphCommunityDetailMock.mockResolvedValue({ community: { id: "c1" }, members: [] });
    const { handleGetGraphCommunity } = await import("./admin-routes.js");
    expect(await handleGetGraphCommunity(ctx, "gen1", "c1")).toEqual({ community: { id: "c1" }, members: [] });
    expect(getGraphCommunityDetailMock).toHaveBeenCalledWith(ctx, "gen1", "c1");
  });

  it("handleGetChunk delegates to getChunkDetail", async () => {
    getChunkDetailMock.mockResolvedValue({ id: "chunk1", text: "The sentence that produced the edge." });
    const { handleGetChunk } = await import("./admin-routes.js");
    expect(await handleGetChunk(ctx, "chunk1")).toEqual({ id: "chunk1", text: "The sentence that produced the edge." });
    expect(getChunkDetailMock).toHaveBeenCalledWith(ctx, "chunk1");
  });

  it("handleRunRetrievalPlayground delegates to runRetrievalPlayground", async () => {
    const body = { query: "does acme partner with globex?", strategies: ["Vector", "GraphLocal"] as ("Vector" | "GraphLocal")[] };
    runRetrievalPlaygroundMock.mockResolvedValue({ query: body.query, collectionId: "c1", generationId: "g1", results: [] });
    const { handleRunRetrievalPlayground } = await import("./admin-routes.js");
    expect(await handleRunRetrievalPlayground(ctx, "c1", body)).toEqual({ query: body.query, collectionId: "c1", generationId: "g1", results: [] });
    expect(runRetrievalPlaygroundMock).toHaveBeenCalledWith(ctx, "c1", body);
  });

  it("handleGetCollectionFreshness delegates to getCollectionFreshness", async () => {
    getCollectionFreshnessMock.mockResolvedValue({ status: "Fresh", ageHours: 1, maxStalenessHours: 24, builtAt: "2026-08-01T00:00:00.000Z" });
    const { handleGetCollectionFreshness } = await import("./admin-routes.js");
    expect(await handleGetCollectionFreshness(ctx, "c1")).toEqual({ status: "Fresh", ageHours: 1, maxStalenessHours: 24, builtAt: "2026-08-01T00:00:00.000Z" });
    expect(getCollectionFreshnessMock).toHaveBeenCalledWith(ctx, "c1");
  });

  it("handleGetCoverageReport delegates to getCoverageReport", async () => {
    const query = { sinceDays: 7, limit: 10 };
    getCoverageReportMock.mockResolvedValue({ collectionId: "c1", minRelevanceScore: 0.35, sinceDate: "2026-08-01T00:00:00.000Z", items: [] });
    const { handleGetCoverageReport } = await import("./admin-routes.js");
    expect(await handleGetCoverageReport(ctx, "c1", query)).toEqual({ collectionId: "c1", minRelevanceScore: 0.35, sinceDate: "2026-08-01T00:00:00.000Z", items: [] });
    expect(getCoverageReportMock).toHaveBeenCalledWith(ctx, "c1", query);
  });
});
