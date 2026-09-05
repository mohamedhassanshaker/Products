import { describe, expect, it, vi, beforeEach } from "vitest";

const getCollectionOrThrowMock = vi.fn();
vi.mock("../infrastructure/collection-repository.js", () => ({
  getCollectionOrThrow: (...a: unknown[]) => getCollectionOrThrowMock(...a),
}));

const listCoverageGapsForCollectionMock = vi.fn();
vi.mock("../infrastructure/retrieval-event-repository.js", () => ({
  listCoverageGapsForCollection: (...a: unknown[]) => listCoverageGapsForCollectionMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

describe("getCoverageReport (FR-KB-08 coverage report)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCollectionOrThrowMock.mockResolvedValue({ id: "col1", minRelevanceScore: 0.35 });
  });

  it("passes the collection's own configured minRelevanceScore through to the repository query, never a hardcoded threshold", async () => {
    listCoverageGapsForCollectionMock.mockResolvedValue([]);
    const { getCoverageReport } = await import("./coverage-service.js");
    await getCoverageReport(ctx, "col1");
    expect(listCoverageGapsForCollectionMock).toHaveBeenCalledWith(ctx, "col1", 0.35, expect.any(Date));
  });

  it("defaults to a 30-day lookback window when none is supplied", async () => {
    listCoverageGapsForCollectionMock.mockResolvedValue([]);
    const { getCoverageReport } = await import("./coverage-service.js");
    const result = await getCoverageReport(ctx, "col1");
    const sinceDate = new Date(result.sinceDate);
    const ageDays = (Date.now() - sinceDate.getTime()) / (1000 * 60 * 60 * 24);
    expect(ageDays).toBeGreaterThan(29);
    expect(ageDays).toBeLessThan(31);
  });

  it("surfaces recurring ungrounded questions with their real occurrence counts, ordered as the repository already sorted them", async () => {
    listCoverageGapsForCollectionMock.mockResolvedValue([
      { queryTextHash: "hash1", sampleQueryTextMasked: "What is our return policy for [REDACTED]?", occurrences: 12, refusedCount: 8, maxTopScore: 0.2, lastSeenAt: new Date("2026-08-01") },
      { queryTextHash: "hash2", sampleQueryTextMasked: null, occurrences: 3, refusedCount: 3, maxTopScore: null, lastSeenAt: new Date("2026-07-15") },
    ]);
    const { getCoverageReport } = await import("./coverage-service.js");
    const result = await getCoverageReport(ctx, "col1");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.occurrences).toBe(12);
    expect(result.items[1]?.sampleQueryTextMasked).toBeNull(); // pre-Phase-11 rows never had a masked query captured
  });

  it("respects an explicit, capped limit", async () => {
    listCoverageGapsForCollectionMock.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ queryTextHash: `hash${i}`, sampleQueryTextMasked: null, occurrences: 1, refusedCount: 0, maxTopScore: 0.1, lastSeenAt: new Date() })));
    const { getCoverageReport } = await import("./coverage-service.js");
    const result = await getCoverageReport(ctx, "col1", { limit: 3 });
    expect(result.items).toHaveLength(3);
  });
});
