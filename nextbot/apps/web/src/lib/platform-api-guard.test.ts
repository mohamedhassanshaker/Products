import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// QA retry 2, Defect 2: `requirePlatformApi()` calls `checkRateLimit` (the same
// primitive `/internal/ops/login` already uses) — mocked here exactly like
// `actions.test.ts` mocks it, so these tests stay fast/deterministic and don't
// depend on a real Redis instance being reachable in the test environment.
const checkRateLimitMock = vi.fn();
vi.mock("./rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimitMock(...a),
}));

const { requirePlatformApi } = await import("./platform-api-guard.js");
const { apiNotFoundResponse } = await import("./api-not-found-response.js");
const { NextRequest } = await import("next/server");
const { OPS_SESSION_COOKIE } = await import("./platform-ops-auth.js");
// The catch-all Next routes every genuinely-nonexistent `/api/**` path to. Imported
// here on purpose: the whole point of the QA-retry-3 fix is that the guard's denial and
// this route's response are the SAME response, so the decisive regression test has to
// compare the two directly rather than assert each against a hand-written expectation.
const unmatchedApiRoute = await import("../../app/api/[...unmatched]/route.js");

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = ORIGINAL_FETCH;
});

function makeRequest(opts: { headers?: Record<string, string>; cookie?: string; path?: string } = {}) {
  const headers = { ...opts.headers };
  if (opts.cookie) headers["cookie"] = `${OPS_SESSION_COOKIE}=${opts.cookie}`;
  return new NextRequest(`http://localhost${opts.path ?? "/api/internal/ops/tenants"}`, { headers });
}

/** Normalizes a `Response` to a comparable, order-independent snapshot of everything
 * an attacker can observe at the application layer: status, every header, and the body
 * bytes. */
async function snapshot(res: Response) {
  return {
    status: res.status,
    headers: [...res.headers.entries()].sort(),
    body: await res.text(),
  };
}

/** Configures a fully-working ops console: token set, allowlist set, and a trusted
 * proxy declared so `extractClientIp` will honor `X-Forwarded-For` at all. */
function configureOps() {
  process.env.NEXTBOT_OPS_OPERATOR_TOKEN = "correct-token";
  process.env.NEXTBOT_OPS_IP_ALLOWLIST = "10.0.0.0/24";
  process.env.NEXTBOT_OPS_TRUSTED_PROXY_CIDRS = "203.0.113.1/32";
}

const ALLOWED_IP_HEADERS = { "x-forwarded-for": "10.0.0.42, 203.0.113.1" };

describe("requirePlatformApi", () => {
  beforeEach(() => {
    checkRateLimitMock.mockReset();
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 29, limit: 30 });
  });

  it("returns 404 for a wrong token from an allowed IP", async () => {
    configureOps();
    const req = makeRequest({ headers: { authorization: "Bearer wrong-token", ...ALLOWED_IP_HEADERS } });
    const result = await requirePlatformApi(req);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  });

  it("returns 404 for the correct token from a disallowed IP", async () => {
    configureOps();
    const req = makeRequest({ headers: { authorization: "Bearer correct-token", "x-forwarded-for": "203.0.113.99, 203.0.113.1" } });
    const result = await requirePlatformApi(req);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  });

  // QA retry 1, Defect 2 regression: reproduces QA's exact repro directly against
  // this route guard — a disallowed real caller sets X-Forwarded-For to an allowed
  // IP with no trusted proxy configured (this project's actual default deployment
  // config) and must still get the fail-closed 404, never `{ authorized: true }`.
  it("no longer authorizes a spoofed X-Forwarded-For with no trusted proxy configured (QA retry 1, Defect 2)", async () => {
    process.env.NEXTBOT_OPS_OPERATOR_TOKEN = "correct-token";
    process.env.NEXTBOT_OPS_IP_ALLOWLIST = "10.0.0.0/24";
    delete process.env.NEXTBOT_OPS_TRUSTED_PROXY_CIDRS;
    const req = makeRequest({ headers: { authorization: "Bearer correct-token", "x-forwarded-for": "10.0.0.42" } });
    const result = await requirePlatformApi(req);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  });

  it("authorizes the correct token (Authorization header) from an allowed IP once a trusted proxy is configured", async () => {
    configureOps();
    const req = makeRequest({ headers: { authorization: "Bearer correct-token", ...ALLOWED_IP_HEADERS } });
    expect(await requirePlatformApi(req)).toEqual({ authorized: true });
  });

  it("authorizes the correct token via the ops session cookie from an allowed IP once a trusted proxy is configured", async () => {
    configureOps();
    const req = makeRequest({ cookie: "correct-token", headers: ALLOWED_IP_HEADERS });
    expect(await requirePlatformApi(req)).toEqual({ authorized: true });
  });

  it("rejects a malformed Authorization header (missing 'Bearer ' prefix) even with a matching cookie absent", async () => {
    configureOps();
    const req = makeRequest({ headers: { authorization: "correct-token", ...ALLOWED_IP_HEADERS } });
    const result = await requirePlatformApi(req);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  });

  // QA retry 2, Defect 2: the Authorization-header path must also be rate-limited,
  // reusing the same `checkRateLimit` primitive as the login action — and the "rate
  // limited" outcome must be the exact same denial shape as every other denial reason.
  describe("rate limiting (QA retry 2, Defect 2)", () => {
    beforeEach(configureOps);

    it("keys the rate-limit check by the resolved caller IP, not the raw header", async () => {
      await requirePlatformApi(makeRequest({ headers: { authorization: "Bearer correct-token", ...ALLOWED_IP_HEADERS } }));
      expect(checkRateLimitMock).toHaveBeenCalledWith("ops-api:10.0.0.42", expect.any(Number), expect.any(Number));
    });

    it("denies a request (correct token, allowed IP) once the rate limit is exceeded", async () => {
      checkRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, limit: 30 });
      const result = await requirePlatformApi(makeRequest({ headers: { authorization: "Bearer correct-token", ...ALLOWED_IP_HEADERS } }));
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(404);
    });

    it("still authorizes a correct token under the rate limit", async () => {
      checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 10, limit: 30 });
      const result = await requirePlatformApi(makeRequest({ headers: { authorization: "Bearer correct-token", ...ALLOWED_IP_HEADERS } }));
      expect(result).toEqual({ authorized: true });
    });
  });

  /**
   * QA retry 3, Defect 1 — the defect that survived three fix attempts. Every earlier
   * attempt built the denial response by *imitating* Next's own not-found render
   * (hand-built, then by relaying a same-origin probe fetch of a fixed fake path, then
   * of a path derived from the caller's own), and each imitation leaked a fresh signal.
   *
   * The fix inverts the approach: the guard's denial and the response Next's catch-all
   * gives a genuinely-nonexistent `/api/**` path are now literally the same function's
   * output. These tests therefore assert *invariance and shared identity* rather than
   * resemblance — the properties that, had they held, would have caught all three of
   * the earlier bugs (a body unique to guarded denials; one body shared by all guarded
   * paths but by no real 404; a fixed probe-segment literal; a duplicated `Vary`).
   */
  describe("denial response is identical to a genuinely-nonexistent API path's (QA retry 3, Defect 1)", () => {
    const GUARDED_PATHS = [
      "/api/internal/ops/tenants",
      "/api/internal/ops/tenants/11111111-1111-1111-1111-111111111111",
      "/api/internal/ops/tenants/a",
      "/api/internal/ops/tenants/a-considerably-longer-tenant-identifier-value",
      "/api/internal/ops/audit/entries/deeper/still",
    ];

    /** Produces every distinct way the guard can deny, each as a `() => Promise<Response>`. */
    function denialScenarios(): Array<[string, () => Promise<Response>]> {
      return [
        [
          "unconfigured deployment",
          async () => {
            delete process.env.NEXTBOT_OPS_OPERATOR_TOKEN;
            delete process.env.NEXTBOT_OPS_IP_ALLOWLIST;
            return (await requirePlatformApi(makeRequest({ headers: { authorization: "Bearer whatever", ...ALLOWED_IP_HEADERS } }))) as Response;
          },
        ],
        [
          "wrong token in the Authorization header",
          async () => {
            configureOps();
            return (await requirePlatformApi(makeRequest({ headers: { authorization: "Bearer wrong-token", ...ALLOWED_IP_HEADERS } }))) as Response;
          },
        ],
        [
          "wrong token in the ops session cookie",
          async () => {
            configureOps();
            return (await requirePlatformApi(makeRequest({ cookie: "wrong-token", headers: ALLOWED_IP_HEADERS }))) as Response;
          },
        ],
        [
          "no credential at all",
          async () => {
            configureOps();
            return (await requirePlatformApi(makeRequest({ headers: ALLOWED_IP_HEADERS }))) as Response;
          },
        ],
        [
          "disallowed IP",
          async () => {
            configureOps();
            return (await requirePlatformApi(
              makeRequest({ headers: { authorization: "Bearer correct-token", "x-forwarded-for": "198.51.100.7, 203.0.113.1" } }),
            )) as Response;
          },
        ],
        [
          "rate-limited",
          async () => {
            configureOps();
            checkRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, limit: 30 });
            return (await requirePlatformApi(makeRequest({ headers: { authorization: "Bearer correct-token", ...ALLOWED_IP_HEADERS } }))) as Response;
          },
        ],
      ];
    }

    it("all six denial reasons produce one byte-identical response, matching the catch-all route's", async () => {
      const snapshots: string[] = [];
      for (const [, run] of denialScenarios()) {
        snapshots.push(JSON.stringify(await snapshot(await run())));
      }
      // Not one distinguishable-but-internally-consistent response per reason: ONE
      // response for all of them.
      expect(new Set(snapshots).size).toBe(1);
      // And that one response is exactly what a genuinely-nonexistent `/api/**` path
      // gets from `app/api/[...unmatched]/route.ts`.
      const catchAll = JSON.stringify(await snapshot(unmatchedApiRoute.GET()));
      expect(snapshots[0]).toBe(catchAll);
    });

    it("produces the identical response for five guarded paths of differing depth and segment length", async () => {
      configureOps();
      const snapshots = await Promise.all(
        GUARDED_PATHS.map(async (path) => {
          const result = await requirePlatformApi(makeRequest({ path, headers: { authorization: "Bearer wrong-token", ...ALLOWED_IP_HEADERS } }));
          return JSON.stringify(await snapshot(result as Response));
        }),
      );
      expect(new Set(snapshots).size).toBe(1);
      expect(snapshots[0]).toBe(JSON.stringify(await snapshot(apiNotFoundResponse())));
    });

    it("leaks no request-derived or probe-derived literal into the denial (rounds 2 and 3's decisive bug)", async () => {
      configureOps();
      for (const path of GUARDED_PATHS) {
        const result = await requirePlatformApi(makeRequest({ path, headers: { authorization: "Bearer wrong-token", ...ALLOWED_IP_HEADERS } }));
        const res = result as Response;
        const wire = [...res.headers.entries()].map(([k, v]) => `${k}:${v}`).join("\n") + "\n" + (await res.text());
        // No fixed probe artifact from either earlier attempt.
        expect(wire).not.toContain("__nextbot_probe_9f1c__");
        expect(wire).not.toContain("__nextbot_ops_guard_not_found_probe__");
        // No segment of the caller's own path — the denial must not echo the request
        // at all, since any echo is something to correlate against. Segments shorter
        // than 4 chars are skipped: a 1-2 char segment (`/…/a`) occurs incidentally
        // inside unrelated fixed text like `content-length`/`charset=utf-8`, so
        // asserting on it would fail for reasons that have nothing to do with echoing
        // the request. Anything long enough to actually identify a path is covered.
        for (const segment of path.split("/").filter((s) => s.length >= 4)) {
          expect(wire, `denial for ${path} must not echo the segment "${segment}"`).not.toContain(segment);
        }
        // No duplicated header name (round 3's duplicated `Vary`, an artifact of
        // composing two responses — there is no second response to compose now).
        const names = [...res.headers.keys()];
        expect(new Set(names).size).toBe(names.length);
      }
    });

    it("never performs an HTTP request to build the denial (no probe/relay to fingerprint or to fail)", async () => {
      configureOps();
      const fetchSpy = vi.fn(async () => {
        throw new Error("the guard must not make any network request");
      });
      globalThis.fetch = fetchSpy as unknown as typeof fetch;
      const result = await requirePlatformApi(makeRequest({ headers: { authorization: "Bearer wrong-token", ...ALLOWED_IP_HEADERS } }));
      expect(fetchSpy).not.toHaveBeenCalled();
      // And with no probe to fall back from, there is no degraded second shape either:
      // this is still the one canonical response.
      expect(await snapshot(result as Response)).toEqual(await snapshot(apiNotFoundResponse()));
    });
  });
});

/**
 * QA retry 3, Defect 1 — the other half of the fix. Next answers an unsupported method
 * *before* any guard code runs, so without these exports `PUT /api/internal/ops/tenants`
 * returned `405` and `OPTIONS` returned `204` with `Allow: GET, HEAD, OPTIONS, POST`,
 * both confirming the route exists to an unauthenticated caller (verified live with
 * `curl`, then re-verified fixed). Every verb on both ops routes must resolve to the
 * same response a nonexistent path gets.
 */
describe("ops route method coverage (QA retry 3, Defect 1)", () => {
  // 20s: importing a real route module pulls in its whole transitive dependency graph
  // (Drizzle, the tenancy module, TypeBox contracts), which exceeds the default 5s
  // per-test budget on a cold transform.
  it("both ops route modules export every verb that Next would otherwise answer itself", { timeout: 20_000 }, async () => {
    const tenants = await import("../../app/api/internal/ops/tenants/route.js");
    const tenantById = await import("../../app/api/internal/ops/tenants/[id]/route.js");
    // HEAD is deliberately absent: Next derives it from GET, which runs the guard.
    for (const verb of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(tenants, `tenants route must export ${verb}`).toHaveProperty(verb);
      expect(tenantById, `tenants/[id] route must export ${verb}`).toHaveProperty(verb);
    }
  });

  it("the unimplemented verbs answer with the exact nonexistent-path response", { timeout: 20_000 }, async () => {
    const tenants = (await import("../../app/api/internal/ops/tenants/route.js")) as unknown as Record<string, () => Response>;
    const tenantById = (await import("../../app/api/internal/ops/tenants/[id]/route.js")) as unknown as Record<string, () => Response>;
    const expected = JSON.stringify(await snapshot(apiNotFoundResponse()));
    for (const handler of [tenants.PUT, tenants.PATCH, tenants.DELETE, tenants.OPTIONS, tenantById.POST, tenantById.PUT, tenantById.PATCH, tenantById.DELETE, tenantById.OPTIONS]) {
      expect(JSON.stringify(await snapshot((handler as () => Response)()))).toBe(expected);
    }
  });
});
