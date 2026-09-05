import { describe, expect, it, vi, beforeEach } from "vitest";
import { ConnectorNotFoundError, SessionInvalidError } from "@nextbot/contracts";
import { McpTransportError } from "@nextbot/mcp-client";

// "server-only" unconditionally throws unless imported through Next's own webpack
// build (its whole purpose is a build-time guard against a client bundle
// accidentally pulling in server code) — vitest has no such build step, so it must
// be stubbed to a no-op for this file to be unit-testable at all outside `next build`.
vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();
const getSessionTenantContextMock = vi.fn();
vi.mock("./session", () => ({
  getSession: () => getSessionMock(),
  getSessionTenantContext: (...a: unknown[]) => getSessionTenantContextMock(...a),
}));

const { problemResponse, requireApi } = await import("./api-guard.js");

describe("requireApi (composition-root RBAC guard)", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    getSessionTenantContextMock.mockReset();
  });

  it("returns a 401 Response when there is no session", async () => {
    getSessionMock.mockResolvedValue(null);
    const result = await requireApi("connectors", "Read");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("returns a 403 Response when the session lacks the required permission", async () => {
    getSessionMock.mockResolvedValue({ tenantId: "t1", userId: "u1", roleIds: [], permissions: { connectors: "Read" } });
    const result = await requireApi("connectors", "Write");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it("returns { session, ctx } when the session has sufficient permission", async () => {
    const session = { tenantId: "t1", userId: "u1", roleIds: [], permissions: { connectors: "Write" } };
    getSessionMock.mockResolvedValue(session);
    getSessionTenantContextMock.mockResolvedValue({ tenantId: "t1", region: "US", environment: "Sandbox" });
    const result = await requireApi("connectors", "Write");
    expect(result).not.toBeInstanceOf(Response);
    expect((result as { session: unknown }).session).toBe(session);
  });
});

/**
 * `problemResponse()` is the pure error->HTTP mapping half of this module (the
 * RBAC-guard half, `requireApi()`, is exercised end-to-end by the manual curl smoke
 * test run against a real `next build`/`next start` during this dispatch — see the
 * plan/decision log — since it depends on Next's `cookies()`/route-handler runtime,
 * which isn't meaningfully unit-testable without a live server).
 */
describe("problemResponse (RFC 9457 error mapping)", () => {
  it("maps a DomainError to its declared httpStatus/code", async () => {
    const res = problemResponse(new ConnectorNotFoundError("c1"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("CONNECTOR_NOT_FOUND");
  });

  it("maps SessionInvalidError to 401", async () => {
    const res = problemResponse(new SessionInvalidError());
    expect(res.status).toBe(401);
  });

  it("maps McpTransportError to 502 with the verbatim message (FR-MCP-02)", async () => {
    const res = problemResponse(new McpTransportError("upstream said no"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.title).toBe("upstream said no");
  });

  it("maps an unknown error to a generic 500 without leaking its message", async () => {
    const res = problemResponse(new Error("some internal secret detail"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.title).not.toContain("some internal secret detail");
  });
});
