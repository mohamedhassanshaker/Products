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

const getConversationDetailForAdminMock = vi.fn();
vi.mock("@nextbot/conversations", () => ({
  getConversationDetailForAdmin: (...a: unknown[]) => getConversationDetailForAdminMock(...a),
}));

function makeRequest() {
  return new NextRequest("http://localhost/api/internal/ops/tenants/t1/breakglass/conversations/c1");
}

describe("GET /api/internal/ops/tenants/[id]/breakglass/conversations/[conversationId] (Phase 20, FR-ADM-09)", () => {
  beforeEach(() => {
    requirePlatformApiMock.mockReset();
    requireActiveBreakglassTenantContextMock.mockReset();
    getConversationDetailForAdminMock.mockReset();
  });

  it("returns the guard's Response verbatim when unauthorized", async () => {
    const deny = new Response(null, { status: 404 });
    requirePlatformApiMock.mockResolvedValue(deny);
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "t1", conversationId: "c1" }) });
    expect(res).toBe(deny);
  });

  it("maps a thrown BreakglassAccessDeniedError to 403", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    const { BreakglassAccessDeniedError } = await import("@nextbot/contracts");
    requireActiveBreakglassTenantContextMock.mockRejectedValue(new BreakglassAccessDeniedError("revoked"));
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "t1", conversationId: "c1" }) });
    expect(res.status).toBe(403);
  });

  it("returns 404 when the conversation doesn't resolve within this tenant", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    requireActiveBreakglassTenantContextMock.mockResolvedValue({ ctx: { tenantId: "t1" }, grantId: "g1" });
    getConversationDetailForAdminMock.mockResolvedValue(null);
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "t1", conversationId: "c1" }) });
    expect(res.status).toBe(404);
  });

  it("returns the conversation detail once the grant is active", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    const ctx = { tenantId: "t1" };
    requireActiveBreakglassTenantContextMock.mockResolvedValue({ ctx, grantId: "g1" });
    getConversationDetailForAdminMock.mockResolvedValue({ id: "c1", messages: [] });
    const { GET } = await import("./route.js");
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "t1", conversationId: "c1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversation).toEqual({ id: "c1", messages: [] });
    expect(getConversationDetailForAdminMock).toHaveBeenCalledWith(ctx, "c1");
  });
});

describe("unimplemented verbs on /api/internal/ops/tenants/[id]/breakglass/conversations/[conversationId]", () => {
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
