import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const requirePlatformApiMock = vi.fn();
vi.mock("@/src/lib/platform-api-guard", () => ({
  requirePlatformApi: (...a: unknown[]) => requirePlatformApiMock(...a),
}));

const updatePlanTierDefinitionMock = vi.fn();
vi.mock("@nextbot/tenancy", () => ({
  updatePlanTierDefinition: (...a: unknown[]) => updatePlanTierDefinitionMock(...a),
}));

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/internal/ops/plan-tiers/Growth", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/internal/ops/plan-tiers/[tier] (NFR-11 Platform Manager console)", () => {
  beforeEach(() => {
    requirePlatformApiMock.mockReset();
    updatePlanTierDefinitionMock.mockReset();
  });

  it("returns the guard's Response verbatim when unauthorized", async () => {
    const deny = new Response(null, { status: 404 });
    requirePlatformApiMock.mockResolvedValue(deny);
    const { PATCH } = await import("./route.js");

    const res = await PATCH(makeRequest({ maxMcpConnectors: 20 }), { params: Promise.resolve({ tier: "Growth" }) });
    expect(res).toBe(deny);
    expect(updatePlanTierDefinitionMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown tier segment with 404 before touching the application layer", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    const { PATCH } = await import("./route.js");

    const res = await PATCH(makeRequest({ maxMcpConnectors: 20 }), { params: Promise.resolve({ tier: "Platinum" }) });
    expect(res.status).toBe(404);
    expect(updatePlanTierDefinitionMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid patch body with 422", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    const { PATCH } = await import("./route.js");

    const res = await PATCH(makeRequest({ maxMcpConnectors: "unlimited" }), { params: Promise.resolve({ tier: "Growth" }) });
    expect(res.status).toBe(422);
    expect(updatePlanTierDefinitionMock).not.toHaveBeenCalled();
  });

  it("applies a valid patch once authorized", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    updatePlanTierDefinitionMock.mockResolvedValue({ tier: "Growth", maxMcpConnectors: 20 });
    const { PATCH } = await import("./route.js");

    const res = await PATCH(makeRequest({ maxMcpConnectors: 20 }), { params: Promise.resolve({ tier: "Growth" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tier: "Growth", maxMcpConnectors: 20 });
    expect(updatePlanTierDefinitionMock).toHaveBeenCalledWith("Growth", { maxMcpConnectors: 20 }, expect.any(String));
  });

  it("returns a 404 problem body when the application layer reports no row for the tier", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    updatePlanTierDefinitionMock.mockResolvedValue(null);
    const { PATCH } = await import("./route.js");

    const res = await PATCH(makeRequest({ maxMcpConnectors: 20 }), { params: Promise.resolve({ tier: "Growth" }) });
    expect(res.status).toBe(404);
  });
});

describe("unimplemented verbs on /api/internal/ops/plan-tiers/[tier]", () => {
  it("answers GET/POST/PUT/DELETE/OPTIONS with the canonical nonexistent-API-path response", async () => {
    const route = (await import("./route.js")) as unknown as Record<string, () => Response>;
    const { apiNotFoundResponse } = await import("@/src/lib/api-not-found-response.js");
    const expected = apiNotFoundResponse();

    for (const verb of ["GET", "POST", "PUT", "DELETE", "OPTIONS"]) {
      const handler = route[verb];
      expect(handler, `route must export ${verb}`).toBeTypeOf("function");
      const res = (handler as () => Response)();
      expect(res.status).toBe(expected.status);
      expect(await res.text()).toBe("Not Found");
    }
  });
});
