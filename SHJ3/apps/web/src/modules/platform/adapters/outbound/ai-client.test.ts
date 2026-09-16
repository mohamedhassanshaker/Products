import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithTenant, type Principal } from "../../tenancy/tenant-context.js";
import { assertValidSlugShape } from "../../tenancy/tenant-slug.js";
import { AiServiceError, createAiClient, createTenantScopedAiClient } from "./ai-client.js";

/**
 * Tests for the internal API client.
 *
 * Two properties are load-bearing and neither is visible from the happy path.
 *
 * **Trace propagation.** One trace id must span web → ai → tool call (api.md §1.6), and it
 * has to come from the bound context rather than be generated here — otherwise a
 * provisioning run and the graph and vector work it triggers appear as three unrelated
 * traces in B14 tab 3, which is the difference between observability and decoration.
 *
 * **Error containment.** api.md §2.2 forbids vendor text, vendor status codes, upstream
 * URLs and internal hostnames in anything that can reach a client. This client is a
 * *consumer* of the internal API, so it is exactly where that rule gets broken by accident
 * — the easy implementation attaches the response body to an `Error` and lets it
 * propagate. The tests below force Neo4j and Qdrant messages through it and assert they do
 * not survive.
 *
 * Covers FR-PLAT-02.
 */

const SEWA = assertValidSlugShape("sewa");
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Provisioning runs inside a platform-scoped context, which is where the trace id lives. */
function inProvisioningContext<T>(fn: () => Promise<T>): Promise<T> {
  return runWithTenant(
    { tenant: SEWA, principal: null, traceId: TRACE, platformScope: "provisioning" },
    fn,
  );
}

const STAFF_PRINCIPAL: Principal = {
  id: "STAFF0000000000000000001",
  tenant: SEWA,
  displayName: "Sara Al Mazrouei",
  roles: ["agent_designer"],
  permissions: new Set(["agents:manage"]),
  assurance: "L1",
};

/** A tenant-scoped backoffice request, with a real bound principal. */
function inStaffContext<T>(fn: () => Promise<T>): Promise<T> {
  return runWithTenant({ tenant: SEWA, principal: STAFF_PRINCIPAL, traceId: TRACE }, fn);
}

beforeEach(() => {
  process.env.SHJ3_AI_BASE_URL = "http://ai.internal:8000";
  process.env.SHJ3_AI_PLATFORM_TOKEN = "test-platform-token";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SHJ3_AI_BASE_URL;
  delete process.env.SHJ3_AI_PLATFORM_TOKEN;
});

describe("request shape", () => {
  it("posts JSON to the internal API prefix", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(200, { verified: true }));
    const client = createAiClient({ fetch });

    await inProvisioningContext(() => client.post("/internal/provisioning/graph/verify", {}));

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://ai.internal:8000/v1/internal/provisioning/graph/verify");
    expect(init.method).toBe("POST");
  });

  it("does not double the slash when the base URL has a trailing one", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = createAiClient({ baseUrl: "http://ai.internal:8000/", fetch });

    await inProvisioningContext(() => client.post("/internal/provisioning/graph/verify", {}));

    expect(fetch.mock.calls[0]![0]).toBe(
      "http://ai.internal:8000/v1/internal/provisioning/graph/verify",
    );
  });

  it("carries the bound trace id as a traceparent, so one trace spans the hop", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = createAiClient({ fetch });

    await inProvisioningContext(() => client.post("/internal/provisioning/graph/verify", {}));

    const headers = fetch.mock.calls[0]![1].headers;
    expect(headers.traceparent).toContain(TRACE);
    expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(headers["X-Request-Id"]).toBe(TRACE);
  });

  it("normalises a non-hex trace id rather than sending a malformed traceparent", async () => {
    // A ULID request id is not hex, and a malformed traceparent is dropped silently by
    // some collectors. Correlation still holds through X-Request-Id.
    const fetch = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = createAiClient({ fetch });

    await runWithTenant(
      {
        tenant: SEWA,
        principal: null,
        traceId: "01JBQ7X2K9ZZZZZZZZZZZZZZZZ",
        platformScope: "provisioning",
      },
      () => client.post("/internal/provisioning/graph/verify", {}),
    );

    const headers = fetch.mock.calls[0]![1].headers;
    expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(headers["X-Request-Id"]).toBe("01JBQ7X2K9ZZZZZZZZZZZZZZZZ");
  });

  it("presents the platform-scope credential", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = createAiClient({ fetch });

    await inProvisioningContext(() => client.post("/internal/provisioning/graph/verify", {}));

    const headers = fetch.mock.calls[0]![1].headers;
    expect(headers["X-SHJ3-Platform-Token"]).toBe("test-platform-token");
    expect(headers["X-SHJ3-Platform-Scope"]).toBe("provisioning");
  });

  it("does not send a tenant header, because provisioning acts on a tenant not as one", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = createAiClient({ fetch });

    await inProvisioningContext(() =>
      client.post("/internal/provisioning/graph/verify", { tenantSlug: SEWA }),
    );

    const [, init] = fetch.mock.calls[0]!;
    expect(init.headers["X-SHJ3-Tenant-Id"]).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ tenantSlug: "sewa" });
  });

  it("refuses to call unauthenticated when no credential is configured", async () => {
    // Provisioning is one of only two sanctioned cross-tenant paths (ADR-0002 rule 5) and
    // is not permitted to run without a credential.
    delete process.env.SHJ3_AI_PLATFORM_TOKEN;
    const fetch = vi.fn();
    const client = createAiClient({ fetch });

    await expect(
      inProvisioningContext(() => client.post("/internal/provisioning/graph/verify", {})),
    ).rejects.toThrow(/SHJ3_AI_PLATFORM_TOKEN/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails at first use when the base URL is absent", async () => {
    delete process.env.SHJ3_AI_BASE_URL;
    const client = createAiClient({ fetch: vi.fn() });

    await expect(
      inProvisioningContext(() => client.post("/internal/provisioning/graph/verify", {})),
    ).rejects.toThrow(/SHJ3_AI_BASE_URL/);
  });

  it("refuses to call with no bound context, so an untraced hop is impossible", async () => {
    const client = createAiClient({ fetch: vi.fn() });

    await expect(client.post("/internal/provisioning/graph/verify", {})).rejects.toThrow(
      /No tenant context bound/,
    );
  });
});

describe("error containment", () => {
  it("forwards a stable SHJ3 code", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(503, { code: "knowledge.graph_unavailable", status: 503 }));
    const client = createAiClient({ fetch });

    await expect(
      inProvisioningContext(() => client.post("/internal/provisioning/graph/create", {})),
    ).rejects.toMatchObject({ code: "knowledge.graph_unavailable", status: 503 });
  });

  it("unwraps FastAPI's real default envelope, {detail: {code, ...}}", async () => {
    // A real bug this wave's own live browser verification found: every `apps/ai` route
    // raises `HTTPException(status_code=..., detail={"code": ...})`, and Starlette's
    // default handler serialises that as `{"detail": {"code": ...}}` — not api.md §2.1's
    // flat `{code, ...}` shape this client was, until this fix, the only one written
    // against. Confirmed against the real running `tools_router.py`, not assumed.
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse(502, {
        detail: { code: "tools.mcp_connect_failed", meta: { reason: "tls" } },
      }),
    );
    const client = createTenantScopedAiClient({ fetch });

    const error = await inStaffContext(() =>
      client.post("/tools/mcp/servers/srv_1/connect", {}).catch((caught: unknown) => caught),
    );

    expect((error as { code?: unknown }).code).toBe("tools.mcp_connect_failed");
    expect((error as AiServiceError).mcpConnectFailureReason).toBe("tls");
  });

  it("drops vendor text rather than carrying it on the error", async () => {
    // The failure this test exists for: a Neo4j message reaching a problem document's
    // `detail` lets a caller fingerprint the store (api.md §2.4).
    const vendor = "Neo4j::ClientError Unable to acquire connection to bolt://neo4j-0:7687";
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(503, { code: "knowledge.graph_unavailable", detail: vendor }),
      );
    const client = createAiClient({ fetch });

    const error = await inProvisioningContext(() =>
      client.post("/internal/provisioning/graph/create", {}).catch((caught: unknown) => caught),
    );

    expect(error).toBeInstanceOf(AiServiceError);
    expect((error as Error).message).not.toContain(vendor);
    expect((error as Error).message).not.toContain("bolt://");
    expect((error as Error).message).toContain(TRACE);
  });

  it("refuses a code that did not come from our error serialiser", async () => {
    // `Qdrant: 404 Not Found` is not an SHJ3 code, so forwarding it would put vendor text
    // where a client branches on a contract value.
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(502, { code: "Qdrant: 404 Not Found — collection missing" }));
    const client = createAiClient({ fetch });

    await expect(
      inProvisioningContext(() => client.post("/internal/provisioning/vector/create", {})),
    ).rejects.toMatchObject({ code: "upstream.invalid_response" });
  });

  it("falls back by status when the body is not a problem document", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    const client = createAiClient({ fetch });

    await expect(
      inProvisioningContext(() => client.post("/internal/provisioning/graph/create", {})),
    ).rejects.toMatchObject({ code: "upstream.invalid_response" });
  });

  it("distinguishes a timeout from an unreachable service", async () => {
    // The operator response differs — wait, versus check whether the service is up — so
    // the two are different codes rather than one generic failure.
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    const timedOut = createAiClient({ fetch: vi.fn().mockRejectedValue(timeout) });
    const refused = createAiClient({
      fetch: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    });

    await expect(
      inProvisioningContext(() => timedOut.post("/internal/provisioning/graph/create", {})),
    ).rejects.toMatchObject({ code: "upstream.timeout", status: 504 });

    await expect(
      inProvisioningContext(() => refused.post("/internal/provisioning/graph/create", {})),
    ).rejects.toMatchObject({ code: "upstream.unavailable", status: 503 });
  });

  it("does not name the upstream host in the error", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new TypeError("fetch failed for http://ai.internal:8000"));
    const client = createAiClient({ fetch });

    const error = await inProvisioningContext(() =>
      client.post("/internal/provisioning/graph/create", {}).catch((caught: unknown) => caught),
    );

    expect((error as Error).message).not.toContain("ai.internal");
  });

  it("aborts on the configured timeout rather than hanging the provisioning run", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = createAiClient({ fetch, timeoutMs: 1234 });

    await inProvisioningContext(() => client.post("/internal/provisioning/graph/verify", {}));

    expect(fetch.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });

  it("ignores an unusable timeout rather than throwing a RangeError mid-provisioning", async () => {
    // A mistyped env var should degrade to the default, not crash the run with an opaque
    // error from AbortSignal.timeout.
    process.env.SHJ3_AI_TIMEOUT_MS = "sixty seconds";
    const fetch = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = createAiClient({ fetch });

    await expect(
      inProvisioningContext(() => client.post("/internal/provisioning/graph/verify", {})),
    ).resolves.toEqual({});

    delete process.env.SHJ3_AI_TIMEOUT_MS;
  });
});

describe("createTenantScopedAiClient", () => {
  it("presents the bound principal's identity, not the platform credential", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = createTenantScopedAiClient({ fetch });

    await inStaffContext(() => client.post("/tools/mcp/servers/srv_1/connect", {}));

    const headers = fetch.mock.calls[0]![1].headers;
    expect(headers["X-SHJ3-Tenant-Id"]).toBe("sewa");
    expect(headers["X-SHJ3-Principal-Id"]).toBe(STAFF_PRINCIPAL.id);
    expect(headers["X-SHJ3-Permissions"]).toBe("agents:manage");
    expect(headers["X-SHJ3-Platform-Token"]).toBeUndefined();
    expect(headers["X-SHJ3-Platform-Scope"]).toBeUndefined();
  });

  it("still carries the same trace propagation as the platform-scoped client", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = createTenantScopedAiClient({ fetch });

    await inStaffContext(() => client.post("/tools/mcp/servers/srv_1/connect", {}));

    const headers = fetch.mock.calls[0]![1].headers;
    expect(headers.traceparent).toContain(TRACE);
    expect(headers["X-Request-Id"]).toBe(TRACE);
  });

  it("rejects rather than throws synchronously when no principal is bound", async () => {
    const client = createTenantScopedAiClient({ fetch: vi.fn() });

    await expect(
      inProvisioningContext(() => client.post("/tools/mcp/servers/srv_1/connect", {})),
    ).rejects.toThrow(/requires an authenticated principal/);
  });

  it("still contains vendor errors the same way the platform-scoped client does", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse(502, {
        code: "tools.mcp_connect_failed",
        detail: "ECONNREFUSED 10.0.0.9:443",
      }),
    );
    const client = createTenantScopedAiClient({ fetch });

    const error = await inStaffContext(() =>
      client.post("/tools/mcp/servers/srv_1/connect", {}).catch((caught: unknown) => caught),
    );

    expect(error).toBeInstanceOf(AiServiceError);
    expect((error as Error).message).not.toContain("ECONNREFUSED");
    expect((error as { code?: unknown }).code).toBe("tools.mcp_connect_failed");
  });

  it("carries the validated meta.reason for tools.mcp_connect_failed", async () => {
    // api.md §5.6's one documented, stable field beyond `code` for this error — read here,
    // not part of the general anti-leak drop this same describe block's other tests prove.
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(502, { code: "tools.mcp_connect_failed", meta: { reason: "tls" } }),
      );
    const client = createTenantScopedAiClient({ fetch });

    const error = await inStaffContext(() =>
      client.post("/tools/mcp/servers/srv_1/connect", {}).catch((caught: unknown) => caught),
    );

    expect((error as AiServiceError).mcpConnectFailureReason).toBe("tls");
  });

  it("drops an out-of-vocabulary meta.reason rather than trusting it", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse(502, {
        code: "tools.mcp_connect_failed",
        meta: { reason: "the-server-said-something-weird" },
      }),
    );
    const client = createTenantScopedAiClient({ fetch });

    const error = await inStaffContext(() =>
      client.post("/tools/mcp/servers/srv_1/connect", {}).catch((caught: unknown) => caught),
    );

    expect((error as AiServiceError).mcpConnectFailureReason).toBeUndefined();
  });

  it("never sets mcpConnectFailureReason for a different code", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(502, { code: "tools.mcp_discovery_empty", meta: { reason: "tls" } }),
      );
    const client = createTenantScopedAiClient({ fetch });

    const error = await inStaffContext(() =>
      client.post("/tools/mcp/servers/srv_1/connect", {}).catch((caught: unknown) => caught),
    );

    expect((error as AiServiceError).mcpConnectFailureReason).toBeUndefined();
  });
});
