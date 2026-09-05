import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const requirePlatformApiMock = vi.fn();
vi.mock("@/src/lib/platform-api-guard", () => ({
  requirePlatformApi: (...a: unknown[]) => requirePlatformApiMock(...a),
}));

const updateTenantStatusMock = vi.fn();
vi.mock("@nextbot/tenancy", () => ({
  updateTenantStatus: (...a: unknown[]) => updateTenantStatusMock(...a),
}));

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/internal/ops/tenants/t1/status", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/internal/ops/tenants/[id]/status (NFR-11 Platform Manager console)", () => {
  beforeEach(() => {
    requirePlatformApiMock.mockReset();
    updateTenantStatusMock.mockReset();
  });

  it("returns the guard's Response verbatim when unauthorized", async () => {
    const deny = new Response(null, { status: 404 });
    requirePlatformApiMock.mockResolvedValue(deny);
    const { PATCH } = await import("./route.js");

    const res = await PATCH(makeRequest({ status: "Suspended" }), { params: Promise.resolve({ id: "t1" }) });
    expect(res).toBe(deny);
    expect(updateTenantStatusMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid status value with 422 before calling the application layer", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    const { PATCH } = await import("./route.js");

    const res = await PATCH(makeRequest({ status: "Deleted" }), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(422);
    expect(updateTenantStatusMock).not.toHaveBeenCalled();
  });

  it("applies a valid status change once authorized", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    updateTenantStatusMock.mockResolvedValue({ id: "t1", status: "Suspended" });
    const { PATCH } = await import("./route.js");

    const res = await PATCH(makeRequest({ status: "Suspended" }), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "t1", status: "Suspended" });
    expect(updateTenantStatusMock).toHaveBeenCalledWith("t1", "Suspended", expect.any(String));
  });

  it("returns a 404 problem body for a nonexistent tenant id", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    updateTenantStatusMock.mockResolvedValue(null);
    const { PATCH } = await import("./route.js");

    const res = await PATCH(makeRequest({ status: "Active" }), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("maps a thrown application-layer error through problemResponse rather than leaking it", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    updateTenantStatusMock.mockRejectedValue(new Error("connection terminated"));
    const { PATCH } = await import("./route.js");

    const res = await PATCH(makeRequest({ status: "Active" }), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.text()).not.toContain("connection terminated");
  });
});

describe("unimplemented verbs on /api/internal/ops/tenants/[id]/status", () => {
  it("answers GET/POST/PUT/DELETE/OPTIONS with the canonical nonexistent-API-path response", async () => {
    const route = (await import("./route.js")) as unknown as Record<string, () => Response>;
    const { apiNotFoundResponse } = await import("@/src/lib/api-not-found-response.js");
    const expected = apiNotFoundResponse();

    for (const verb of ["GET", "POST", "PUT", "DELETE", "OPTIONS"]) {
      const handler = route[verb];
      expect(handler, `route must export ${verb}`).toBeTypeOf("function");
      const res = (handler as () => Response)();
      expect(res.status).toBe(expected.status);
      expect(await res.text()).toBe("Not Found");
    }
  });

  it("does not consult the guard for an unimplemented verb", async () => {
    requirePlatformApiMock.mockReset();
    const route = (await import("./route.js")) as unknown as Record<string, () => Response>;
    (route.PUT as () => Response)();
    expect(requirePlatformApiMock).not.toHaveBeenCalled();
  });
});
