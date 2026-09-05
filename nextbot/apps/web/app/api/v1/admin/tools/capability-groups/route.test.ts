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

const handleListCapabilityGroupsWithToolCountsMock = vi.fn();
vi.mock("@nextbot/tool-registry", () => ({
  handleListCapabilityGroupsWithToolCounts: (...args: unknown[]) => handleListCapabilityGroupsWithToolCountsMock(...args),
}));

/**
 * `GET /api/v1/admin/tools/capability-groups` (Phase 10, client-feedback-batch item
 * 8) — unit-level route test (mocked application/session layer, matching this
 * directory's own established convention — see sibling `channels/[channelId]/
 * route.test.ts`). The real, DB-backed tenant-isolation proof lives in
 * `capability-group-repository.int.test.ts` (one layer down, against a real
 * Postgres) — this file only proves the route wiring itself: the RBAC gate, the
 * response shape, and that the caller's own session-derived `ctx` (never anything
 * client-supplied) is what's passed through.
 */
describe("GET /api/v1/admin/tools/capability-groups", () => {
  beforeEach(() => {
    getSessionMock.mockReset().mockResolvedValue({ permissions: {} });
    getSessionTenantContextMock.mockReset().mockResolvedValue({ tenantId: "tenant-1", region: "US", environment: "Production" });
    requirePermissionMock.mockReset();
    handleListCapabilityGroupsWithToolCountsMock.mockReset();
  });

  it("returns the caller's own tenant's capability groups on a tool_permissions=Read caller", async () => {
    handleListCapabilityGroupsWithToolCountsMock.mockResolvedValue([{ id: "g1", name: "billing", guidanceText: null, priorityWeight: 50, toolCount: 2 }]);
    const { GET } = await import("./route.js");

    const res = await GET();

    expect(res.status).toBe(200);
    expect(requirePermissionMock).toHaveBeenCalledWith({}, "tool_permissions", "Read");
    // The tenant context passed to the application layer comes from the caller's own
    // resolved session, never anything the request itself could influence — there is
    // no request body/query param this route even reads.
    expect(handleListCapabilityGroupsWithToolCountsMock).toHaveBeenCalledWith({ tenantId: "tenant-1", region: "US", environment: "Production" });
    const body = await res.json();
    expect(body.capabilityGroups).toEqual([{ id: "g1", name: "billing", guidanceText: null, priorityWeight: 50, toolCount: 2 }]);
  });

  it("401s with no session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("./route.js");
    const res = await GET();
    expect(res.status).toBe(401);
    expect(handleListCapabilityGroupsWithToolCountsMock).not.toHaveBeenCalled();
  });

  it("403s (fail-closed) when the caller lacks tool_permissions=Read, never falling back to returning data anyway", async () => {
    const { ForbiddenModuleError } = await import("@nextbot/contracts");
    requirePermissionMock.mockImplementation(() => {
      throw new ForbiddenModuleError("tool_permissions", "Read");
    });
    const { GET } = await import("./route.js");
    const res = await GET();
    expect(res.status).toBe(403);
    expect(handleListCapabilityGroupsWithToolCountsMock).not.toHaveBeenCalled();
  });
});
