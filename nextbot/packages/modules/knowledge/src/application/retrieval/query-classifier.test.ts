import { describe, expect, it, vi, beforeEach } from "vitest";

const findAnchorEntitiesByQueryMentionMock = vi.fn();
vi.mock("../../infrastructure/graph-repository.js", () => ({
  findAnchorEntitiesByQueryMention: (...a: unknown[]) => findAnchorEntitiesByQueryMentionMock(...a),
}));

const callModelGatewayStructuredPinnedMock = vi.fn();
const getCatalogEntryMock = vi.fn();
const resolveModelChainForRouteVersionMock = vi.fn();
vi.mock("@nextbot/model-gateway", () => ({
  callModelGatewayStructuredPinned: (...a: unknown[]) => callModelGatewayStructuredPinnedMock(...a),
  getCatalogEntry: (...a: unknown[]) => getCatalogEntryMock(...a),
  resolveModelChainForRouteVersion: (...a: unknown[]) => resolveModelChainForRouteVersionMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

describe("classifyRetrievalStrategy (unit, mocked infra/model-gateway)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveModelChainForRouteVersionMock.mockResolvedValue({ hopAttribution: [{ catalogEntryId: "cat1" }] });
    getCatalogEntryMock.mockResolvedValue({ priceIn: "0.000001", priceOut: "0.000002" });
  });

  it("falls back to Vector with zero cost when the query mentions no recognizable entity — no model call is made", async () => {
    findAnchorEntitiesByQueryMentionMock.mockResolvedValue([]);
    const { classifyRetrievalStrategy } = await import("./query-classifier.js");
    const result = await classifyRetrievalStrategy(ctx, { generationId: "g1", query: "what is the weather today", plannerRouteVersionId: "route1" });
    expect(result).toEqual({ strategy: "Vector", anchorCount: 0, costUsd: "0.00000000" });
    expect(callModelGatewayStructuredPinnedMock).not.toHaveBeenCalled();
  });

  it("classifies a narrow, entity-anchored scope as GraphLocal", async () => {
    findAnchorEntitiesByQueryMentionMock.mockResolvedValue([{ id: "e1", canonicalName: "acme corp" }]);
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ scope: "narrow", rationale: "asks about a specific entity's relation" });
    const { classifyRetrievalStrategy } = await import("./query-classifier.js");
    const result = await classifyRetrievalStrategy(ctx, { generationId: "g1", query: "Does Acme Corp partner with Globex?", plannerRouteVersionId: "route1" });
    expect(result.strategy).toBe("GraphLocal");
    expect(result.anchorCount).toBe(1);
    expect(callModelGatewayStructuredPinnedMock).toHaveBeenCalledTimes(1);
    const [, args] = callModelGatewayStructuredPinnedMock.mock.calls[0] as [unknown, { routeVersionId: string }];
    expect(args.routeVersionId).toBe("route1");
  });

  it("classifies a broad, thematic scope as GraphGlobal", async () => {
    findAnchorEntitiesByQueryMentionMock.mockResolvedValue([{ id: "e1", canonicalName: "refund policy" }]);
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ scope: "broad", rationale: "asks what the whole policy covers" });
    const { classifyRetrievalStrategy } = await import("./query-classifier.js");
    const result = await classifyRetrievalStrategy(ctx, { generationId: "g1", query: "What does our refund policy cover overall?", plannerRouteVersionId: "route1" });
    expect(result.strategy).toBe("GraphGlobal");
    expect(Number(result.costUsd)).toBeGreaterThanOrEqual(0);
  });
});
