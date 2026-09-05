import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const requirePlatformApiMock = vi.fn();
vi.mock("@/src/lib/platform-api-guard", () => ({
  requirePlatformApi: (...a: unknown[]) => requirePlatformApiMock(...a),
}));

const updateTenantPlanTierMock = vi.fn();
vi.mock("@nextbot/tenancy", () => ({
  updateTenantPlanTier: (...a: unknown[]) => updateTenantPlanTierMock(...a),
}));

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/internal/ops/tenants/t1/plan-tier", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/internal/ops/tenants/[id]/plan-tier (NFR-11 Platform Manager console)", () => {
  beforeEach(() => {
    requirePlatformApiMock.mockReset();
    updateTenantPlanTierMock.mockReset();
  });

  it("returns the guard's Response verbatim when unauthorized", async () => {
    const deny = new Response(null, { status: 404 });
    requirePlatformApiMock.mockResolvedValue(deny);
    const { PATCH } = await import("./route.js");

    const res = await PATCH(makeRequest({ planTier: "Growth" }), { params: Promise.resolve({ id: "t1" }) });
    expect(res).toBe(deny);
    expect(updateTenantPlanTierMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid plan tier with 422 before calling the application layer", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    const { PATCH } = await import("./route.js");

    const res = await PATCH(makeRequest({ planTier: "Platinum" }), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(422);
    expect(updateTenantPlanTierMock).not.toHaveBeenCalled();
  });

  it("changes only the label once authorized, per the application layer's contract", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    updateTenantPlanTierMock.mockResolvedValue({ id: "t1", planTier: "Growth" });
    const { PATCH } = await import("./route.js");

    const res = await PATCH(makeRequest({ planTier: "Growth" }), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "t1", planTier: "Growth" });
    expect(updateTenantPlanTierMock).toHaveBeenCalledWith("t1", "Growth", expect.any(String));
  });

  it("returns a 404 problem body for a nonexistent tenant id", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    updateTenantPlanTierMock.mockResolvedValue(null);
    const { PATCH } = await import("./route.js");

    const res = await PATCH(makeRequest({ planTier: "Growth" }), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });
});

describe("unimplemented verbs on /api/internal/ops/tenants/[id]/plan-tier", () => {
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
