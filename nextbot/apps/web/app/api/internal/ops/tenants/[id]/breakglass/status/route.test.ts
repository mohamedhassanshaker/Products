import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const requirePlatformApiMock = vi.fn();
vi.mock("@/src/lib/platform-api-guard", () => ({
  requirePlatformApi: (...a: unknown[]) => requirePlatformApiMock(...a),
}));

const resolveTenantByIdMock = vi.fn();
const getActiveBreakglassGrantMock = vi.fn();
vi.mock("@nextbot/tenancy", () => ({
  resolveTenantById: (...a: unknown[]) => resolveTenantByIdMock(...a),
  getActiveBreakglassGrant: (...a: unknown[]) => getActiveBreakglassGrantMock(...a),
}));

function makeRequest() {
  return new NextRequest("http://localhost/api/internal/ops/tenants/t1/breakglass/status");
}

describe("GET /api/internal/ops/tenants/[id]/breakglass/status (Phase 20, FR-ADM-09)", () => {
  beforeEach(() => {
    requirePlatformApiMock.mockReset();
    resolveTenantByIdMock.mockReset();
    getActiveBreakglassGrantMock.mockReset();
  });

  it("returns the guard's Response verbatim when unauthorized", async () => {
    const deny = new Response(null, { status: 404 });
    requirePlatformApiMock.mockResolvedValue(deny);
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "t1" }) });
    expect(res).toBe(deny);
    expect(resolveTenantByIdMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent tenant", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    resolveTenantByIdMock.mockResolvedValue(null);
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("reports activeGrant: null when no active grant exists", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    resolveTenantByIdMock.mockResolvedValue({ id: "t1", region: "US" });
    getActiveBreakglassGrantMock.mockResolvedValue(null);
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "t1" }) });
    expect(await res.json()).toEqual({ activeGrant: null });
  });

  it("reports the active grant's id/reason/expiresAt when one exists", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    resolveTenantByIdMock.mockResolvedValue({ id: "t1", region: "US" });
    getActiveBreakglassGrantMock.mockResolvedValue({ id: "g1", reason: "diagnosis", expiresAt: new Date("2026-01-01T00:00:00Z") });
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "t1" }) });
    const body = await res.json();
    expect(body.activeGrant.grantId).toBe("g1");
    expect(body.activeGrant.reason).toBe("diagnosis");
  });
});

describe("unimplemented verbs on /api/internal/ops/tenants/[id]/breakglass/status", () => {
  it("answers POST/PUT/PATCH/DELETE/OPTIONS with the canonical nonexistent-API-path response", async () => {
    const route = (await import("./route.js")) as unknown as Record<string, () => Response>;
    const { apiNotFoundResponse } = await import("@/src/lib/api-not-found-response.js");
    const expected = apiNotFoundResponse();
    for (const verb of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const res = (route[verb] as () => Response)();
      expect(res.status).toBe(expected.status);
      expect(await res.text()).toBe("Not Found");
    }
  });
});
