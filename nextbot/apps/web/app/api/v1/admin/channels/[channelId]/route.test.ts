import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();
const getSessionTenantContextMock = vi.fn();
vi.mock("@/src/lib/session", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
  getSessionTenantContext: (...args: unknown[]) => getSessionTenantContextMock(...args),
}));

const requirePermissionMock = vi.fn();
vi.mock("@nextbot/iam", () => ({
  requirePermission: (...args: unknown[]) => requirePermissionMock(...args),
}));

const findChannelByIdMock = vi.fn();
const handleSetChannelAgentBindingMock = vi.fn();
vi.mock("@nextbot/channels", () => ({
  findChannelById: (...args: unknown[]) => findChannelByIdMock(...args),
  handleSetChannelAgentBinding: (...args: unknown[]) => handleSetChannelAgentBindingMock(...args),
}));

const resolveTenantByIdMock = vi.fn();
vi.mock("@nextbot/tenancy", () => ({
  resolveTenantById: (...args: unknown[]) => resolveTenantByIdMock(...args),
}));

describe("GET /api/v1/admin/channels/[channelId] (Phase 6: single-channel lookup for the 'test this channel' screen)", () => {
  beforeEach(() => {
    getSessionMock.mockReset().mockResolvedValue({ permissions: {}, tenantId: "tenant-1" });
    getSessionTenantContextMock.mockReset().mockResolvedValue({ tenantId: "tenant-1", region: "eu", environment: "Production" });
    requirePermissionMock.mockReset();
    findChannelByIdMock.mockReset();
    handleSetChannelAgentBindingMock.mockReset().mockResolvedValue({ channelId: "c1", agentDefinitionId: null });
    resolveTenantByIdMock.mockReset().mockResolvedValue({ slug: "acme" });
    delete process.env.NEXTBOT_WIDGET_BASE_URL;
  });

  it("returns the channel + tenantSlug + widgetBaseUrl for a real channel", async () => {
    findChannelByIdMock.mockResolvedValue({ id: "c1", type: "WebWidget", name: "Main", environment: "Production", status: "Active", publicKey: "wc_1" });
    const { GET } = await import("./route.js");

    const res = await GET(new Request("http://localhost"), { params: Promise.resolve({ channelId: "c1" }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channel.publicKey).toBe("wc_1");
    expect(body.tenantSlug).toBe("acme");
    expect(body.widgetBaseUrl).toBe("http://localhost:8080");
  });

  it("404s for an unknown/cross-tenant channel id rather than leaking any detail", async () => {
    findChannelByIdMock.mockResolvedValue(null);
    const { GET } = await import("./route.js");

    const res = await GET(new Request("http://localhost"), { params: Promise.resolve({ channelId: "nope" }) });

    expect(res.status).toBe(404);
  });

  it("401s with no session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("./route.js");

    const res = await GET(new Request("http://localhost"), { params: Promise.resolve({ channelId: "c1" }) });

    expect(res.status).toBe(401);
    expect(findChannelByIdMock).not.toHaveBeenCalled();
  });
});

/**
 * Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.2, LLD §15.7) — the
 * channel→agent-definition binding ("Answered by"), the missing first hop of
 * `channel -> agent definition -> deployment traffic split -> version`.
 */
describe("PATCH /api/v1/admin/channels/[channelId] (Phase 17: the agent-definition binding)", () => {
  beforeEach(() => {
    getSessionMock.mockReset().mockResolvedValue({ permissions: {}, tenantId: "tenant-1", userId: "user-1" });
    getSessionTenantContextMock.mockReset().mockResolvedValue({ tenantId: "tenant-1", region: "eu", environment: "Production" });
    requirePermissionMock.mockReset();
    findChannelByIdMock.mockReset().mockResolvedValue({ id: "c1", type: "WebWidget", name: "Main" });
    handleSetChannelAgentBindingMock.mockReset().mockResolvedValue({ channelId: "c1", agentDefinitionId: null });
  });

  function patch(body: unknown): Request {
    return new Request("http://localhost", { method: "PATCH", body: JSON.stringify(body) });
  }

  it("requires channels WRITE — binding a channel to a bot is a mutating action, not a read", async () => {
    const { PATCH } = await import("./route.js");
    await PATCH(patch({ agentDefinitionId: "11111111-1111-4111-8111-111111111111" }), { params: Promise.resolve({ channelId: "c1" }) });
    expect(requirePermissionMock).toHaveBeenCalledWith(expect.anything(), "channels", "Write");
  });

  it("accepts an explicit null — unbinding is a first-class choice, returning the channel to the tenant-wide fallback", async () => {
    const { PATCH } = await import("./route.js");
    const res = await PATCH(patch({ agentDefinitionId: null }), { params: Promise.resolve({ channelId: "c1" }) });

    expect(res.status).toBe(200);
    expect(handleSetChannelAgentBindingMock).toHaveBeenCalledWith(expect.anything(), "c1", null);
  });

  it("rejects a malformed body with 422 and never reaches the writer", async () => {
    const { PATCH } = await import("./route.js");
    for (const body of [{}, { agentDefinitionId: "not-a-uuid" }, { agentDefinitionId: 42 }]) {
      const res = await PATCH(patch(body), { params: Promise.resolve({ channelId: "c1" }) });
      expect(res.status).toBe(422);
    }
    expect(handleSetChannelAgentBindingMock).not.toHaveBeenCalled();
  });

  it("404s for an unknown/cross-tenant channel id rather than writing anything", async () => {
    findChannelByIdMock.mockResolvedValue(null);
    const { PATCH } = await import("./route.js");
    const res = await PATCH(patch({ agentDefinitionId: null }), { params: Promise.resolve({ channelId: "nope" }) });

    expect(res.status).toBe(404);
    expect(handleSetChannelAgentBindingMock).not.toHaveBeenCalled();
  });

  it("401s with no session, before any lookup or write", async () => {
    getSessionMock.mockResolvedValue(null);
    const { PATCH } = await import("./route.js");
    const res = await PATCH(patch({ agentDefinitionId: null }), { params: Promise.resolve({ channelId: "c1" }) });

    expect(res.status).toBe(401);
    expect(findChannelByIdMock).not.toHaveBeenCalled();
    expect(handleSetChannelAgentBindingMock).not.toHaveBeenCalled();
  });
});
