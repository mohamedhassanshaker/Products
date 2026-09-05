import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const requirePlatformApiMock = vi.fn();
vi.mock("@/src/lib/platform-api-guard", () => ({
  requirePlatformApi: (...a: unknown[]) => requirePlatformApiMock(...a),
}));

const requireActiveBreakglassTenantContextMock = vi.fn();
vi.mock("@nextbot/tenancy", () => ({
  requireActiveBreakglassTenantContext: (...a: unknown[]) => requireActiveBreakglassTenantContextMock(...a),
}));

const listEscalationsForAdminMock = vi.fn();
vi.mock("@nextbot/escalations", () => ({
  listEscalationsForAdmin: (...a: unknown[]) => listEscalationsForAdminMock(...a),
}));

function makeRequest() {
  return new NextRequest("http://localhost/api/internal/ops/tenants/t1/breakglass/escalations");
}

describe("GET /api/internal/ops/tenants/[id]/breakglass/escalations (Phase 20, FR-ADM-09)", () => {
  beforeEach(() => {
    requirePlatformApiMock.mockReset();
    requireActiveBreakglassTenantContextMock.mockReset();
    listEscalationsForAdminMock.mockReset();
  });

  it("returns the guard's Response verbatim when unauthorized", async () => {
    const deny = new Response(null, { status: 404 });
    requirePlatformApiMock.mockResolvedValue(deny);
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "t1" }) });
    expect(res).toBe(deny);
  });

  it("maps a thrown BreakglassAccessDeniedError to 403 — fail-closed even with a valid operator token", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    const { BreakglassAccessDeniedError } = await import("@nextbot/contracts");
    requireActiveBreakglassTenantContextMock.mockRejectedValue(new BreakglassAccessDeniedError("expired"));
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(403);
  });

  it("returns the escalation list once the grant is active", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    const ctx = { tenantId: "t1" };
    requireActiveBreakglassTenantContextMock.mockResolvedValue({ ctx, grantId: "g1" });
    listEscalationsForAdminMock.mockResolvedValue([{ id: "e1" }]);
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ escalations: [{ id: "e1" }] });
    expect(listEscalationsForAdminMock).toHaveBeenCalledWith(ctx);
  });
});

describe("unimplemented verbs on /api/internal/ops/tenants/[id]/breakglass/escalations", () => {
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
