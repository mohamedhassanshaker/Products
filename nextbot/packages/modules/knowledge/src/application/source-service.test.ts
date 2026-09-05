import { describe, expect, it, vi, beforeEach } from "vitest";
import { KnowledgeSourceLocatorInvalidError } from "@nextbot/contracts";

const getCollectionOrThrowMock = vi.fn();
vi.mock("../infrastructure/collection-repository.js", () => ({
  getCollectionOrThrow: (...a: unknown[]) => getCollectionOrThrowMock(...a),
}));

const createSourceRowMock = vi.fn();
const listSourcesForCollectionMock = vi.fn();
const getSourceOrThrowMock = vi.fn();
const deleteSourceRowMock = vi.fn();
vi.mock("../infrastructure/source-repository.js", () => ({
  createSource: (...a: unknown[]) => createSourceRowMock(...a),
  listSourcesForCollection: (...a: unknown[]) => listSourcesForCollectionMock(...a),
  getSourceOrThrow: (...a: unknown[]) => getSourceOrThrowMock(...a),
  deleteSource: (...a: unknown[]) => deleteSourceRowMock(...a),
}));

const getCurrentReadyGenerationForCollectionMock = vi.fn();
vi.mock("../infrastructure/generation-repository.js", () => ({
  getCurrentReadyGenerationForCollection: (...a: unknown[]) => getCurrentReadyGenerationForCollectionMock(...a),
}));

const enqueueJobMock = vi.fn();
vi.mock("../infrastructure/ingestion-job-repository.js", () => ({
  enqueueJob: (...a: unknown[]) => enqueueJobMock(...a),
}));

const purgeSourceContentMock = vi.fn();
vi.mock("./retention-service.js", () => ({
  purgeSourceContent: (...a: unknown[]) => purgeSourceContentMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

describe("createSource (locator validation, FR-KB-02/§14.4.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCollectionOrThrowMock.mockResolvedValue({ id: "c1" });
    createSourceRowMock.mockResolvedValue({ id: "s1" });
  });

  it("accepts a well-formed Upload locator", async () => {
    const { createSource } = await import("./source-service.js");
    await createSource(ctx, {
      collectionId: "c1",
      kind: "Upload",
      name: "doc",
      locator: { kind: "Upload", storageRef: "r1", filename: "doc.txt", mimeType: "text/plain", sizeBytes: 10 },
      acl: { tags: [], visibility: "Tenant" },
    });
    expect(createSourceRowMock).toHaveBeenCalled();
  });

  it("rejects a locator whose kind mismatches the declared source kind", async () => {
    const { createSource } = await import("./source-service.js");
    await expect(
      createSource(ctx, {
        collectionId: "c1",
        kind: "Upload",
        name: "doc",
        locator: { kind: "Url", url: "https://example.com", crawlDepth: 0, includePatterns: [], excludePatterns: [], respectRobots: true },
        acl: { tags: [], visibility: "Tenant" },
      }),
    ).rejects.toThrow(KnowledgeSourceLocatorInvalidError);
  });

  it("rejects an Upload locator missing storageRef/filename", async () => {
    const { createSource } = await import("./source-service.js");
    await expect(
      createSource(ctx, {
        collectionId: "c1",
        kind: "Upload",
        name: "doc",
        locator: { kind: "Upload", storageRef: "", filename: "", mimeType: "text/plain", sizeBytes: 0 },
        acl: { tags: [], visibility: "Tenant" },
      }),
    ).rejects.toThrow(KnowledgeSourceLocatorInvalidError);
  });

  it("rejects a Url locator missing url", async () => {
    const { createSource } = await import("./source-service.js");
    await expect(
      createSource(ctx, {
        collectionId: "c1",
        kind: "Url",
        name: "page",
        locator: { kind: "Url", url: "", crawlDepth: 0, includePatterns: [], excludePatterns: [], respectRobots: true },
        acl: { tags: [], visibility: "Tenant" },
      }),
    ).rejects.toThrow(KnowledgeSourceLocatorInvalidError);
  });

  it("rejects an McpResource locator missing mcpManifestItemId/uri", async () => {
    const { createSource } = await import("./source-service.js");
    await expect(
      createSource(ctx, {
        collectionId: "c1",
        kind: "McpResource",
        name: "resource",
        locator: { kind: "McpResource", mcpManifestItemId: "", mcpServerVersionId: "", uri: "" },
        acl: { tags: [], visibility: "Tenant" },
      }),
    ).rejects.toThrow(KnowledgeSourceLocatorInvalidError);
  });

  it("rejects a Connector locator missing connectorId/toolName", async () => {
    const { createSource } = await import("./source-service.js");
    await expect(
      createSource(ctx, {
        collectionId: "c1",
        kind: "Connector",
        name: "connector sync",
        locator: { kind: "Connector", connectorId: "", toolName: "", argTemplate: {} },
        acl: { tags: [], visibility: "Tenant" },
      }),
    ).rejects.toThrow(KnowledgeSourceLocatorInvalidError);
  });

  it("accepts well-formed McpResource and Connector locators (schema/ACL data model populated even though content fetch is deferred)", async () => {
    const { createSource } = await import("./source-service.js");
    await createSource(ctx, {
      collectionId: "c1",
      kind: "McpResource",
      name: "resource",
      locator: { kind: "McpResource", mcpManifestItemId: "m1", mcpServerVersionId: "v1", uri: "res://x" },
      acl: { tags: [], visibility: "Tenant" },
    });
    await createSource(ctx, {
      collectionId: "c1",
      kind: "Connector",
      name: "connector sync",
      locator: { kind: "Connector", connectorId: "conn1", toolName: "list_docs", argTemplate: {} },
      acl: { tags: [], visibility: "Tenant" },
    });
    expect(createSourceRowMock).toHaveBeenCalledTimes(2);
  });

  it("404s via getCollectionOrThrow when the collection doesn't exist for this tenant, before any locator validation runs", async () => {
    getCollectionOrThrowMock.mockRejectedValue(new Error("not found"));
    const { createSource } = await import("./source-service.js");
    await expect(
      createSource(ctx, {
        collectionId: "missing",
        kind: "Upload",
        name: "doc",
        locator: { kind: "Upload", storageRef: "r1", filename: "doc.txt", mimeType: "text/plain", sizeBytes: 10 },
        acl: { tags: [], visibility: "Tenant" },
      }),
    ).rejects.toThrow("not found");
    expect(createSourceRowMock).not.toHaveBeenCalled();
  });
});

describe("triggerSourceSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports enqueued:false when the collection has no current Ready generation yet", async () => {
    getSourceOrThrowMock.mockResolvedValue({ id: "s1", collectionId: "c1" });
    getCurrentReadyGenerationForCollectionMock.mockResolvedValue(null);
    const { triggerSourceSync } = await import("./source-service.js");
    expect(await triggerSourceSync(ctx, "s1")).toEqual({ enqueued: false });
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  it("enqueues a real Ingest job into the current Ready generation when one exists", async () => {
    getSourceOrThrowMock.mockResolvedValue({ id: "s1", collectionId: "c1" });
    getCurrentReadyGenerationForCollectionMock.mockResolvedValue({ id: "g1" });
    enqueueJobMock.mockResolvedValue({ id: "job1" });
    const { triggerSourceSync } = await import("./source-service.js");
    expect(await triggerSourceSync(ctx, "s1")).toEqual({ enqueued: true });
    expect(enqueueJobMock).toHaveBeenCalledWith(ctx, { generationId: "g1", sourceId: "s1", stage: "Ingest", input: {} });
  });

  it("reports enqueued:false when the job was a duplicate (idempotency-key collision)", async () => {
    getSourceOrThrowMock.mockResolvedValue({ id: "s1", collectionId: "c1" });
    getCurrentReadyGenerationForCollectionMock.mockResolvedValue({ id: "g1" });
    enqueueJobMock.mockResolvedValue(null);
    const { triggerSourceSync } = await import("./source-service.js");
    expect(await triggerSourceSync(ctx, "s1")).toEqual({ enqueued: false });
  });
});

describe("deleteSource (Target Architecture Blueprint Phase 11, BL-42, FR-KB-08/FR-ADM-06)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to the real cascade (purgeSourceContent) rather than merely flipping a status flag", async () => {
    purgeSourceContentMock.mockResolvedValue({ chunksDeleted: 3, edgesDeleted: 1, entitiesDeleted: 0, communitiesMarkedStaleForResummarization: 0, communitiesDeleted: 0 });
    const { deleteSource } = await import("./source-service.js");
    await deleteSource(ctx, "s1");
    expect(purgeSourceContentMock).toHaveBeenCalledWith(ctx, "s1");
  });
});
