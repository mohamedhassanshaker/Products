import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();
const getSessionTenantContextMock = vi.fn();
vi.mock("@/src/lib/session", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
  getSessionTenantContext: (...args: unknown[]) => getSessionTenantContextMock(...args),
}));

const requirePermissionMock = vi.fn();
vi.mock("@nextbot/iam", () => ({ requirePermission: (...args: unknown[]) => requirePermissionMock(...args) }));

const handleGetDeploymentsMock = vi.fn();
const handleSetTrafficSplitMock = vi.fn();
vi.mock("@nextbot/agent-platform", () => ({
  handleGetDeployments: (...args: unknown[]) => handleGetDeploymentsMock(...args),
  handleSetTrafficSplit: (...args: unknown[]) => handleSetTrafficSplitMock(...args),
}));

/**
 * Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.6, LLD §15.7) — the
 * Deployments endpoint's own guard and validation surface.
 *
 * The interesting properties here are the security ones: the endpoint is
 * unauthenticated-by-omission nowhere, GET and PUT sit at different RBAC levels, and a
 * malformed split body is rejected at the boundary rather than reaching the service.
 * The split rules themselves (sum to 100, Production precondition, cross-definition
 * rejection) are enforced in `traffic-split-service.ts` and proven against a real
 * database in `traffic-split-service.int.test.ts` — deliberately not re-asserted here
 * against a mock, which would only prove the mock.
 */
describe("GET|PUT /api/v1/admin/agent-platform/definitions/[id]/deployments", () => {
  beforeEach(() => {
    getSessionMock.mockReset().mockResolvedValue({ permissions: {}, tenantId: "tenant-1", userId: "user-1" });
    getSessionTenantContextMock.mockReset().mockResolvedValue({ tenantId: "tenant-1", region: "US", environment: "Production" });
    requirePermissionMock.mockReset();
    handleGetDeploymentsMock.mockReset().mockResolvedValue({ allocations: [], metrics: [] });
    handleSetTrafficSplitMock.mockReset().mockResolvedValue({ allocations: [] });
  });

  function request(url: string, init?: RequestInit): Request {
    return new Request(url, init);
  }

  it("GET requires agent_platform Read and defaults to the Production environment", async () => {
    const { GET } = await import("./route.js");
    const res = await GET(request("http://localhost/api") as never, { params: Promise.resolve({ id: "def-1" }) });

    expect(res.status).toBe(200);
    expect(requirePermissionMock).toHaveBeenCalledWith(expect.anything(), "agent_platform", "Read");
    expect(handleGetDeploymentsMock).toHaveBeenCalledWith(expect.anything(), "def-1", "Production");
  });

  it("GET honours an explicit, allow-listed environment and ignores an arbitrary one", async () => {
    const { GET } = await import("./route.js");
    await GET(request("http://localhost/api?environment=Staging") as never, { params: Promise.resolve({ id: "def-1" }) });
    expect(handleGetDeploymentsMock).toHaveBeenLastCalledWith(expect.anything(), "def-1", "Staging");

    // An unrecognised value falls back to Production rather than being passed through to
    // a Postgres enum cast.
    await GET(request("http://localhost/api?environment=Nonsense") as never, { params: Promise.resolve({ id: "def-1" }) });
    expect(handleGetDeploymentsMock).toHaveBeenLastCalledWith(expect.anything(), "def-1", "Production");
  });

  it("PUT requires agent_platform WRITE — a Read-level actor cannot change the split", async () => {
    const { PUT } = await import("./route.js");
    await PUT(
      request("http://localhost/api", {
        method: "PUT",
        body: JSON.stringify({ environment: "Production", allocations: [{ versionId: "11111111-1111-4111-8111-111111111111", trafficSplitPct: 100 }], reason: "ok" }),
      }) as never,
      { params: Promise.resolve({ id: "def-1" }) },
    );
    expect(requirePermissionMock).toHaveBeenCalledWith(expect.anything(), "agent_platform", "Write");
  });

  it("PUT rejects a malformed body with 422 and never reaches the service", async () => {
    const { PUT } = await import("./route.js");
    for (const body of [
      null,
      { environment: "Production", allocations: [], reason: "x" }, // empty allocations
      { environment: "Production", allocations: [{ versionId: "not-a-uuid", trafficSplitPct: 100 }], reason: "x" },
      { environment: "Production", allocations: [{ versionId: "11111111-1111-4111-8111-111111111111", trafficSplitPct: 100 }] }, // no reason
      { environment: "Production", allocations: [{ versionId: "11111111-1111-4111-8111-111111111111", trafficSplitPct: 100 }], reason: "" }, // blank reason
      { environment: "Nonsense", allocations: [{ versionId: "11111111-1111-4111-8111-111111111111", trafficSplitPct: 100 }], reason: "x" },
    ]) {
      const res = await PUT(request("http://localhost/api", { method: "PUT", body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: "def-1" }) });
      expect(res.status).toBe(422);
    }
    expect(handleSetTrafficSplitMock).not.toHaveBeenCalled();
  });

  it("PUT passes the path-scoped definition id and the acting user, never the body's own", async () => {
    const { PUT } = await import("./route.js");
    const body = {
      environment: "Production",
      allocations: [
        { versionId: "11111111-1111-4111-8111-111111111111", trafficSplitPct: 90 },
        { versionId: "22222222-2222-4222-8222-222222222222", trafficSplitPct: 10 },
      ],
      reason: "10% canary",
    };
    const res = await PUT(request("http://localhost/api", { method: "PUT", body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: "def-from-path" }) });

    expect(res.status).toBe(200);
    expect(handleSetTrafficSplitMock).toHaveBeenCalledWith(expect.anything(), "def-from-path", body, "user-1");
  });

  it("401s with no session, before any handler runs", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("./route.js");
    const res = await GET(request("http://localhost/api") as never, { params: Promise.resolve({ id: "def-1" }) });
    expect(res.status).toBe(401);
    expect(handleGetDeploymentsMock).not.toHaveBeenCalled();
  });
});
