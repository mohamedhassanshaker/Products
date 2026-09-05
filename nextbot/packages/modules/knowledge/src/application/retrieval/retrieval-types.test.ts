import { describe, expect, it, vi, beforeEach } from "vitest";

const getCatalogEntryMock = vi.fn();
const resolveModelChainForRouteVersionMock = vi.fn();
vi.mock("@nextbot/model-gateway", () => ({
  getCatalogEntry: (...a: unknown[]) => getCatalogEntryMock(...a),
  resolveModelChainForRouteVersion: (...a: unknown[]) => resolveModelChainForRouteVersionMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

describe("retrieval-types cost estimation helpers (unit, mocked @nextbot/model-gateway)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("sumCostsUsd", () => {
    it("sums cost strings without floating-point string-concatenation bugs", async () => {
      const { sumCostsUsd } = await import("./retrieval-types.js");
      expect(sumCostsUsd("0.00000050", "0.00001200")).toBe("0.00001250");
    });
    it("floors a non-finite/negative sum at zero rather than producing NaN/negative output", async () => {
      const { sumCostsUsd } = await import("./retrieval-types.js");
      expect(sumCostsUsd("not-a-number")).toBe("0.00000000");
    });
  });

  describe("estimateEmbeddingCallCostUsd", () => {
    it("returns a real cost computed from the exact catalog entry that served the call", async () => {
      getCatalogEntryMock.mockResolvedValue({ priceIn: "0.000001", priceOut: "0.000002" });
      const { estimateEmbeddingCallCostUsd } = await import("./retrieval-types.js");
      const cost = await estimateEmbeddingCallCostUsd(ctx, "catalog1", "a".repeat(40)); // 40 chars -> 10 tokens (chars/4)
      expect(cost).toBe((10 * 0.000001).toFixed(8));
    });
    it("returns zero without calling the catalog when no catalogEntryId was attributed", async () => {
      const { estimateEmbeddingCallCostUsd } = await import("./retrieval-types.js");
      const cost = await estimateEmbeddingCallCostUsd(ctx, undefined, "query text");
      expect(cost).toBe("0.00000000");
      expect(getCatalogEntryMock).not.toHaveBeenCalled();
    });
    it("returns zero (never throws) when the catalog entry can't be resolved", async () => {
      getCatalogEntryMock.mockResolvedValue(null);
      const { estimateEmbeddingCallCostUsd } = await import("./retrieval-types.js");
      const cost = await estimateEmbeddingCallCostUsd(ctx, "catalog-missing", "query text");
      expect(cost).toBe("0.00000000");
    });
  });

  describe("estimateCompletionCallCostUsd", () => {
    it("prices input tokens at price_in and output tokens at price_out", async () => {
      resolveModelChainForRouteVersionMock.mockResolvedValue({ hopAttribution: [{ catalogEntryId: "catalog1" }] });
      getCatalogEntryMock.mockResolvedValue({ priceIn: "0.000001", priceOut: "0.000002" });
      const { estimateCompletionCallCostUsd } = await import("./retrieval-types.js");
      const cost = await estimateCompletionCallCostUsd(ctx, "rv1", "a".repeat(40), "b".repeat(20)); // 10 in-tokens, 5 out-tokens
      expect(cost).toBe((10 * 0.000001 + 5 * 0.000002).toFixed(8));
    });
    it("returns zero when the resolved route version has no hop attribution", async () => {
      resolveModelChainForRouteVersionMock.mockResolvedValue({ hopAttribution: [] });
      const { estimateCompletionCallCostUsd } = await import("./retrieval-types.js");
      const cost = await estimateCompletionCallCostUsd(ctx, "rv1", "in", "out");
      expect(cost).toBe("0.00000000");
      expect(getCatalogEntryMock).not.toHaveBeenCalled();
    });
    it("returns zero when the attributed catalog entry can't be resolved", async () => {
      resolveModelChainForRouteVersionMock.mockResolvedValue({ hopAttribution: [{ catalogEntryId: "catalog-missing" }] });
      getCatalogEntryMock.mockResolvedValue(null);
      const { estimateCompletionCallCostUsd } = await import("./retrieval-types.js");
      const cost = await estimateCompletionCallCostUsd(ctx, "rv1", "in", "out");
      expect(cost).toBe("0.00000000");
    });
  });
});
