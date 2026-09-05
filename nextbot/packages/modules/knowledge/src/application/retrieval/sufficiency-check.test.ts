import { describe, expect, it, vi, beforeEach } from "vitest";

const callModelGatewayStructuredPinnedMock = vi.fn();
const getCatalogEntryMock = vi.fn();
const resolveModelChainForRouteVersionMock = vi.fn();
vi.mock("@nextbot/model-gateway", () => ({
  callModelGatewayStructuredPinned: (...a: unknown[]) => callModelGatewayStructuredPinnedMock(...a),
  getCatalogEntry: (...a: unknown[]) => getCatalogEntryMock(...a),
  resolveModelChainForRouteVersion: (...a: unknown[]) => resolveModelChainForRouteVersionMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

describe("checkSufficiency (unit, mocked model-gateway)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveModelChainForRouteVersionMock.mockResolvedValue({ hopAttribution: [{ catalogEntryId: "cat1" }] });
    getCatalogEntryMock.mockResolvedValue({ priceIn: "0.000001", priceOut: "0.000002" });
  });

  it("reports sufficient with no missing concepts when the model says the evidence is enough", async () => {
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ sufficient: true, missingConcepts: [] });
    const { checkSufficiency } = await import("./sufficiency-check.js");
    const result = await checkSufficiency(ctx, { plannerRouteVersionId: "route1", query: "Does Acme Corp partner with Globex?", evidenceSummary: "1. Acme signed a partnership with Globex in 2024." });
    expect(result.sufficient).toBe(true);
    expect(result.missingConcepts).toEqual([]);
  });

  it("reports insufficient with named missing concepts when the model says the evidence falls short", async () => {
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ sufficient: false, missingConcepts: ["termination clause"] });
    const { checkSufficiency } = await import("./sufficiency-check.js");
    const result = await checkSufficiency(ctx, { plannerRouteVersionId: "route1", query: "Can either party terminate the partnership early?", evidenceSummary: "1. Acme signed a partnership with Globex in 2024." });
    expect(result.sufficient).toBe(false);
    expect(result.missingConcepts).toEqual(["termination clause"]);
  });

  it("passes an empty-evidence placeholder rather than an empty string when nothing has been gathered yet", async () => {
    callModelGatewayStructuredPinnedMock.mockResolvedValue({ sufficient: false, missingConcepts: ["anything relevant"] });
    const { checkSufficiency } = await import("./sufficiency-check.js");
    await checkSufficiency(ctx, { plannerRouteVersionId: "route1", query: "anything?", evidenceSummary: "" });
    const [, args] = callModelGatewayStructuredPinnedMock.mock.calls[0] as [unknown, { messages: Array<{ content: string }> }];
    expect(args.messages[0]?.content).toContain("(none)");
  });
});
