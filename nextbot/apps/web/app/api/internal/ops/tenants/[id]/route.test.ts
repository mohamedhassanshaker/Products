import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const requirePlatformApiMock = vi.fn();
vi.mock("@/src/lib/platform-api-guard", () => ({
  requirePlatformApi: (...a: unknown[]) => requirePlatformApiMock(...a),
}));

const getTenantOperatorSummaryMock = vi.fn();
vi.mock("@nextbot/tenancy", () => ({
  getTenantOperatorSummary: (...a: unknown[]) => getTenantOperatorSummaryMock(...a),
}));

function makeRequest() {
  return new NextRequest("http://localhost/api/internal/ops/tenants/t1");
}

describe("GET /api/internal/ops/tenants/[id] (NFR-11 Platform Manager console)", () => {
  beforeEach(() => {
    requirePlatformApiMock.mockReset();
    getTenantOperatorSummaryMock.mockReset();
  });

  it("returns the guard's Response verbatim when unauthorized", async () => {
    const deny = new Response(null, { status: 404 });
    requirePlatformApiMock.mockResolvedValue(deny);
    const { GET } = await import("./route.js");

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "t1" }) });
    expect(res).toBe(deny);
    expect(getTenantOperatorSummaryMock).not.toHaveBeenCalled();
  });

  it("returns the tenant summary once authorized", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    getTenantOperatorSummaryMock.mockResolvedValue({ id: "t1", name: "Acme Corp" });
    const { GET } = await import("./route.js");

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "t1", name: "Acme Corp" });
  });

  it("returns a 404 problem body for a nonexistent tenant id", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    getTenantOperatorSummaryMock.mockResolvedValue(null);
    const { GET } = await import("./route.js");

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("maps a thrown application-layer error through problemResponse rather than leaking it", async () => {
    requirePlatformApiMock.mockResolvedValue({ authorized: true });
    getTenantOperatorSummaryMock.mockRejectedValue(new Error("relation \"tenant\" does not exist"));
    const { GET } = await import("./route.js");

    const res = await GET(makeRequest(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    // Internal failure detail must never reach the client.
    expect(await res.text()).not.toContain("does not exist");
  });
});

/**
 * QA retry 3, Defect 1 — see `src/lib/api-not-found-response.ts`'s
 * `apiMethodNotFoundHandler` doc comment. Without these exports Next answered
 * `POST/PUT/PATCH/DELETE` with a route-existence-confirming `405` and `OPTIONS` with
 * `204 + Allow: GET, HEAD, OPTIONS`, both *before* the guard could run.
 */
describe("unimplemented verbs on /api/internal/ops/tenants/[id] (QA retry 3, Defect 1)", () => {
  it("answers POST/PUT/PATCH/DELETE/OPTIONS with the canonical nonexistent-API-path response", async () => {
    const route = (await import("./route.js")) as unknown as Record<string, () => Response>;
    const { apiNotFoundResponse } = await import("@/src/lib/api-not-found-response.js");
    const expected = apiNotFoundResponse();

    for (const verb of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const handler = route[verb];
      expect(handler, `route must export ${verb}`).toBeTypeOf("function");
      const res = (handler as () => Response)();
      expect(res.status).toBe(expected.status);
      expect([...res.headers.entries()].sort()).toEqual([...expected.headers.entries()].sort());
      expect(await res.text()).toBe("Not Found");
    }
  });

  it("does not consult the guard for an unimplemented verb (it must not depend on request state at all)", async () => {
    requirePlatformApiMock.mockReset();
    const route = (await import("./route.js")) as unknown as Record<string, () => Response>;
    (route.PUT as () => Response)();
    expect(requirePlatformApiMock).not.toHaveBeenCalled();
  });
});
