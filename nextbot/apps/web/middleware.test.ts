import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { getMiddlewareMatchers } from "next/dist/build/analysis/get-page-static-info.js";
import { OPS_CONSOLE_INTERNAL_PREFIX, OPS_CONSOLE_PUBLIC_PREFIX } from "@/src/lib/ops-console-route";

const isPlatformOpsConfiguredMock = vi.fn();
const isRequestFromAllowedNetworkMock = vi.fn();
vi.mock("@/src/lib/platform-ops-network", () => ({
  isPlatformOpsConfigured: () => isPlatformOpsConfiguredMock(),
  isRequestFromAllowedNetwork: (...a: unknown[]) => isRequestFromAllowedNetworkMock(...a),
}));

const { middleware, config } = await import("./middleware.js");

/** Next's own name for the response header that carries a middleware-issued rewrite. Its
 * presence on a denied request is what made the previous mechanism distinguishable. */
const REWRITE_HEADER = "x-middleware-rewrite";
/** Next exposes middleware's *request*-header overrides under this response header; the
 * previous mechanism used one (`x-nb-ops-denied`) and this one must use none. */
const OVERRIDE_HEADER = "x-middleware-override-headers";

function req(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new Request("http://localhost" + path, { headers }));
}

/** Denial contexts, one per reason the gate can refuse. The pair of helpers is mocked, so
 * "unconfigured" vs "disallowed network" is the full set of shapes this file can distinguish;
 * the individual IP/proxy/session reasons are covered by `platform-ops-network`'s own tests
 * and by the live matrix recorded in `docs/plans/platform-manager-console-plan.md`. */
const DENIAL_CASES = [
  ["unconfigured deployment", false, false],
  ["configured deployment, disallowed caller network", true, false],
] as const;

describe("middleware.ts (NFR-11 page-surface Defect 1 — denial indistinguishability)", () => {
  beforeEach(() => {
    isPlatformOpsConfiguredMock.mockReset();
    isRequestFromAllowedNetworkMock.mockReset();
  });

  /**
   * QA round 5, Defect 1: the matcher must NOT be scoped to the console's prefix. Being
   * invoked costs ~+1.3 ms, so a prefix-scoped matcher made `/internal/ops/**` the one
   * slow prefix in the app and let a 5-sample median comparison find it in 40/40 trials.
   * The single broad pattern is the fix — see `middleware.ts`'s `config` doc.
   */
  it("is scoped to (nearly) the whole app, not to the console's prefix", () => {
    expect(config.matcher).toEqual(["/((?!_next/static|_next/image|favicon.ico).*)"]);
    expect(config.matcher).toHaveLength(1);
    // Nothing in the pattern may name the console: a matcher that mentions the boundary is
    // a matcher whose invocation correlates with it.
    expect(config.matcher.some((m) => m.includes("internal") || m.includes("ops"))).toBe(false);
  });

  /**
   * **The property that replaces the old `next.config.mjs` rewrite mechanism, and the reason
   * this defect's bug class is gone rather than patched.**
   *
   * The previous design denied inside middleware and relied on a *separate*, independently
   * compiled set of rewrite `source` patterns in `next.config.mjs` to turn that denial into a
   * 404. Because Next expands a middleware matcher onto axes a rewrite source never sees
   * (`.rsc`/`.json`/`.segments/…` suffixes, and a `_next/data/<id>/` prefix), the two pattern
   * sets had to be kept in exact sync by hand — and three separate misses each shipped as an
   * information leak.
   *
   * Now a denial does nothing at all: it returns a bare `NextResponse.next()` and lets Next
   * route a path that no route in this app implements. So the *only* thing that must hold is
   * "no request is answered by a console route unless middleware deliberately rewrote it
   * there" — and that is guaranteed by the route tree (asserted in
   * `src/lib/ops-console-route.test.ts`), not by any pattern matching. A shape the matcher
   * misses costs an allowed operator a spurious 404 and costs a denied caller nothing.
   */
  it.each(DENIAL_CASES)("adds nothing whatsoever to a denied request (%s)", (_label, configured, allowed) => {
    isPlatformOpsConfiguredMock.mockReturnValue(configured);
    isRequestFromAllowedNetworkMock.mockReturnValue(allowed);
    const res = middleware(req("/internal/ops/tenants"));
    expect(res.headers.get(REWRITE_HEADER)).toBeNull();
    expect(res.headers.get(OVERRIDE_HEADER)).toBeNull();
    // `x-middleware-next` is Next's own "continue routing" marker, which the router consumes
    // and never forwards to the caller. Nothing else may be present.
    expect([...res.headers.keys()]).toEqual(["x-middleware-next"]);
    expect(res.status).toBe(200);
  });

  it("denies identically for every reason, at every depth, for real and nonexistent ops paths", () => {
    const signatures = new Set<string>();
    for (const [, configured, allowed] of DENIAL_CASES) {
      isPlatformOpsConfiguredMock.mockReturnValue(configured);
      isRequestFromAllowedNetworkMock.mockReturnValue(allowed);
      for (const path of [
        "/internal/ops",
        "/internal/ops/login",
        "/internal/ops/tenants",
        "/internal/ops/tenants/new",
        "/internal/ops/tenants/abc",
        "/internal/ops/definitely-not-a-route/deeper",
      ]) {
        const res = middleware(req(path));
        signatures.add(`${res.status}|${[...res.headers.entries()].sort().join(",")}`);
      }
    }
    expect([...signatures]).toEqual(["200|x-middleware-next,1"]);
  });

  /**
   * The old mechanism read a caller-forgeable request header (`x-nb-ops-denied`) that
   * `next.config.mjs`'s `has:`/`missing:` conditions then acted on. Nothing here reads any
   * request header for the routing decision, so a caller sending the old flag — or anything
   * else — cannot influence which branch is taken.
   */
  it("ignores a forged x-nb-ops-denied header on both branches", () => {
    isPlatformOpsConfiguredMock.mockReturnValue(false);
    const denied = middleware(req("/internal/ops/tenants", { "x-nb-ops-denied": "1" }));
    expect([...denied.headers.keys()]).toEqual(["x-middleware-next"]);

    isPlatformOpsConfiguredMock.mockReturnValue(true);
    isRequestFromAllowedNetworkMock.mockReturnValue(true);
    const allowed = middleware(req("/internal/ops/tenants", { "x-nb-ops-denied": "1" }));
    expect(allowed.headers.get(REWRITE_HEADER)).toBe(`http://localhost${OPS_CONSOLE_INTERNAL_PREFIX}/tenants`);
  });

  it("rewrites an allowed operator's request onto the console's real route path", () => {
    isPlatformOpsConfiguredMock.mockReturnValue(true);
    isRequestFromAllowedNetworkMock.mockReturnValue(true);
    for (const tail of ["", "/login", "/tenants", "/tenants/new", "/tenants/abc"]) {
      const res = middleware(req(`${OPS_CONSOLE_PUBLIC_PREFIX}${tail}`));
      expect(res.headers.get(REWRITE_HEADER)).toBe(`http://localhost${OPS_CONSOLE_INTERNAL_PREFIX}${tail}`);
    }
  });

  it("preserves the query string when rewriting an allowed request", () => {
    isPlatformOpsConfiguredMock.mockReturnValue(true);
    isRequestFromAllowedNetworkMock.mockReturnValue(true);
    const res = middleware(req("/internal/ops/tenants?q=acme&page=2"));
    expect(res.headers.get(REWRITE_HEADER)).toBe(`http://localhost${OPS_CONSOLE_INTERNAL_PREFIX}/tenants?q=acme&page=2`);
  });

  /**
   * The console's real route path must not be addressable from outside, and the response for
   * one must not depend on the gate — otherwise a caller who guessed it would have an
   * authorization oracle. Both branches rewrite it back onto the public prefix, which has no
   * route, so it 404s identically for everyone.
   */
  it("neutralizes a direct request for the internal route path, identically for allowed and denied callers", () => {
    const signatures = new Set<string>();
    for (const [configured, allowed] of [
      [false, false],
      [true, false],
      [true, true],
    ] as const) {
      isPlatformOpsConfiguredMock.mockReturnValue(configured);
      isRequestFromAllowedNetworkMock.mockReturnValue(allowed);
      const res = middleware(req(`${OPS_CONSOLE_INTERNAL_PREFIX}/tenants`));
      signatures.add(`${res.status}|${[...res.headers.entries()].sort().join(",")}`);
    }
    expect(signatures.size).toBe(1);
    expect([...signatures][0]).toContain(`x-middleware-rewrite,http://localhost${OPS_CONSOLE_PUBLIC_PREFIX}/tenants`);
  });

  /**
   * QA round 5, Defect 2. The router percent-decodes a pathname before matching it against the
   * route tree, but middleware sees the escapes — so an escaped spelling of the internal prefix
   * used to slip past the neutralization above and reach the real console route, answering from
   * a different code path (a cacheable `s-maxage` 404 when denied, the doubled-prefix rewrite
   * when allowed: an authorization oracle for anyone who already knew the secret segment).
   * Every spelling must now collapse onto the one plain-internal-path response, gate-independently.
   */
  it("neutralizes an escaped spelling of the internal route path, identically for every caller", () => {
    const secretSegment = OPS_CONSOLE_INTERNAL_PREFIX.slice(OPS_CONSOLE_PUBLIC_PREFIX.length + 1);
    const escapedSpellings = [
      // the secret segment's own characters escaped
      `${OPS_CONSOLE_PUBLIC_PREFIX}/${secretSegment.replaceAll("-", "%2D")}/tenants`,
      // a character escaped outside the secret segment entirely
      `/internal/o%70s/${secretSegment}/tenants`,
    ];
    const signatures = new Set<string>();
    for (const path of escapedSpellings) {
      for (const [configured, allowed] of [
        [false, false],
        [true, false],
        [true, true],
      ] as const) {
        isPlatformOpsConfiguredMock.mockReturnValue(configured);
        isRequestFromAllowedNetworkMock.mockReturnValue(allowed);
        const res = middleware(req(path));
        // Rewritten onto the routeless public path — the same target the plain internal
        // spelling gets, so the responses are byte-identical rather than merely similar.
        expect(res.headers.get(REWRITE_HEADER), path).toBe(`http://localhost${OPS_CONSOLE_PUBLIC_PREFIX}/tenants`);
        signatures.add(`${res.status}|${[...res.headers.entries()].sort().join(",")}`);
      }
    }
    expect(signatures.size).toBe(1);
  });

  it("leaves a double-escaped spelling alone, so it 404s like any other missing path", () => {
    isPlatformOpsConfiguredMock.mockReturnValue(false);
    // Decoding once (what the router does too) yields a path that matches no route; folding it
    // in would mean chasing arbitrarily-deep encodings the router never resolves.
    const res = middleware(req(`${OPS_CONSOLE_PUBLIC_PREFIX}/nb%252Dc%252D4f21c8a7e3d9b605/tenants`));
    expect([...res.headers.keys()]).toEqual(["x-middleware-next"]);
  });

  it("does not throw on a malformed escape sequence", () => {
    isPlatformOpsConfiguredMock.mockReturnValue(false);
    for (const path of [`${OPS_CONSOLE_PUBLIC_PREFIX}/%zz`, `${OPS_CONSOLE_PUBLIC_PREFIX}/%`, "/%E0%A4%A"]) {
      expect(() => middleware(req(path)), path).not.toThrow();
    }
  });

  it("does not treat a sibling of the internal prefix as internal", () => {
    isPlatformOpsConfiguredMock.mockReturnValue(false);
    // `…605x` merely starts with the same characters; it is a nonexistent public path and must
    // be left alone like any other, not rewritten as if it were the internal one.
    const res = middleware(req(`${OPS_CONSOLE_INTERNAL_PREFIX}x/tenants`));
    expect([...res.headers.keys()]).toEqual(["x-middleware-next"]);
  });

  /**
   * Since round 5 the matcher sends the *whole app* here, so this is the common case rather
   * than a belt-and-braces one: a real route, a missing path and an API path must all come
   * out with nothing added, exactly like a denied console request does.
   */
  it("does nothing for any path outside the console's public prefix", () => {
    isPlatformOpsConfiguredMock.mockReturnValue(true);
    isRequestFromAllowedNetworkMock.mockReturnValue(true);
    for (const path of ["/", "/login", "/internal", "/internal/opsx", "/api/internal/ops/tenants", "/nothing"]) {
      const res = middleware(req(path));
      expect([...res.headers.keys()], path).toEqual(["x-middleware-next"]);
    }
  });

  /**
   * QA round 5, Defect 1 (second half). Once the matcher was broadened, evaluating the gate
   * became the *only* work ops paths did that no other path did — worth ~+0.7 ms p50 on a real
   * production build, still enough for a 5-sample median classifier. So the gate is now
   * evaluated unconditionally, before anything branches on the path: every request in the app
   * pays for it, and only the return value differs. A regression that moves this call back
   * behind a path check re-opens the oracle, so it is asserted here rather than left to a
   * comment.
   */
  it("evaluates the network gate exactly once for every request, whatever the path", () => {
    isPlatformOpsConfiguredMock.mockReturnValue(true);
    isRequestFromAllowedNetworkMock.mockReturnValue(true);
    for (const path of [
      "/",
      "/login",
      "/api/definitely-not-a-route",
      "/internal/opsx",
      "/nothing",
      `${OPS_CONSOLE_INTERNAL_PREFIX}/tenants`,
      "/internal/ops/tenants",
    ]) {
      isRequestFromAllowedNetworkMock.mockClear();
      middleware(req(path));
      expect(isRequestFromAllowedNetworkMock, path).toHaveBeenCalledTimes(1);
    }
  });

  /**
   * The internal-prefix branch stays gate-*independent* in its answer (asserted above) while
   * still paying the gate's cost like everything else — the two properties are separate and
   * both required.
   */
  it("does not let the gate's result change the internal-path answer", () => {
    const targets = new Set<string | null>();
    for (const allowed of [true, false]) {
      isPlatformOpsConfiguredMock.mockReturnValue(allowed);
      isRequestFromAllowedNetworkMock.mockReturnValue(allowed);
      targets.add(middleware(req(`${OPS_CONSOLE_INTERNAL_PREFIX}/tenants`)).headers.get(REWRITE_HEADER));
    }
    expect([...targets]).toEqual([`http://localhost${OPS_CONSOLE_PUBLIC_PREFIX}/tenants`]);
  });
});

/**
 * The matcher has two jobs now: make sure an *allowed operator's* request reaches the rewrite
 * (including in the transport forms Next itself invents), and — since QA round 5's timing
 * oracle — make sure it is invoked just as readily for everything else, so that invocation
 * cost carries no information about where the console lives. These tests compile the matcher
 * with the exact function that produces `.next/server/middleware-manifest.json`, so a Next
 * upgrade that changes the expansion fails here instead of going unnoticed.
 *
 * Note what is deliberately *not* asserted any more: there is no second pattern set to prove
 * exhaustive against. `next.config.test.ts`'s coverage suite (and its `stripNextDataPrefix()`
 * helper, which QA correctly found was self-fulfilling on exactly the axis that leaked) was
 * removed with the mechanism it tested.
 */
describe("middleware matcher expansion (operator reachability + invocation uniformity)", () => {
  const matcherRegexes = getMiddlewareMatchers(config.matcher, {}).map(
    (m: { regexp: string }) => new RegExp(m.regexp),
  );
  const matches = (path: string) => matcherRegexes.some((re) => re.test(path));

  it("covers the console's public paths in every transport form Next generates", () => {
    for (const base of [OPS_CONSOLE_PUBLIC_PREFIX, `${OPS_CONSOLE_PUBLIC_PREFIX}/tenants`, `${OPS_CONSOLE_PUBLIC_PREFIX}/tenants/new`]) {
      for (const suffix of ["", ".rsc", ".json", ".segments/__PAGE__.segment.rsc"]) {
        expect(matches(`${base}${suffix}`), `${base}${suffix}`).toBe(true);
        expect(matches(`/_next/data/build-id-xyz${base}${suffix}`), `_next/data ${base}${suffix}`).toBe(true);
      }
    }
  });

  it("covers the internal route path so a direct request for it can be neutralized", () => {
    expect(matches(OPS_CONSOLE_INTERNAL_PREFIX)).toBe(true);
    expect(matches(`${OPS_CONSOLE_INTERNAL_PREFIX}/tenants`)).toBe(true);
  });

  /**
   * The heart of the round-5 fix: every path an attacker could use as a timing *control* must
   * be invoked too. Each entry below is a shape QA's classifier compared `/internal/ops/**`
   * against — near-miss prefixes, unrelated missing paths, real routes, the API surface, and
   * the `_next/data` transport form of a missing page. If any of these were unmatched, its
   * cheaper responses would re-create the oracle from the other side.
   */
  it("also covers every non-console path a caller could use as a timing control", () => {
    for (const path of [
      "/",
      "/login",
      "/internal",
      "/internal/op",
      "/internal/opsx",
      "/internal/ops-x/tenants",
      "/internal/xps/tenants",
      "/internal/zzz/tenants",
      "/admin/nothing",
      "/nothing-here-at-all",
      `${OPS_CONSOLE_INTERNAL_PREFIX}x/tenants`,
      "/api/internal/ops/tenants",
      "/api/definitely-not-a-route",
      "/_next/data/build-id-xyz/internal/xps/tenants.json",
    ]) {
      expect(matches(path), path).toBe(true);
    }
  });

  /**
   * The only exclusions, and the reason they cannot leak: neither namespace holds a console
   * route, and both are excluded for ops and non-ops paths alike, so the exclusion boundary is
   * uncorrelated with the security boundary. They exist purely so the app's asset traffic
   * doesn't pay a middleware invocation per request.
   */
  it("excludes only the static-asset namespaces, for ops and non-ops paths alike", () => {
    for (const path of [
      "/_next/static/chunks/main-abc123.js",
      "/_next/static/css/abc123.css",
      `/_next/static/chunks/app${OPS_CONSOLE_INTERNAL_PREFIX}/login/page-abc.js`,
      "/_next/static/chunks/app/internal/ops/login/page-abc.js",
      "/_next/image",
      "/favicon.ico",
    ]) {
      expect(matches(path), path).toBe(false);
    }
  });
});
