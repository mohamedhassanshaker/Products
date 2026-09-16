import { describe, expect, it } from "vitest";
import { tryGetTenantContext } from "../../../platform/tenancy/tenant-context.js";
import type { TenantSlug } from "../../../platform/tenancy/tenant-slug.js";
import { ResolveCitizenSession } from "../../application/resolve-citizen-session.js";
import { ResolveSession } from "../../application/resolve-session.js";
import { SEEDED_ROLE_PERMISSIONS } from "../../domain/permissions.js";
import { ANONYMOUS_ASSURANCE } from "../../domain/assurance.js";
import { CITIZEN_SESSION_TTL, STAFF_SESSION_TTL } from "../../domain/session.js";
import {
  FakeClock,
  FakeCredentialRepository,
  FakeEnrolmentTokenIssuer,
  FakePasswordHasher,
  FakeSecurityPolicyRepository,
  FakeTenantRegistry,
  FakeUserRepository,
  InMemoryChallengeStore,
  InMemoryReplayGuard,
  InMemorySessionStore,
  RecordingDelay,
  credentialFixture,
  staffUserFixture,
} from "../../testing/fakes.js";
import { LocalPasswordProvider } from "../outbound/local-password-provider.js";
import { TotpVerifier } from "../outbound/totp.js";
import {
  AuthMiddleware,
  CITIZEN_SESSION_COOKIE,
  DENIED_TENANT_FIELDS,
  STAFF_SESSION_COOKIE,
  TenantForgeryError,
  UnauthenticatedError,
  assertNoTenantOverride,
  formatSessionCookie,
  parseSessionCookie,
  type InboundRequest,
} from "./auth-middleware.js";

/**
 * The inbound adapter.
 *
 * Two properties are load-bearing and both are asserted negatively, because both
 * are guarantees about what *cannot* happen:
 *
 *  1. The tenant bound to a request comes from the principal, and a request that
 *     tries to name one is rejected rather than ignored (ADR-0002 rule 1,
 *     api.md §12 invariant 1).
 *  2. The cookie's tenant segment is a key-prefix hint that authorises nothing —
 *     swapping it does not move a session into another tenant.
 *
 * Covers ADR-0002 rules 1 and 2, ADR-0006 rules 1 and 7, api.md §12 invariant 1.
 */

const SEWA = "sewa" as TenantSlug;
const CUSTOMS = "customs" as TenantSlug;

function request(overrides: Partial<InboundRequest> = {}): InboundRequest {
  return {
    method: "GET",
    path: "/api/backoffice/agents",
    cookies: {},
    headers: { "user-agent": "Mozilla/5.0", "x-forwarded-for": "10.20.30.40" },
    ipAddress: "10.20.30.40",
    ...overrides,
  };
}

interface Harness {
  readonly middleware: AuthMiddleware;
  readonly sessions: InMemorySessionStore;
  readonly users: FakeUserRepository;
  readonly clock: FakeClock;
}

function harness(): Harness {
  const clock = new FakeClock();
  const users = new FakeUserRepository(SEEDED_ROLE_PERMISSIONS);
  users.seed({ user: staffUserFixture(), roles: ["AgentDesigner"] });

  const credentials = new FakeCredentialRepository();
  credentials.seed(credentialFixture());

  const sessions = new InMemorySessionStore();
  const securityPolicy = new FakeSecurityPolicyRepository();
  const identity = new LocalPasswordProvider({
    users,
    credentials,
    challenges: new InMemoryChallengeStore(),
    hasher: new FakePasswordHasher(),
    totp: new TotpVerifier({ replay: new InMemoryReplayGuard(), clock }),
    enrolment: new FakeEnrolmentTokenIssuer(),
    clock,
    delay: new RecordingDelay().delay,
    securityPolicy,
    tenantRegistry: new FakeTenantRegistry(),
  });

  const middleware = new AuthMiddleware({
    resolveSession: new ResolveSession({ identity, sessions, users, clock, securityPolicy, tenantRegistry: new FakeTenantRegistry() }),
    resolveCitizenSession: new ResolveCitizenSession({ sessions, clock }),
    newTraceId: () => "trace-fixed",
  });

  return { middleware, sessions, users, clock };
}

async function openCitizenSession(h: Harness, tenant: TenantSlug = SEWA): Promise<string> {
  const session = await h.sessions.create(
    {
      kind: "citizen",
      stage: "full",
      subjectId: "cs_01JCITIZEN",
      tenant,
      displayName: "",
      assurance: ANONYMOUS_ASSURANCE,
      epoch: 0,
      binding: { userAgentFamily: "Mozilla", ipBlock: "10.20.30" },
      ttl: CITIZEN_SESSION_TTL,
    },
    h.clock.now(),
  );
  return formatSessionCookie(tenant, session.id);
}

async function openSession(h: Harness, tenant: TenantSlug = SEWA): Promise<string> {
  const session = await h.sessions.create(
    {
      kind: "staff",
      stage: "full",
      subjectId: "usr_01JBSARA",
      tenant,
      displayName: "Sara Al Mazrouei",
      assurance: "L0",
      epoch: 0,
      binding: { userAgentFamily: "Mozilla", ipBlock: "10.20.30" },
      ttl: STAFF_SESSION_TTL,
    },
    h.clock.now(),
  );
  return formatSessionCookie(tenant, session.id);
}

describe("a forged tenant is rejected, not ignored", () => {
  it.each(DENIED_TENANT_FIELDS)("rejects %s in the body", (field) => {
    // api.md §12 invariant 1's worked example: PATCH /agents with
    // { "tenantId": "customs" } while the principal's tenant is 'sewa'.
    expect(() => assertNoTenantOverride(request({ body: { [field]: "customs" } }))).toThrow(
      TenantForgeryError,
    );
  });

  it.each(DENIED_TENANT_FIELDS)("rejects %s in the query string", (field) => {
    expect(() => assertNoTenantOverride(request({ query: { [field]: "customs" } }))).toThrow(
      TenantForgeryError,
    );
  });

  it("finds one nested inside a filter object", () => {
    // "anywhere in any body" — a nested attempt is the same attempt with one
    // more brace.
    expect(() =>
      assertNoTenantOverride(request({ body: { filter: { nested: { tenantId: "customs" } } } })),
    ).toThrow(TenantForgeryError);
  });

  it("finds one inside an array element", () => {
    expect(() =>
      assertNoTenantOverride(request({ body: { items: [{ name: "ok" }, { schema: "customs" }] } })),
    ).toThrow(TenantForgeryError);
  });

  it("reports 403, not 422", () => {
    // A forged tenant is not a validation mistake. Treating it as one files it
    // as a schema problem instead of a security event.
    try {
      assertNoTenantOverride(request({ body: { tenantId: "customs" } }));
      expect.unreachable("must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(TenantForgeryError);
      const forgery = error as TenantForgeryError;
      expect(forgery.status).toBe(403);
      expect(forgery.code).toBe("authz.tenant_mismatch");
      expect(forgery.rejectedField).toBe("tenantId");
    }
  });

  it("does not disclose the principal's own tenant or whether the named one exists", () => {
    const error = new TenantForgeryError("tenantId");
    expect(error.message).not.toContain("sewa");
    expect(error.message).not.toContain("customs");
  });

  it("rejects before the session is even read", async () => {
    // The rejection must not double as a session-validity oracle, and the
    // security event must be recorded for anonymous attempts too.
    const h = harness();
    await expect(
      h.middleware.handle(request({ body: { tenantId: "customs" } }), async () => "handled"),
    ).rejects.toThrow(TenantForgeryError);
  });

  it("rejects an authenticated request that tries as well", async () => {
    const h = harness();
    const cookie = await openSession(h);
    await expect(
      h.middleware.handle(
        request({
          method: "PATCH",
          cookies: { [STAFF_SESSION_COOKIE]: cookie },
          body: { name: "Customs Enquiry Agent", tenantId: "customs" },
        }),
        async () => "handled",
      ),
    ).rejects.toThrow(TenantForgeryError);
  });

  it("leaves an innocent body alone", () => {
    expect(() =>
      assertNoTenantOverride(
        request({ body: { name: "Bill Enquiry Agent", locale: "ar", teamIds: ["team_1"] } }),
      ),
    ).not.toThrow();
  });

  it("stops walking a pathologically deep body rather than recursing forever", () => {
    // The scan runs on untrusted input before any schema has limited its size.
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 500; i++) deep = { nested: deep };
    expect(() => assertNoTenantOverride(request({ body: deep }))).not.toThrow();
  });
});

describe("the tenant comes from the principal", () => {
  it("binds the context from the session record", async () => {
    const h = harness();
    const cookie = await openSession(h);

    const bound = await h.middleware.handle(
      request({ cookies: { [STAFF_SESSION_COOKIE]: cookie } }),
      async () => tryGetTenantContext(),
    );

    expect(bound?.tenant).toBe(SEWA);
    expect(bound?.principal?.id).toBe("usr_01JBSARA");
    expect(bound?.traceId).toBe("trace-fixed");
  });

  it("gives the handler the same principal it bound", async () => {
    const h = harness();
    const cookie = await openSession(h);

    const seen = await h.middleware.handle(
      request({ cookies: { [STAFF_SESSION_COOKIE]: cookie } }),
      async ({ principal }) => principal,
    );

    expect(seen.tenant).toBe(SEWA);
    expect(seen.permissions.has("agents:manage")).toBe(true);
  });

  it("ignores a tenant header entirely", async () => {
    // Not rejected — the denied-field list covers bodies and query strings — but
    // there is no code path from a header to a tenant, so it simply does nothing.
    const h = harness();
    const cookie = await openSession(h);

    const bound = await h.middleware.handle(
      request({
        cookies: { [STAFF_SESSION_COOKIE]: cookie },
        headers: { "user-agent": "Mozilla/5.0", "x-tenant-id": "customs" },
      }),
      async () => tryGetTenantContext(),
    );

    expect(bound?.tenant).toBe(SEWA);
  });

  it("prefers an inbound traceparent, so one id spans web and ai", async () => {
    // The W3C-standard header (deployment.md §13.1), extracted via
    // @opentelemetry/api rather than by hand — see extractTraceId.
    const h = harness();
    const cookie = await openSession(h);

    const bound = await h.middleware.handle(
      request({
        cookies: { [STAFF_SESSION_COOKIE]: cookie },
        headers: {
          "user-agent": "Mozilla/5.0",
          traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        },
      }),
      async () => tryGetTenantContext(),
    );

    expect(bound?.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it("falls back to a fresh root trace when the traceparent header is malformed", async () => {
    // Not every unparseable header is worth a 400 — this is best-effort correlation,
    // not request validation, so a bad header degrades to "start a new trace" rather
    // than failing the request.
    const h = harness();
    const cookie = await openSession(h);

    const bound = await h.middleware.handle(
      request({
        cookies: { [STAFF_SESSION_COOKIE]: cookie },
        headers: { "user-agent": "Mozilla/5.0", traceparent: "not-a-traceparent" },
      }),
      async () => tryGetTenantContext(),
    );

    expect(bound?.traceId).toBe("trace-fixed");
  });
});

describe("the cookie's tenant segment authorises nothing", () => {
  it("yields no principal when the hint is swapped to another tenant", async () => {
    // Two independent defences produce this. Against the real Redis store the
    // customs-prefixed lookup finds nothing, because the record lives under
    // sewa's prefix and a 256-bit id cannot be guessed into existence there.
    // Against this in-memory store — which is deliberately not
    // prefix-partitioned — the lookup succeeds and the record's own tenant field
    // rejects the mismatch. Either way the answer is the same, which is the
    // point: the hint selects which prefix is searched and never which tenant is
    // served.
    const h = harness();
    const cookie = await openSession(h, SEWA);
    const sessionId = cookie.slice(cookie.indexOf(".") + 1);

    await expect(
      h.middleware.handle(
        request({
          cookies: { [STAFF_SESSION_COOKIE]: formatSessionCookie(CUSTOMS, sessionId) },
        }),
        async () => "handled",
      ),
    ).rejects.toThrow(UnauthenticatedError);
  });

  it("fails hard even when the user is a member of the hinted tenant", async () => {
    // The case that would matter if the mismatch check were missing: Sara really
    // is a member of customs, so an attacker swapping the hint would be asking
    // for a tenant she is authorised for — and must still be refused, because
    // the session was bound to sewa at sign-in and rebinding it is not something
    // a request gets to do.
    const h = harness();
    const session = await h.sessions.create(
      {
        kind: "staff",
        stage: "full",
        subjectId: "usr_01JBSARA",
        tenant: SEWA,
        displayName: "Sara Al Mazrouei",
        assurance: "L0",
        epoch: 0,
        binding: { userAgentFamily: "Mozilla", ipBlock: "10.20.30" },
        ttl: STAFF_SESSION_TTL,
      },
      h.clock.now(),
    );
    h.users.seed({ user: staffUserFixture(), roles: ["AgentDesigner"] }, [SEWA, CUSTOMS]);

    await expect(
      h.middleware.handle(
        request({
          cookies: { [STAFF_SESSION_COOKIE]: formatSessionCookie(CUSTOMS, session.id) },
        }),
        async () => "handled",
      ),
    ).rejects.toThrow(UnauthenticatedError);
  });
});

describe("parsing the cookie", () => {
  it("round-trips", () => {
    const parsed = parseSessionCookie(formatSessionCookie(SEWA, "abc.def"));
    expect(parsed).toEqual({ tenantHint: SEWA, sessionId: "abc.def" });
  });

  it("rejects a missing or malformed value rather than throwing", () => {
    // A hand-edited cookie is an unauthenticated request, not a server error.
    for (const raw of [undefined, "", ".", "sewa.", ".abc", "nodot", "SEWA.abc", "platform.abc"]) {
      expect(parseSessionCookie(raw)).toBeNull();
    }
  });

  it("rejects a tenant segment that could not be a slug", () => {
    // The hint reaches a Redis key prefix, so it is shape-validated before use
    // (ADR-0002 rule 4).
    for (const raw of ["../etc.abc", "sewa;drop.abc", "a.abc", "dbo.abc"]) {
      expect(parseSessionCookie(raw)).toBeNull();
    }
  });
});

describe("unauthenticated requests", () => {
  it("refuses a backoffice request with no cookie", async () => {
    const h = harness();
    await expect(h.middleware.handle(request(), async () => "handled")).rejects.toThrow(
      UnauthenticatedError,
    );
  });

  it("distinguishes a missing session from a revoked one", async () => {
    const h = harness();
    const cookie = await openSession(h);
    h.users.setStatus("usr_01JBSARA", "Suspended");

    try {
      await h.middleware.handle(
        request({ cookies: { [STAFF_SESSION_COOKIE]: cookie } }),
        async () => "handled",
      );
      expect.unreachable("a suspended user must not be served");
    } catch (error) {
      // api.md §3.6 promises auth.session_revoked, which is the difference
      // between a confusing logout and an explicable one.
      expect((error as UnauthenticatedError).code).toBe("auth.session_revoked");
    }
  });

  it("binds a channel-resolved tenant for an anonymous citizen request", async () => {
    // B11 tab 2 allows "view bill balance" at L0, so anonymous is legitimate.
    // The tenant is a parameter the caller resolved from the channel registry.
    const h = harness();
    const bound = await h.middleware.handleAnonymous(
      request({ path: "/api/public/v1/bills" }),
      SEWA,
      async () => tryGetTenantContext(),
    );

    expect(bound?.tenant).toBe(SEWA);
    expect(bound?.principal).toBeNull();
  });

  it("still rejects a forged tenant on the anonymous path", async () => {
    const h = harness();
    await expect(
      h.middleware.handleAnonymous(
        request({ path: "/api/public/v1/bills", body: { tenantId: "customs" } }),
        SEWA,
        async () => "handled",
      ),
    ).rejects.toThrow(TenantForgeryError);
  });
});

describe("context leakage", () => {
  it("unbinds the context once the handler returns", async () => {
    // ADR-0002 rule 2: the context is request-scoped. A context that outlived
    // its request would let a later job read the wrong tenant.
    const h = harness();
    const cookie = await openSession(h);
    await h.middleware.handle(request({ cookies: { [STAFF_SESSION_COOKIE]: cookie } }), async () =>
      tryGetTenantContext(),
    );
    expect(tryGetTenantContext()).toBeUndefined();
  });

  it("unbinds after a handler throws", async () => {
    const h = harness();
    const cookie = await openSession(h);
    await expect(
      h.middleware.handle(request({ cookies: { [STAFF_SESSION_COOKIE]: cookie } }), async () => {
        throw new Error("handler exploded");
      }),
    ).rejects.toThrow("handler exploded");
    expect(tryGetTenantContext()).toBeUndefined();
  });
});

/**
 * `handleCitizenSession` — the B-6 citizen-surface sibling of `handle()`.
 * Same load-bearing properties: the tenant comes from the session record, a
 * forged tenant is rejected outright, and the bound context unwinds cleanly —
 * proven the identical way `handle()`'s own suite proves them above, so a
 * reviewer can compare the two suites line for line.
 */
describe("handleCitizenSession", () => {
  it("binds the tenant from the citizen session record, not from the request", async () => {
    const h = harness();
    const cookie = await openCitizenSession(h, SEWA);

    const bound = await h.middleware.handleCitizenSession(
      request({
        path: "/api/public/v1/conversations/conv_1",
        cookies: { [CITIZEN_SESSION_COOKIE]: cookie },
      }),
      async ({ session }) => ({ context: tryGetTenantContext(), session }),
    );

    expect(bound.context?.tenant).toBe(SEWA);
    expect(bound.context?.principal).toBeNull();
    expect(bound.session.kind).toBe("citizen");
    expect(bound.session.subjectId).toBe("cs_01JCITIZEN");
  });

  it("rejects a request with no citizen session cookie", async () => {
    const h = harness();
    await expect(
      h.middleware.handleCitizenSession(
        request({ path: "/api/public/v1/conversations/conv_1" }),
        async () => "handled",
      ),
    ).rejects.toThrow(UnauthenticatedError);
  });

  it("rejects an unresolvable (garbage) citizen cookie", async () => {
    const h = harness();
    await expect(
      h.middleware.handleCitizenSession(
        request({
          path: "/api/public/v1/conversations/conv_1",
          cookies: { [CITIZEN_SESSION_COOKIE]: "sewa.not-a-real-session-id" },
        }),
        async () => "handled",
      ),
    ).rejects.toThrow(UnauthenticatedError);
  });

  it("still rejects a forged tenant field on the citizen path", async () => {
    const h = harness();
    const cookie = await openCitizenSession(h, SEWA);
    await expect(
      h.middleware.handleCitizenSession(
        request({
          path: "/api/public/v1/conversations/conv_1",
          cookies: { [CITIZEN_SESSION_COOKIE]: cookie },
          body: { tenantId: "customs" },
        }),
        async () => "handled",
      ),
    ).rejects.toThrow(TenantForgeryError);
  });

  it("a citizen session cannot be replayed against another tenant's prefix hint", async () => {
    // The real record lives under the `sewa:` prefix. Swapping the cookie's own
    // tenant hint to `customs` looks up a key that does not exist there — the
    // identical guarantee `handle()`'s own "cookie's tenant segment authorises
    // nothing" suite proves for staff sessions.
    const h = harness();
    const cookie = await openCitizenSession(h, SEWA);
    const [, sessionId] = cookie.split(".");
    const forgedHintCookie = `customs.${sessionId}`;

    await expect(
      h.middleware.handleCitizenSession(
        request({
          path: "/api/public/v1/conversations/conv_1",
          cookies: { [CITIZEN_SESSION_COOKIE]: forgedHintCookie },
        }),
        async () => "handled",
      ),
    ).rejects.toThrow(UnauthenticatedError);
  });

  it("rejects a citizen session presented with a different client binding", async () => {
    const h = harness();
    const cookie = await openCitizenSession(h, SEWA);
    await expect(
      h.middleware.handleCitizenSession(
        request({
          path: "/api/public/v1/conversations/conv_1",
          cookies: { [CITIZEN_SESSION_COOKIE]: cookie },
          headers: { "user-agent": "curl/8.0", "x-forwarded-for": "203.0.113.9" },
        }),
        async () => "handled",
      ),
    ).rejects.toThrow(UnauthenticatedError);
  });

  it("throws a clear configuration error when constructed without resolveCitizenSession", async () => {
    const middleware = new AuthMiddleware({
      resolveSession: new ResolveSession({
        identity: new LocalPasswordProvider({
          users: new FakeUserRepository(SEEDED_ROLE_PERMISSIONS),
          credentials: new FakeCredentialRepository(),
          challenges: new InMemoryChallengeStore(),
          hasher: new FakePasswordHasher(),
          totp: new TotpVerifier({ replay: new InMemoryReplayGuard(), clock: new FakeClock() }),
          enrolment: new FakeEnrolmentTokenIssuer(),
          clock: new FakeClock(),
          delay: new RecordingDelay().delay,
          securityPolicy: new FakeSecurityPolicyRepository(),
          tenantRegistry: new FakeTenantRegistry(),
        }),
        sessions: new InMemorySessionStore(),
        users: new FakeUserRepository(SEEDED_ROLE_PERMISSIONS),
        clock: new FakeClock(),
        securityPolicy: new FakeSecurityPolicyRepository(),
        tenantRegistry: new FakeTenantRegistry(),
      }),
      newTraceId: () => "trace-fixed",
    });

    await expect(
      middleware.handleCitizenSession(
        request({
          path: "/api/public/v1/conversations/conv_1",
          cookies: { [CITIZEN_SESSION_COOKIE]: "sewa.whatever" },
        }),
        async () => "handled",
      ),
    ).rejects.toThrow(/resolveCitizenSession/);
  });

  it("unbinds the context once the handler returns", async () => {
    const h = harness();
    const cookie = await openCitizenSession(h);
    await h.middleware.handleCitizenSession(
      request({
        path: "/api/public/v1/conversations/conv_1",
        cookies: { [CITIZEN_SESSION_COOKIE]: cookie },
      }),
      async () => tryGetTenantContext(),
    );
    expect(tryGetTenantContext()).toBeUndefined();
  });
});
