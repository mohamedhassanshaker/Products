import { describe, it, expect } from "vitest";
import { validateRouteCapabilities, assertRouteSatisfies, type RouteCapabilityHop } from "./capability-validator.js";
import { RouteCapabilityUnsatisfiedError } from "@nextbot/contracts";

function hop(overrides: Partial<RouteCapabilityHop["entry"]> & { ordinal: number; providerOverrides?: Partial<RouteCapabilityHop["provider"]> }): RouteCapabilityHop {
  const { providerOverrides, ordinal, ...entryOverrides } = overrides;
  return {
    ordinal,
    provider: {
      id: `provider-${ordinal}`,
      name: `Provider ${ordinal}`,
      type: "openai-compatible",
      region: "UAE",
      retainsPrompts: false,
      trainsOnData: false,
      status: "Active",
      enabled: true,
      ...providerOverrides,
    },
    entry: {
      id: `entry-${ordinal}`,
      modelId: `model-${ordinal}`,
      displayName: `Model ${ordinal}`,
      modality: "Text",
      contextWindow: 8192,
      maxOutput: 4096,
      dimension: null,
      status: "Available",
      capabilitiesJson: {
        toolCalling: true,
        vision: false,
        streaming: true,
        structuredOutput: true,
        extendedThinking: false,
        promptCaching: false,
        jsonMode: true,
      },
      ...entryOverrides,
    },
  };
}

const baseCtx = {
  expectedModality: null,
  tenantResidency: { region: "UAE" as const, allowOutOfRegionInference: false },
  allowedProviderTypesForPlanTier: null,
  policy: { allowOutOfRegionFailover: false },
};

describe("validateRouteCapabilities — the weakest hop wins (FR-AGT-22)", () => {
  it("intersects a 2-hop chain where hop 1 supports tool-calling and hop 2 does not: the advertised set does NOT include tool-calling", () => {
    const result = validateRouteCapabilities({
      ...baseCtx,
      hops: [
        hop({ ordinal: 0 }),
        hop({ ordinal: 1, capabilitiesJson: { toolCalling: false, vision: false, streaming: true, structuredOutput: true, extendedThinking: false, promptCaching: false, jsonMode: true } }),
      ],
    });
    expect(result.errors).toHaveLength(0);
    expect(result.advertisedCapabilities.toolCalling).toBe(false);
    // Every OTHER flag both hops agree on stays true — this isn't "everything drops
    // to false", only the flag the weaker hop actually lacks.
    expect(result.advertisedCapabilities.streaming).toBe(true);
    expect(result.advertisedCapabilities.jsonMode).toBe(true);
    // A degradation warning names the dropped capability, but never blocks the save.
    expect(result.warnings.some((w) => w.code === "ROUTE_CAPABILITY_DEGRADED_BY_HOP")).toBe(true);
  });

  it("a single-hop route advertises exactly that hop's capabilities", () => {
    const result = validateRouteCapabilities({ ...baseCtx, hops: [hop({ ordinal: 0 })] });
    expect(result.advertisedCapabilities.toolCalling).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("an empty chain is rejected outright", () => {
    const result = validateRouteCapabilities({ ...baseCtx, hops: [] });
    expect(result.errors.some((e) => e.code === "ROUTE_EMPTY_CHAIN")).toBe(true);
  });

  it("a retired model in any hop is a save-time error", () => {
    const result = validateRouteCapabilities({ ...baseCtx, hops: [hop({ ordinal: 0, status: "Retired" })] });
    expect(result.errors.some((e) => e.code === "ROUTE_MODEL_RETIRED")).toBe(true);
  });

  it("a deprecating model in any hop is a warning, not a save-blocking error", () => {
    const result = validateRouteCapabilities({ ...baseCtx, hops: [hop({ ordinal: 0, status: "Deprecating" })] });
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === "ROUTE_MODEL_DEPRECATING")).toBe(true);
  });

  it("a modality mismatch against the route's expected modality is a save-time error", () => {
    const result = validateRouteCapabilities({ ...baseCtx, expectedModality: "Embedding", hops: [hop({ ordinal: 0, modality: "Text" })] });
    expect(result.errors.some((e) => e.code === "ROUTE_MODALITY_MISMATCH")).toBe(true);
  });

  it("mismatched embedding dimensions across hops is a save-time error", () => {
    const result = validateRouteCapabilities({
      ...baseCtx,
      expectedModality: "Embedding",
      hops: [
        hop({ ordinal: 0, modality: "Embedding", dimension: 1536 }),
        hop({ ordinal: 1, modality: "Embedding", dimension: 3072 }),
      ],
    });
    expect(result.errors.some((e) => e.code === "ROUTE_EMBEDDING_DIMENSION_MISMATCH")).toBe(true);
  });

  it("a disabled provider on any hop is a save-time error", () => {
    const result = validateRouteCapabilities({ ...baseCtx, hops: [hop({ ordinal: 0, providerOverrides: { enabled: false } })] });
    expect(result.errors.some((e) => e.code === "ROUTE_PROVIDER_DISABLED")).toBe(true);
  });

  it("a provider type the plan tier disallows is a save-time error", () => {
    const result = validateRouteCapabilities({
      ...baseCtx,
      allowedProviderTypesForPlanTier: ["anthropic"],
      hops: [hop({ ordinal: 0, providerOverrides: { type: "openai-compatible" } })],
    });
    expect(result.errors.some((e) => e.code === "ROUTE_PROVIDER_TYPE_NOT_ALLOWED_FOR_PLAN")).toBe(true);
  });

  it("strictestDataHandling is the OR across hops (any hop retaining prompts marks the whole route)", () => {
    const result = validateRouteCapabilities({
      ...baseCtx,
      hops: [hop({ ordinal: 0, providerOverrides: { retainsPrompts: false } }), hop({ ordinal: 1, providerOverrides: { retainsPrompts: true } })],
    });
    expect(result.strictestDataHandling.retainsPrompts).toBe(true);
  });

  it("effectiveContextWindow/effectiveMaxOutput are the minimum across hops", () => {
    const result = validateRouteCapabilities({
      ...baseCtx,
      hops: [hop({ ordinal: 0, contextWindow: 128_000, maxOutput: 8192 }), hop({ ordinal: 1, contextWindow: 8192, maxOutput: 4096 })],
    });
    expect(result.effectiveContextWindow).toBe(8192);
    expect(result.effectiveMaxOutput).toBe(4096);
  });

  describe("residency (FR-AGT-25) — an out-of-region hop needs BOTH opt-ins, never either alone", () => {
    it("rejects an out-of-region hop when neither opt-in is set", () => {
      const result = validateRouteCapabilities({ ...baseCtx, hops: [hop({ ordinal: 0, providerOverrides: { region: "EU" } })] });
      expect(result.errors.some((e) => e.code === "ROUTE_RESIDENCY_VIOLATION")).toBe(true);
    });

    it("still rejects when only the route policy opts in (tenant has not)", () => {
      const result = validateRouteCapabilities({
        ...baseCtx,
        policy: { allowOutOfRegionFailover: true },
        hops: [hop({ ordinal: 0, providerOverrides: { region: "EU" } })],
      });
      expect(result.errors.some((e) => e.code === "ROUTE_RESIDENCY_VIOLATION")).toBe(true);
    });

    it("still rejects when only the tenant has opted in (route policy has not)", () => {
      const result = validateRouteCapabilities({
        ...baseCtx,
        tenantResidency: { region: "UAE", allowOutOfRegionInference: true },
        hops: [hop({ ordinal: 0, providerOverrides: { region: "EU" } })],
      });
      expect(result.errors.some((e) => e.code === "ROUTE_RESIDENCY_VIOLATION")).toBe(true);
    });

    it("allows an out-of-region hop only when BOTH opt-ins are set", () => {
      const result = validateRouteCapabilities({
        ...baseCtx,
        tenantResidency: { region: "UAE", allowOutOfRegionInference: true },
        policy: { allowOutOfRegionFailover: true },
        hops: [hop({ ordinal: 0, providerOverrides: { region: "EU" } })],
      });
      expect(result.errors.some((e) => e.code === "ROUTE_RESIDENCY_VIOLATION")).toBe(false);
    });
  });
});

describe("assertRouteSatisfies — an agent version's required capabilities against its pinned route", () => {
  it("passes when the route version's frozen advertised_capabilities satisfies every required flag", () => {
    expect(() =>
      assertRouteSatisfies({ toolCalling: true }, { advertisedCapabilities: { toolCalling: true, vision: false, streaming: true, structuredOutput: false, extendedThinking: false, promptCaching: false, jsonMode: false } }, "chat.primary"),
    ).not.toThrow();
  });

  it("throws RouteCapabilityUnsatisfiedError naming every missing capability, not just the first", () => {
    try {
      assertRouteSatisfies(
        { toolCalling: true, vision: true },
        { advertisedCapabilities: { toolCalling: false, vision: false, streaming: true, structuredOutput: false, extendedThinking: false, promptCaching: false, jsonMode: false } },
        "chat.primary",
      );
      expect.fail("expected assertRouteSatisfies to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RouteCapabilityUnsatisfiedError);
      expect((err as Error).message).toContain("toolCalling");
      expect((err as Error).message).toContain("vision");
    }
  });

  it("never re-derives the intersection — trusts the frozen advertised_capabilities as-is", () => {
    // Even though this "route version" object carries no hop data at all, the
    // assertion only ever reads `advertisedCapabilities` — proving it never tries to
    // recompute anything from hops (LLD §14.8.2: "stored, not recomputed at runtime").
    expect(() =>
      assertRouteSatisfies({ toolCalling: true }, { advertisedCapabilities: { toolCalling: true, vision: false, streaming: false, structuredOutput: false, extendedThinking: false, promptCaching: false, jsonMode: false } }, "chat.primary"),
    ).not.toThrow();
  });
});
