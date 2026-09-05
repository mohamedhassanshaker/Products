import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const requirePlatformApiMock = vi.fn();
vi.mock("@/src/lib/platform-api-guard", () => ({
  requirePlatformApi: (...a: unknown[]) => requirePlatformApiMock(...a),
}));

const reseedTenantQuotaFromTierMock = vi.fn();
vi.mock("@nextbot/tenancy", () => ({
  reseedTenantQuotaFromTier: (...a: unknown[]) => reseedTenantQuotaFromTierMock(...a),
}));

function makeRequest() {
  return new NextRequest("http://localhost/api/internal/ops/tenants/t1/plan-tier/reseed-quota", { method: "POST" });
}

describe("POST /api/internal/ops/tenants/[id]/plan-tier/reseed-quota (NFR-11 Platform Manager console)", () => {
  beforeEach(() => {
    requirePlatformApiMock.mockReset();
    reseedTenantQuotaFromTierMock.mockReset();
  });

  it("returns the guard's Response verbatim when unauthorized", async () => {
    const deny = new Response(null, { status: 404 });
    requirePlatformApiMock.mockResolvedValue(deny);
    const { POST } = await import("./route.js");

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "t1" }) });
    expect(res).toBe(deny);
    expect(reseedTenantQuotaFromTierMock).not.toHaveBeenCalled();
  });

  it("re-seeds the tenant's quota from its current tier's defaults once authorized", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    reseedTenantQuotaFromTierMock.mockResolvedValue({
      tenantId: "t1",
      maxToolCallsPerSecond: 5,
      maxConcurrentConversations: 500,
      maxMcpConnectors: 15,
    });
    const { POST } = await import("./route.js");

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tenantId: "t1",
      maxToolCallsPerSecond: 5,
      maxConcurrentConversations: 500,
      maxMcpConnectors: 15,
    });
    expect(reseedTenantQuotaFromTierMock).toHaveBeenCalledWith("t1", expect.any(String));
  });

  it("returns a 404 problem body for a nonexistent tenant id", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    reseedTenantQuotaFromTierMock.mockResolvedValue(null);
    const { POST } = await import("./route.js");

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });
});

describe("unimplemented verbs on /api/internal/ops/tenants/[id]/plan-tier/reseed-quota", () => {
  it("answers GET/PUT/PATCH/DELETE/OPTIONS with the canonical nonexistent-API-path response", async () => {
    const route = (await import("./route.js")) as unknown as Record<string, () => Response>;
    const { apiNotFoundResponse } = await import("@/src/lib/api-not-found-response.js");
    const expected = apiNotFoundResponse();

    for (const verb of ["GET", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const handler = route[verb];
      expect(handler, `route must export ${verb}`).toBeTypeOf("function");
      const res = (handler as () => Response)();
      expect(res.status).toBe(expected.status);
      expect(await res.text()).toBe("Not Found");
    }
  });
});
