import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const requirePlatformApiMock = vi.fn();
vi.mock("@/src/lib/platform-api-guard", () => ({
  requirePlatformApi: (...a: unknown[]) => requirePlatformApiMock(...a),
}));

const listAllTenantsMock = vi.fn();
vi.mock("@nextbot/tenancy", () => ({
  listAllTenants: (...a: unknown[]) => listAllTenantsMock(...a),
}));

const listConnectorsMock = vi.fn();
const getConnectorHealthSummaryMock = vi.fn();
vi.mock("@nextbot/connectors", () => ({
  listConnectors: (...a: unknown[]) => listConnectorsMock(...a),
  getConnectorHealthSummary: (...a: unknown[]) => getConnectorHealthSummaryMock(...a),
}));

function makeRequest() {
  return new NextRequest("http://localhost/api/internal/ops/health-rollup");
}

describe("/api/internal/ops/health-rollup (NFR-11 Platform Manager console, Phase 3)", () => {
  beforeEach(() => {
    requirePlatformApiMock.mockReset();
    listAllTenantsMock.mockReset();
    listConnectorsMock.mockReset();
    getConnectorHealthSummaryMock.mockReset();
  });

  describe("GET", () => {
    it("returns the guard's Response verbatim when unauthorized, without touching tenancy/connectors", async () => {
      const deny = new Response("Not Found", { status: 404 });
      requirePlatformApiMock.mockResolvedValue(deny);
      const { GET } = await import("./route.js");

      expect(await GET(makeRequest())).toBe(deny);
      expect(listAllTenantsMock).not.toHaveBeenCalled();
      expect(listConnectorsMock).not.toHaveBeenCalled();
    });

    it("joins each tenant's connectors with a health summary, constructing a Sandbox TenantContext per tenant", async () => {
      requirePlatformApiMock.mockResolvedValue({ authorized: true });
      listAllTenantsMock.mockResolvedValue([
        { id: "t1", name: "Acme Corp", slug: "acme-corp", region: "US" },
        { id: "t2", name: "Globex", slug: "globex", region: "EU" },
      ]);
      listConnectorsMock.mockImplementation(async (ctx: { tenantId: string }) => {
        if (ctx.tenantId === "t1") {
          return [{ id: "c1", name: "Salesforce", status: "Degraded" }];
        }
        return [];
      });
      getConnectorHealthSummaryMock.mockResolvedValue({
        connectorId: "c1",
        callVolume: 10,
        errorRatePct: 20,
        p50LatencyMs: 100,
        p95LatencyMs: 200,
        p99LatencyMs: 300,
        sparkline: [
          { checkedAt: new Date("2026-08-19T00:00:00Z"), ok: false, latencyMs: null },
          { checkedAt: new Date("2026-08-19T01:00:00Z"), ok: true, latencyMs: 90 },
        ],
      });
      const { GET } = await import("./route.js");

      const res = await GET(makeRequest());
      expect(res.status).toBe(200);
      const body = (await res.json()) as { connectors: unknown[] };
      expect(body.connectors).toEqual([
        {
          tenantId: "t1",
          tenantName: "Acme Corp",
          tenantSlug: "acme-corp",
          connectorId: "c1",
          connectorName: "Salesforce",
          status: "Degraded",
          lastCheckedAt: "2026-08-19T01:00:00.000Z",
          lastCheckOk: true,
          errorRatePct: 20,
          recentErrorCount: 1,
          callVolume: 10,
        },
      ]);

      expect(listConnectorsMock).toHaveBeenCalledWith({ tenantId: "t1", region: "US", environment: "Sandbox" });
      expect(listConnectorsMock).toHaveBeenCalledWith({ tenantId: "t2", region: "EU", environment: "Sandbox" });
      expect(getConnectorHealthSummaryMock).toHaveBeenCalledWith(
        { tenantId: "t1", region: "US", environment: "Sandbox" },
        "c1",
      );
    });

    it("returns an empty connectors list, never null/undefined access errors, when a connector has never been probed", async () => {
      requirePlatformApiMock.mockResolvedValue({ authorized: true });
      listAllTenantsMock.mockResolvedValue([{ id: "t1", name: "Acme Corp", slug: "acme-corp", region: "US" }]);
      listConnectorsMock.mockResolvedValue([{ id: "c1", name: "Salesforce", status: "Offline" }]);
      getConnectorHealthSummaryMock.mockResolvedValue({
        connectorId: "c1",
        callVolume: 0,
        errorRatePct: 0,
        p50LatencyMs: null,
        p95LatencyMs: null,
        p99LatencyMs: null,
        sparkline: [],
      });
      const { GET } = await import("./route.js");

      const res = await GET(makeRequest());
      const body = (await res.json()) as { connectors: Array<Record<string, unknown>> };
      expect(body.connectors[0]).toMatchObject({ lastCheckedAt: null, lastCheckOk: null, status: "Offline" });
    });

    it("returns an empty connectors list when there are no tenants at all", async () => {
      requirePlatformApiMock.mockResolvedValue({ authorized: true });
      listAllTenantsMock.mockResolvedValue([]);
      const { GET } = await import("./route.js");

      const res = await GET(makeRequest());
      expect(await res.json()).toEqual({ connectors: [] });
      expect(listConnectorsMock).not.toHaveBeenCalled();
    });

    it("never includes a conversation/message-shaped key anywhere in the response (NFR-11)", async () => {
      requirePlatformApiMock.mockResolvedValue({ authorized: true });
      listAllTenantsMock.mockResolvedValue([{ id: "t1", name: "Acme Corp", slug: "acme-corp", region: "US" }]);
      listConnectorsMock.mockResolvedValue([{ id: "c1", name: "Salesforce", status: "Connected" }]);
      getConnectorHealthSummaryMock.mockResolvedValue({
        connectorId: "c1",
        callVolume: 1,
        errorRatePct: 0,
        p50LatencyMs: 1,
        p95LatencyMs: 1,
        p99LatencyMs: 1,
        sparkline: [{ checkedAt: new Date(), ok: true, latencyMs: 1 }],
      });
      const { GET } = await import("./route.js");

      const res = await GET(makeRequest());
      const bodyText = await res.text();
      for (const forbiddenKey of ["message", "content", "toolCall", "conversationId", "payload", "transcript"]) {
        expect(bodyText.toLowerCase()).not.toContain(forbiddenKey.toLowerCase());
      }
    });

    it("maps a thrown application-layer error through problemResponse rather than leaking it", async () => {
      requirePlatformApiMock.mockResolvedValue({ authorized: true });
      listAllTenantsMock.mockRejectedValue(new Error("database is on fire"));
      const { GET } = await import("./route.js");

      const res = await GET(makeRequest());
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await res.text()).not.toContain("database is on fire");
    });
  });

  /**
   * QA retry 3, Defect 1 (Phase 1). Next answers an unsupported method before any route
   * code runs, so an unexported verb would confirm this route's existence to a
   * completely unauthenticated caller.
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
      expect(requirePlatformApiMock).not.toHaveBeenCalled();
    });
  });
});
