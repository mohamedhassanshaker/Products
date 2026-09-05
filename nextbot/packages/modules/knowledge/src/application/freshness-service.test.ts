import { describe, expect, it, vi, beforeEach } from "vitest";

const getCollectionOrThrowMock = vi.fn();
vi.mock("../infrastructure/collection-repository.js", () => ({
  getCollectionOrThrow: (...a: unknown[]) => getCollectionOrThrowMock(...a),
}));

const getGenerationOrThrowMock = vi.fn();
vi.mock("../infrastructure/generation-repository.js", () => ({
  getGenerationOrThrow: (...a: unknown[]) => getGenerationOrThrowMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

describe("getCollectionFreshness (FR-KB-08 staleness badge)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports NoGeneration when the collection has never had a Ready generation", async () => {
    getCollectionOrThrowMock.mockResolvedValue({ currentGenerationId: null, maxStalenessHours: 24 });
    const { getCollectionFreshness } = await import("./freshness-service.js");
    const result = await getCollectionFreshness(ctx, "col1");
    expect(result.status).toBe("NoGeneration");
    expect(result.ageHours).toBeNull();
  });

  it("reports NoStalenessLimitConfigured (not Fresh) when no max_staleness_hours is set, even for a very old generation", async () => {
    getCollectionOrThrowMock.mockResolvedValue({ currentGenerationId: "gen1", maxStalenessHours: null });
    getGenerationOrThrowMock.mockResolvedValue({ builtAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 365) });
    const { getCollectionFreshness } = await import("./freshness-service.js");
    const result = await getCollectionFreshness(ctx, "col1");
    expect(result.status).toBe("NoStalenessLimitConfigured");
  });

  it("reports Fresh when the generation's age is within the configured limit", async () => {
    getCollectionOrThrowMock.mockResolvedValue({ currentGenerationId: "gen1", maxStalenessHours: 48 });
    getGenerationOrThrowMock.mockResolvedValue({ builtAt: new Date(Date.now() - 1000 * 60 * 60 * 2) }); // 2h old
    const { getCollectionFreshness } = await import("./freshness-service.js");
    const result = await getCollectionFreshness(ctx, "col1");
    expect(result.status).toBe("Fresh");
  });

  it("reports Stale when the generation's age exceeds the configured limit — the SAME comparison the retrieval agent's own refusal check uses", async () => {
    getCollectionOrThrowMock.mockResolvedValue({ currentGenerationId: "gen1", maxStalenessHours: 1 });
    getGenerationOrThrowMock.mockResolvedValue({ builtAt: new Date(Date.now() - 1000 * 60 * 60 * 5) }); // 5h old, 1h ceiling
    const { getCollectionFreshness } = await import("./freshness-service.js");
    const result = await getCollectionFreshness(ctx, "col1");
    expect(result.status).toBe("Stale");
    expect(result.ageHours).toBeGreaterThan(1);
  });
});
