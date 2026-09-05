import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — unit coverage for the
 * residency sub-requirement's own two save-time checks: the collection's declared
 * `region` against tenant policy (pre-existing, Phase 7b), and — new this phase —
 * the PINNED embedding route's own resolved provider region set against the same
 * policy. Real Postgres coverage of the full `createCollection` path already exists
 * elsewhere in this module's integration suite; this file isolates the residency
 * decision logic itself with every I/O boundary mocked.
 */

const getTenantDataPolicyMock = vi.fn();
vi.mock("@nextbot/tenancy", () => ({
  getTenantDataPolicy: (...a: unknown[]) => getTenantDataPolicyMock(...a),
}));

const resolveOrSynthesizeRouteVersionForKeyMock = vi.fn();
const getRouteVersionMock = vi.fn();
const getRouteOrThrowMock = vi.fn();
vi.mock("@nextbot/model-gateway", () => ({
  resolveOrSynthesizeRouteVersionForKey: (...a: unknown[]) => resolveOrSynthesizeRouteVersionForKeyMock(...a),
  getRouteVersion: (...a: unknown[]) => getRouteVersionMock(...a),
  getRouteOrThrow: (...a: unknown[]) => getRouteOrThrowMock(...a),
}));

const createCollectionRowMock = vi.fn();
const getCollectionOrThrowMock = vi.fn();
vi.mock("../infrastructure/collection-repository.js", () => ({
  createCollection: (...a: unknown[]) => createCollectionRowMock(...a),
  listCollections: vi.fn(),
  getCollectionOrThrow: (...a: unknown[]) => getCollectionOrThrowMock(...a),
  updateCollectionFields: vi.fn(),
  updateCollectionConfig: vi.fn(),
  softDeleteCollection: vi.fn(),
}));

const ctx = { tenantId: "t1", region: "UAE" as const, environment: "Sandbox" as const };

describe("collection-service residency checks (FR-KB-08)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveOrSynthesizeRouteVersionForKeyMock.mockImplementation(async (_ctx: unknown, key: string) => ({ id: `rv-${key}` }));
    createCollectionRowMock.mockResolvedValue({ id: "col1" });
  });

  it("allows creation when the collection's region matches the tenant's residency region and the embedding route's provider region set includes it", async () => {
    getTenantDataPolicyMock.mockResolvedValue({ residencyRegion: "UAE", allowOutOfRegionInference: false });
    getRouteVersionMock.mockResolvedValue({ maxRegionSet: ["UAE", "EU"] });
    const { createCollection } = await import("./collection-service.js");
    await expect(
      createCollection(ctx, { name: "Test Collection", region: "UAE", extractionRouteKey: "extract.default", embeddingRouteKey: "embed.default" }),
    ).resolves.toMatchObject({ id: "col1" });
  });

  it("rejects at save time with KNOWLEDGE_REGION_MISMATCH when the collection's own region doesn't match tenant policy and out-of-region inference is disallowed", async () => {
    getTenantDataPolicyMock.mockResolvedValue({ residencyRegion: "UAE", allowOutOfRegionInference: false });
    const { createCollection } = await import("./collection-service.js");
    await expect(
      createCollection(ctx, { name: "Test Collection", region: "EU", extractionRouteKey: "extract.default", embeddingRouteKey: "embed.default" }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_REGION_MISMATCH" });
    expect(createCollectionRowMock).not.toHaveBeenCalled(); // rejected BEFORE any row is ever persisted
  });

  it("rejects at save time with KNOWLEDGE_REGION_MISMATCH when the embedding route's own pinned provider does not serve the tenant's region", async () => {
    getTenantDataPolicyMock.mockResolvedValue({ residencyRegion: "UAE", allowOutOfRegionInference: false });
    getRouteVersionMock.mockResolvedValue({ maxRegionSet: ["EU", "US"] }); // never UAE
    const { createCollection } = await import("./collection-service.js");
    await expect(
      createCollection(ctx, { name: "Test Collection", region: "UAE", extractionRouteKey: "extract.default", embeddingRouteKey: "embed.default" }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_REGION_MISMATCH" });
    expect(createCollectionRowMock).not.toHaveBeenCalled();
  });

  it("never rejects on an unconstrained (empty) provider region set — empty means 'serves everywhere', not 'serves nowhere'", async () => {
    getTenantDataPolicyMock.mockResolvedValue({ residencyRegion: "UAE", allowOutOfRegionInference: false });
    getRouteVersionMock.mockResolvedValue({ maxRegionSet: [] });
    const { createCollection } = await import("./collection-service.js");
    await expect(
      createCollection(ctx, { name: "Test Collection", region: "UAE", extractionRouteKey: "extract.default", embeddingRouteKey: "embed.default" }),
    ).resolves.toMatchObject({ id: "col1" });
  });

  it("allows an out-of-region embedding provider when the tenant has explicitly opted into out-of-region inference", async () => {
    getTenantDataPolicyMock.mockResolvedValue({ residencyRegion: "UAE", allowOutOfRegionInference: true });
    getRouteVersionMock.mockResolvedValue({ maxRegionSet: ["EU"] });
    const { createCollection } = await import("./collection-service.js");
    await expect(
      createCollection(ctx, { name: "Test Collection", region: "UAE", extractionRouteKey: "extract.default", embeddingRouteKey: "embed.default" }),
    ).resolves.toMatchObject({ id: "col1" });
  });

  it("re-validates residency when a config update re-pins the embedding route to an out-of-region provider", async () => {
    getTenantDataPolicyMock.mockResolvedValue({ residencyRegion: "UAE", allowOutOfRegionInference: false });
    getCollectionOrThrowMock.mockResolvedValue({ id: "col1", region: "UAE" });
    getRouteVersionMock.mockResolvedValue({ maxRegionSet: ["EU"] });
    const { updateCollectionConfiguration } = await import("./collection-service.js");
    await expect(updateCollectionConfiguration(ctx, "col1", { embeddingRouteKey: "embed.other" })).rejects.toMatchObject({ code: "KNOWLEDGE_REGION_MISMATCH" });
  });
});
