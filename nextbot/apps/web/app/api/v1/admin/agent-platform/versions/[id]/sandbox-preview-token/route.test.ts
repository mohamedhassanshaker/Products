import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Phase 6 (client-feedback-batch item 9), SECURITY-CRITICAL: this route is the ONLY
 * place a sandbox-preview token is ever minted, and it must never issue one without
 * a real, verified `agent_platform: Write` Admin Console session. Mocks only the
 * session/RBAC/service-layer seams (same convention as this directory's sibling
 * `bind-eval-suite/route.test.ts`) so the real `requireApi` RBAC-guard logic and this
 * route's own wiring both run for real.
 */
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
  issueSandboxPreviewToken: (...args: unknown[]) => issueSandboxPreviewTokenMock(...args),
}));
const issueSandboxPreviewTokenMock = vi.fn();

const handleGetVersionMock = vi.fn();
vi.mock("@nextbot/agent-platform", () => ({
  handleGetVersion: (...args: unknown[]) => handleGetVersionMock(...args),
}));

function tokenRequest(): NextRequest {
  return new NextRequest("http://localhost/api/v1/admin/agent-platform/versions/version-1/sandbox-preview-token", {
    method: "POST",
  });
}

describe("POST /api/v1/admin/agent-platform/versions/[id]/sandbox-preview-token", () => {
  beforeEach(() => {
    getSessionMock.mockReset().mockResolvedValue({ permissions: {}, tenantId: "tenant-1", userId: "user-1" });
    getSessionTenantContextMock.mockReset().mockResolvedValue({ tenantId: "tenant-1", region: "eu", environment: "Sandbox" });
    requirePermissionMock.mockReset(); // no-op = permission granted
    handleGetVersionMock.mockReset().mockResolvedValue({ id: "version-1" });
    issueSandboxPreviewTokenMock.mockReset().mockResolvedValue("signed-preview-token");
  });

  it("ACCEPTED: a real agent_platform:Write session mints a token scoped to the caller's own tenant/user/version", async () => {
    const { POST } = await import("./route.js");

    const res = await POST(tokenRequest(), { params: Promise.resolve({ id: "version-1" }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.previewToken).toBe("signed-preview-token");
    expect(body.versionId).toBe("version-1");
    expect(issueSandboxPreviewTokenMock).toHaveBeenCalledWith("tenant-1", "user-1", "version-1");
    // Ownership check happens before minting — a version id belonging to another
    // tenant would 404 out of `handleGetVersion` (RLS-scoped) before this line runs.
    expect(handleGetVersionMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-1" }), "version-1", "user-1");
  });

  it("REJECTED: returns 401 with no session at all, and never mints a token", async () => {
    getSessionMock.mockResolvedValue(null);
    const { POST } = await import("./route.js");

    const res = await POST(tokenRequest(), { params: Promise.resolve({ id: "version-1" }) });

    expect(res.status).toBe(401);
    expect(issueSandboxPreviewTokenMock).not.toHaveBeenCalled();
  });

  it("REJECTED: returns 403 with a real session that lacks agent_platform:Write, and never mints a token", async () => {
    const { ForbiddenModuleError } = await import("@nextbot/contracts");
    requirePermissionMock.mockImplementation(() => {
      throw new ForbiddenModuleError("agent_platform", "Write");
    });
    const { POST } = await import("./route.js");

    const res = await POST(tokenRequest(), { params: Promise.resolve({ id: "version-1" }) });

    expect(res.status).toBe(403);
    expect(issueSandboxPreviewTokenMock).not.toHaveBeenCalled();
  });

  it("REJECTED: a version id that doesn't belong to (or doesn't exist for) this tenant never reaches token issuance", async () => {
    const { DomainError } = await import("@nextbot/contracts");
    class VersionNotFoundError extends DomainError {
      readonly code = "VERSION_NOT_FOUND";
      readonly httpStatus = 404;
      constructor() {
        super("Version not found.");
      }
    }
    handleGetVersionMock.mockRejectedValue(new VersionNotFoundError());
    const { POST } = await import("./route.js");

    const res = await POST(tokenRequest(), { params: Promise.resolve({ id: "someone-elses-version" }) });

    expect(res.status).toBe(404);
    expect(issueSandboxPreviewTokenMock).not.toHaveBeenCalled();
  });
});
