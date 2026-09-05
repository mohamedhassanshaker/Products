import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

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

const handleSimulateMock = vi.fn();
vi.mock("@nextbot/authz", () => ({
  handleSimulate: (...args: unknown[]) => handleSimulateMock(...args),
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/admin/authz/simulate", { method: "POST", body: JSON.stringify(body) });
}

/**
 * `POST /api/v1/admin/authz/simulate` (LLD §14.2.7, RBAC: security_settings:Read)
 * — unit-level route test (mocked application/session layer, matching this
 * directory's own established convention). The real evaluator/ref-resolution
 * proof lives in `packages/modules/authz/src/application/simulate-service.int.test.ts`
 * against real Postgres — this file proves the route wiring: the RBAC gate, the
 * request-shape validation, and that the caller's own session-derived `ctx` is
 * what's passed through.
 */
describe("POST /api/v1/admin/authz/simulate", () => {
  beforeEach(() => {
    getSessionMock.mockReset().mockResolvedValue({ permissions: {} });
    getSessionTenantContextMock.mockReset().mockResolvedValue({ tenantId: "tenant-1", region: "US", environment: "Production" });
    requirePermissionMock.mockReset();
    handleSimulateMock.mockReset();
  });

  it("delegates to handleSimulate with the caller's own tenant context", async () => {
    handleSimulateMock.mockResolvedValue({ decision: "Allow", trace: [], scopeHash: "abc" });
    const { POST } = await import("./route.js");

    const body = { chain: [{ ref: "inline", scope: { origin: "AgentVersion", originId: "v1", originLabel: "v1" } }] };
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(200);
    expect(requirePermissionMock).toHaveBeenCalledWith({}, "security_settings", "Read");
    expect(handleSimulateMock).toHaveBeenCalledWith({ tenantId: "tenant-1", region: "US", environment: "Production" }, body);
  });

  it("401s with no session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { POST } = await import("./route.js");
    const res = await POST(makeRequest({ chain: [] }));
    expect(res.status).toBe(401);
    expect(handleSimulateMock).not.toHaveBeenCalled();
  });

  it("403s (fail-closed) when the caller lacks security_settings:Read", async () => {
    const { ForbiddenModuleError } = await import("@nextbot/contracts");
    requirePermissionMock.mockImplementation(() => {
      throw new ForbiddenModuleError("security_settings", "Read");
    });
    const { POST } = await import("./route.js");
    const res = await POST(makeRequest({ chain: [{ ref: "inline", scope: { origin: "AgentVersion", originId: "v1", originLabel: "v1" } }] }));
    expect(res.status).toBe(403);
    expect(handleSimulateMock).not.toHaveBeenCalled();
  });

  it("422s a malformed request body (missing required chain) before ever calling the evaluator", async () => {
    const { POST } = await import("./route.js");
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(422);
    expect(handleSimulateMock).not.toHaveBeenCalled();
  });
});
