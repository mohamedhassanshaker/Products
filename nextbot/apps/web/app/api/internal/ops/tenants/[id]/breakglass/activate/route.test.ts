import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const requirePlatformApiMock = vi.fn();
vi.mock("@/src/lib/platform-api-guard", () => ({
  requirePlatformApi: (...a: unknown[]) => requirePlatformApiMock(...a),
}));

const activateBreakglassAccessMock = vi.fn();
vi.mock("@nextbot/tenancy", () => ({
  activateBreakglassAccess: (...a: unknown[]) => activateBreakglassAccessMock(...a),
}));

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/internal/ops/tenants/t1/breakglass/activate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/internal/ops/tenants/[id]/breakglass/activate (Phase 20, FR-ADM-09)", () => {
  beforeEach(() => {
    requirePlatformApiMock.mockReset();
    activateBreakglassAccessMock.mockReset();
  });

  it("returns the guard's Response verbatim when unauthorized", async () => {
    const deny = new Response(null, { status: 404 });
    requirePlatformApiMock.mockResolvedValue(deny);
    const { POST } = await import("./route.js");
    const res = await POST(makeRequest({ reason: "diagnosis" }), { params: Promise.resolve({ id: "t1" }) });
    expect(res).toBe(deny);
    expect(activateBreakglassAccessMock).not.toHaveBeenCalled();
  });

  it("rejects a missing reason with 422 before calling the application layer", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    const { POST } = await import("./route.js");
    const res = await POST(makeRequest({}), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(422);
    expect(activateBreakglassAccessMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent tenant", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    activateBreakglassAccessMock.mockResolvedValue(null);
    const { POST } = await import("./route.js");
    const res = await POST(makeRequest({ reason: "diagnosis" }), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns 200 with the grant/expiry on success", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    activateBreakglassAccessMock.mockResolvedValue({ grantId: "g1", expiresAt: new Date("2026-01-01T00:00:00Z") });
    const { POST } = await import("./route.js");
    const res = await POST(makeRequest({ reason: "diagnosis" }), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grantId).toBe("g1");
    expect(activateBreakglassAccessMock).toHaveBeenCalledWith("t1", "platform-operator", "diagnosis");
  });

  it("maps a thrown BreakglassAccessDeniedError to a 403, never a raw 500", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    const { BreakglassAccessDeniedError } = await import("@nextbot/contracts");
    activateBreakglassAccessMock.mockRejectedValue(new BreakglassAccessDeniedError("no_grant"));
    const { POST } = await import("./route.js");
    const res = await POST(makeRequest({ reason: "diagnosis" }), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(403);
  });

  it("never leaks an unexpected error's message", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    activateBreakglassAccessMock.mockRejectedValue(new Error("connection terminated"));
    const { POST } = await import("./route.js");
    const res = await POST(makeRequest({ reason: "diagnosis" }), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.text()).not.toContain("connection terminated");
  });
});

describe("unimplemented verbs on /api/internal/ops/tenants/[id]/breakglass/activate", () => {
  it("answers GET/PUT/PATCH/DELETE/OPTIONS with the canonical nonexistent-API-path response", async () => {
    const route = (await import("./route.js")) as unknown as Record<string, () => Response>;
    const { apiNotFoundResponse } = await import("@/src/lib/api-not-found-response.js");
    const expected = apiNotFoundResponse();
    for (const verb of ["GET", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const res = (route[verb] as () => Response)();
      expect(res.status).toBe(expected.status);
      expect(await res.text()).toBe("Not Found");
    }
  });
});
