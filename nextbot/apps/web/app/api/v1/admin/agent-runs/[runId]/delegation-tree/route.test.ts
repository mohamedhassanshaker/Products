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

const handleGetDelegationTreeMock = vi.fn();
vi.mock("@nextbot/teams", () => ({
  handleGetDelegationTree: (...args: unknown[]) => handleGetDelegationTreeMock(...args),
}));

/**
 * `GET /api/v1/admin/agent-runs/{runId}/delegation-tree` (LLD §14.7.5, RBAC:
 * agent_platform:Read) — unit-level route test (mocked application/session
 * layer). The real read-path proof against real Postgres lives in
 * `packages/modules/teams/src/application/delegation-tree-service.int.test.ts`.
 */
describe("GET /api/v1/admin/agent-runs/[runId]/delegation-tree", () => {
  beforeEach(() => {
    getSessionMock.mockReset().mockResolvedValue({ permissions: {} });
    getSessionTenantContextMock.mockReset().mockResolvedValue({ tenantId: "tenant-1", region: "US", environment: "Production" });
    requirePermissionMock.mockReset();
    handleGetDelegationTreeMock.mockReset();
  });

  it("delegates to handleGetDelegationTree with the caller's own tenant context and the path's runId", async () => {
    handleGetDelegationTreeMock.mockResolvedValue({ agentRunId: "run-1", roots: [] });
    const { GET } = await import("./route.js");

    const res = await GET(new Request("http://localhost"), { params: Promise.resolve({ runId: "run-1" }) });

    expect(res.status).toBe(200);
    expect(requirePermissionMock).toHaveBeenCalledWith({}, "agent_platform", "Read");
    expect(handleGetDelegationTreeMock).toHaveBeenCalledWith({ tenantId: "tenant-1", region: "US", environment: "Production" }, "run-1");
    const body = await res.json();
    expect(body).toEqual({ agentRunId: "run-1", roots: [] });
  });

  it("401s with no session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("./route.js");
    const res = await GET(new Request("http://localhost"), { params: Promise.resolve({ runId: "run-1" }) });
    expect(res.status).toBe(401);
    expect(handleGetDelegationTreeMock).not.toHaveBeenCalled();
  });

  it("403s (fail-closed) when the caller lacks agent_platform:Read", async () => {
    const { ForbiddenModuleError } = await import("@nextbot/contracts");
    requirePermissionMock.mockImplementation(() => {
      throw new ForbiddenModuleError("agent_platform", "Read");
    });
    const { GET } = await import("./route.js");
    const res = await GET(new Request("http://localhost"), { params: Promise.resolve({ runId: "run-1" }) });
    expect(res.status).toBe(403);
    expect(handleGetDelegationTreeMock).not.toHaveBeenCalled();
  });
});
