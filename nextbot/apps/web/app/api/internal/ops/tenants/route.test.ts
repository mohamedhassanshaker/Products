import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const requirePlatformApiMock = vi.fn();
vi.mock("@/src/lib/platform-api-guard", () => ({
  requirePlatformApi: (...a: unknown[]) => requirePlatformApiMock(...a),
}));

const listAllTenantsMock = vi.fn();
const provisionTenantMock = vi.fn();
vi.mock("@nextbot/tenancy", () => ({
  listAllTenants: (...a: unknown[]) => listAllTenantsMock(...a),
  provisionTenant: (...a: unknown[]) => provisionTenantMock(...a),
}));

/** `NextRequest`'s own init type — deliberately not the DOM `RequestInit`, whose
 * `signal?: AbortSignal | null` is incompatible with Next's `AbortSignal | undefined`. */
type NextRequestInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;

function makeRequest(init?: NextRequestInit) {
  return new NextRequest("http://localhost/api/internal/ops/tenants", init);
}

/** A body satisfying `ProvisionTenantRequestSchema` — the real (unmocked) TypeBox
 * contract is used, so this doubles as a check that the route's validation accepts a
 * legitimate payload rather than only that it rejects a bad one. */
const VALID_PROVISION_BODY = { name: "Acme Corp", slug: "acme-corp", region: "US", planTier: "Starter", defaultLanguage: "en" };

function jsonRequest(body: unknown) {
  return makeRequest({ method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

describe("/api/internal/ops/tenants (NFR-11 Platform Manager console)", () => {
  beforeEach(() => {
    requirePlatformApiMock.mockReset();
    listAllTenantsMock.mockReset();
    provisionTenantMock.mockReset();
  });

  describe("GET", () => {
    it("returns the guard's Response verbatim when unauthorized, without touching the tenancy module", async () => {
      const deny = new Response("Not Found", { status: 404 });
      requirePlatformApiMock.mockResolvedValue(deny);
      const { GET } = await import("./route.js");

      expect(await GET(makeRequest())).toBe(deny);
      expect(listAllTenantsMock).not.toHaveBeenCalled();
    });

    it("returns the tenant list once authorized", async () => {
      requirePlatformApiMock.mockResolvedValue({ authorized: true });
      listAllTenantsMock.mockResolvedValue([{ id: "t1", name: "Acme Corp" }]);
      const { GET } = await import("./route.js");

      const res = await GET(makeRequest());
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ tenants: [{ id: "t1", name: "Acme Corp" }] });
    });

    it("maps a thrown application-layer error through problemResponse rather than leaking it", async () => {
      requirePlatformApiMock.mockResolvedValue({ authorized: true });
      listAllTenantsMock.mockRejectedValue(new Error("database is on fire"));
      const { GET } = await import("./route.js");

      const res = await GET(makeRequest());
      expect(res.status).toBeGreaterThanOrEqual(400);
      // The internal failure detail must never reach the client (full detail goes to
      // the server-side log instead).
      expect(await res.text()).not.toContain("database is on fire");
    });
  });

  describe("POST", () => {
    it("returns the guard's Response verbatim when unauthorized, without provisioning anything", async () => {
      const deny = new Response("Not Found", { status: 404 });
      requirePlatformApiMock.mockResolvedValue(deny);
      const { POST } = await import("./route.js");

      expect(await POST(jsonRequest(VALID_PROVISION_BODY))).toBe(deny);
      expect(provisionTenantMock).not.toHaveBeenCalled();
    });

    it("422s a body that fails the ProvisionTenantRequest contract", async () => {
      requirePlatformApiMock.mockResolvedValue({ authorized: true });
      const { POST } = await import("./route.js");

      const res = await POST(jsonRequest({ name: "" }));
      expect(res.status).toBe(422);
      expect(provisionTenantMock).not.toHaveBeenCalled();
    });

    it("422s a malformed (non-JSON) body instead of throwing", async () => {
      requirePlatformApiMock.mockResolvedValue({ authorized: true });
      const { POST } = await import("./route.js");

      const res = await POST(makeRequest({ method: "POST", body: "not json at all", headers: { "content-type": "application/json" } }));
      expect(res.status).toBe(422);
      expect(provisionTenantMock).not.toHaveBeenCalled();
    });

    it("provisions the tenant attributed to the shared platform-operator actor label and 201s", async () => {
      requirePlatformApiMock.mockResolvedValue({ authorized: true });
      provisionTenantMock.mockResolvedValue({ id: "t9", ...VALID_PROVISION_BODY });
      const { POST } = await import("./route.js");
      const { PLATFORM_OPERATOR_ACTOR_LABEL } = await import("@/src/lib/platform-ops-auth.js");

      const res = await POST(jsonRequest(VALID_PROVISION_BODY));
      expect(res.status).toBe(201);
      expect(provisionTenantMock).toHaveBeenCalledWith(expect.objectContaining({ slug: "acme-corp" }), PLATFORM_OPERATOR_ACTOR_LABEL);
    });

    it("maps a thrown provisioning error through problemResponse rather than leaking it", async () => {
      requirePlatformApiMock.mockResolvedValue({ authorized: true });
      provisionTenantMock.mockRejectedValue(new Error("duplicate key value violates unique constraint"));
      const { POST } = await import("./route.js");

      const res = await POST(jsonRequest(VALID_PROVISION_BODY));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await res.text()).not.toContain("duplicate key");
    });
  });

  /**
   * QA retry 3, Defect 1. Next answers an unsupported method *before* any route code
   * runs, so an unexported verb previously made this route confirm its own existence to
   * a completely unauthenticated caller: `PUT` returned `405`, and `OPTIONS` returned
   * `204` with `Allow: GET, HEAD, OPTIONS, POST`. Both are as decisive a leak as a
   * distinguishable denial body, and neither is reachable from inside
   * `requirePlatformApi()`. Each unimplemented verb must answer exactly as a
   * nonexistent `/api/**` path does.
   */
  describe("unimplemented verbs (QA retry 3, Defect 1)", () => {
    it("answers PUT/PATCH/DELETE/OPTIONS with the canonical nonexistent-API-path response", async () => {
      const route = (await import("./route.js")) as unknown as Record<string, () => Response>;
      const { apiNotFoundResponse } = await import("@/src/lib/api-not-found-response.js");
      const expected = apiNotFoundResponse();

      for (const verb of ["PUT", "PATCH", "DELETE", "OPTIONS"]) {
        const handler = route[verb];
        expect(handler, `route must export ${verb}`).toBeTypeOf("function");
        const res = (handler as () => Response)();
        expect(res.status).toBe(expected.status);
        expect([...res.headers.entries()].sort()).toEqual([...expected.headers.entries()].sort());
        expect(await res.text()).toBe("Not Found");
      }
      // The guard is never consulted for these — they must not depend on it at all.
      expect(requirePlatformApiMock).not.toHaveBeenCalled();
    });
  });
});
