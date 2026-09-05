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

const listConversationsForAdminMock = vi.fn();
vi.mock("@nextbot/conversations", () => ({
  listConversationsForAdmin: (...a: unknown[]) => listConversationsForAdminMock(...a),
}));

function makeRequest() {
  return new NextRequest("http://localhost/api/internal/ops/tenants/t1/breakglass/conversations");
}

describe("GET /api/internal/ops/tenants/[id]/breakglass/conversations (Phase 20, FR-ADM-09)", () => {
  beforeEach(() => {
    requirePlatformApiMock.mockReset();
    requireActiveBreakglassTenantContextMock.mockReset();
    listConversationsForAdminMock.mockReset();
  });

  it("returns the guard's Response verbatim when unauthorized", async () => {
    const deny = new Response(null, { status: 404 });
    requirePlatformApiMock.mockResolvedValue(deny);
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "t1" }) });
    expect(res).toBe(deny);
    expect(requireActiveBreakglassTenantContextMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent tenant", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    requireActiveBreakglassTenantContextMock.mockResolvedValue(null);
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
    expect(listConversationsForAdminMock).not.toHaveBeenCalled();
  });

  it("maps a thrown BreakglassAccessDeniedError to 403 — fail-closed even with a valid operator token", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    const { BreakglassAccessDeniedError } = await import("@nextbot/contracts");
    requireActiveBreakglassTenantContextMock.mockRejectedValue(new BreakglassAccessDeniedError("no_grant"));
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(403);
    expect(listConversationsForAdminMock).not.toHaveBeenCalled();
  });

  it("returns the conversation list once the grant is active", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    const ctx = { tenantId: "t1", region: "US", environment: "Sandbox" };
    requireActiveBreakglassTenantContextMock.mockResolvedValue({ ctx, grantId: "g1" });
    listConversationsForAdminMock.mockResolvedValue({ items: [{ id: "c1" }], total: 1 });
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversations).toEqual([{ id: "c1" }]);
    expect(listConversationsForAdminMock).toHaveBeenCalledWith(ctx);
  });
});

describe("unimplemented verbs on /api/internal/ops/tenants/[id]/breakglass/conversations", () => {
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
