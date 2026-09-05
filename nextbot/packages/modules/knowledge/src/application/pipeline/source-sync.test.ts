import { describe, expect, it, vi, beforeEach } from "vitest";

const listActiveTenantContextsMock = vi.fn();
vi.mock("@nextbot/tenancy", () => ({
  listActiveTenantContexts: (...a: unknown[]) => listActiveTenantContextsMock(...a),
}));

const listSourcesDueForSyncMock = vi.fn();
vi.mock("../../infrastructure/source-repository.js", () => ({
  listSourcesDueForSync: (...a: unknown[]) => listSourcesDueForSyncMock(...a),
}));

const getCollectionOrThrowMock = vi.fn();
vi.mock("../../infrastructure/collection-repository.js", () => ({
  getCollectionOrThrow: (...a: unknown[]) => getCollectionOrThrowMock(...a),
}));

const getCurrentReadyGenerationForCollectionMock = vi.fn();
vi.mock("../../infrastructure/generation-repository.js", () => ({
  getCurrentReadyGenerationForCollection: (...a: unknown[]) => getCurrentReadyGenerationForCollectionMock(...a),
}));

const enqueueJobMock = vi.fn();
vi.mock("../../infrastructure/ingestion-job-repository.js", () => ({
  enqueueJob: (...a: unknown[]) => enqueueJobMock(...a),
}));

const tenantA = { tenantId: "a", region: "US" as const, environment: "Sandbox" as const };

describe("syncDueSources (knowledge.source-sync sweep, LLD §14.4.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports zero tenants/enqueued when no tenant has a due source", async () => {
    listActiveTenantContextsMock.mockResolvedValue([tenantA]);
    listSourcesDueForSyncMock.mockResolvedValue([]);
    const { syncDueSources } = await import("./source-sync.js");
    expect(await syncDueSources()).toEqual({ tenantsChecked: 1, enqueued: 0 });
  });

  it("skips a due source whose collection has no current_generation_id at all (never built)", async () => {
    listActiveTenantContextsMock.mockResolvedValue([tenantA]);
    listSourcesDueForSyncMock.mockResolvedValue([{ id: "s1", collectionId: "c1" }]);
    getCollectionOrThrowMock.mockResolvedValue({ id: "c1", currentGenerationId: null });
    const { syncDueSources } = await import("./source-sync.js");
    expect(await syncDueSources()).toEqual({ tenantsChecked: 1, enqueued: 0 });
    expect(getCurrentReadyGenerationForCollectionMock).not.toHaveBeenCalled();
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  it("skips a due source whose collection has a current_generation_id but it isn't Ready right now (transient Building state)", async () => {
    listActiveTenantContextsMock.mockResolvedValue([tenantA]);
    listSourcesDueForSyncMock.mockResolvedValue([{ id: "s1", collectionId: "c1" }]);
    getCollectionOrThrowMock.mockResolvedValue({ id: "c1", currentGenerationId: "g0" });
    getCurrentReadyGenerationForCollectionMock.mockResolvedValue(null);
    const { syncDueSources } = await import("./source-sync.js");
    expect(await syncDueSources()).toEqual({ tenantsChecked: 1, enqueued: 0 });
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  it("enqueues a real Ingest job for a due source whose collection has a Ready generation", async () => {
    listActiveTenantContextsMock.mockResolvedValue([tenantA]);
    listSourcesDueForSyncMock.mockResolvedValue([{ id: "s1", collectionId: "c1" }]);
    getCollectionOrThrowMock.mockResolvedValue({ id: "c1", currentGenerationId: "g1" });
    getCurrentReadyGenerationForCollectionMock.mockResolvedValue({ id: "g1" });
    enqueueJobMock.mockResolvedValue({ id: "job1" });
    const { syncDueSources } = await import("./source-sync.js");
    expect(await syncDueSources()).toEqual({ tenantsChecked: 1, enqueued: 1 });
    expect(enqueueJobMock).toHaveBeenCalledWith(tenantA, { generationId: "g1", sourceId: "s1", stage: "Ingest", input: {} });
  });

  it("does not count a duplicate (idempotency-key collision) enqueue attempt", async () => {
    listActiveTenantContextsMock.mockResolvedValue([tenantA]);
    listSourcesDueForSyncMock.mockResolvedValue([{ id: "s1", collectionId: "c1" }]);
    getCollectionOrThrowMock.mockResolvedValue({ id: "c1", currentGenerationId: "g1" });
    getCurrentReadyGenerationForCollectionMock.mockResolvedValue({ id: "g1" });
    enqueueJobMock.mockResolvedValue(null);
    const { syncDueSources } = await import("./source-sync.js");
    expect(await syncDueSources()).toEqual({ tenantsChecked: 1, enqueued: 0 });
  });
});
