import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const requirePlatformApiMock = vi.fn();
vi.mock("@/src/lib/platform-api-guard", () => ({
  requirePlatformApi: (...a: unknown[]) => requirePlatformApiMock(...a),
}));

const listPlanTierDefinitionsMock = vi.fn();
vi.mock("@nextbot/tenancy", () => ({
  listPlanTierDefinitions: (...a: unknown[]) => listPlanTierDefinitionsMock(...a),
}));

function makeRequest() {
  return new NextRequest("http://localhost/api/internal/ops/plan-tiers");
}

describe("GET /api/internal/ops/plan-tiers (NFR-11 Platform Manager console)", () => {
  beforeEach(() => {
    requirePlatformApiMock.mockReset();
    listPlanTierDefinitionsMock.mockReset();
  });

  it("returns the guard's Response verbatim when unauthorized", async () => {
    const deny = new Response(null, { status: 404 });
    requirePlatformApiMock.mockResolvedValue(deny);
    const { GET } = await import("./route.js");

    const res = await GET(makeRequest());
    expect(res).toBe(deny);
    expect(listPlanTierDefinitionsMock).not.toHaveBeenCalled();
  });

  it("returns the three tier definitions once authorized", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    listPlanTierDefinitionsMock.mockResolvedValue([{ tier: "Starter" }, { tier: "Growth" }, { tier: "Enterprise" }]);
    const { GET } = await import("./route.js");

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tiers: [{ tier: "Starter" }, { tier: "Growth" }, { tier: "Enterprise" }] });
  });
});

describe("unimplemented verbs on /api/internal/ops/plan-tiers", () => {
  it("answers POST/PUT/PATCH/DELETE/OPTIONS with the canonical nonexistent-API-path response", async () => {
    const route = (await import("./route.js")) as unknown as Record<string, () => Response>;
    const { apiNotFoundResponse } = await import("@/src/lib/api-not-found-response.js");
    const expected = apiNotFoundResponse();

    for (const verb of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const handler = route[verb];
      expect(handler, `route must export ${verb}`).toBeTypeOf("function");
      const res = (handler as () => Response)();
      expect(res.status).toBe(expected.status);
      expect(await res.text()).toBe("Not Found");
    }
  });
});
