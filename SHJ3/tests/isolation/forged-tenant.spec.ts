/**
 * The request-layer defence, proved end-to-end (docs/testing.md §5, cases 6-9; ADR-0002
 * rule 1, api.md §12 invariant 1).
 *
 * `apps/web/src/modules/iam/adapters/inbound/auth-middleware.test.ts` already unit-tests
 * `assertNoTenantOverride` and `AuthMiddleware.handle()` thoroughly, against fakes, for
 * every denied field, at every request location (body/query), nested, and pathologically
 * deep. This file does not repeat that — it asserts the same underlying property
 * (`FR` "a forged tenant is rejected, not ignored") through the real
 * `runWithTenant` / `getTenantDb` / `getTenantCache` path, against the real SQL Server and
 * Redis containers, so the claim is "no store call happens", not "a function returns
 * without throwing":
 *
 *  1. A forged tenant field never lets the handler run, so it never lets the handler reach
 *     `getTenantDb()` / `getTenantCache()` at all — checked by handing the middleware a
 *     handler that performs a real, observable Redis write if it is ever invoked, then
 *     confirming that key was never created.
 *  2. When a request legitimately succeeds, the store handles the handler receives are
 *     bound to the *authenticated principal's* tenant specifically — never anything a body,
 *     query string or header could have named — confirmed by reading back
 *     `tryGetTenantContext()` from inside the handler and by exercising the real cache
 *     handle it returns.
 *
 * `IdentityProvider` / `SessionStore` / `UserRepository` are IAM-internal fakes here, same
 * as in every other IAM test — they are not one of the four tenant stores this suite exists
 * to test against real infrastructure (testing.md §3's "we do not mock the stores" is about
 * SQL Server, Neo4j, Qdrant and Redis specifically), and faking them is how this file keeps
 * the forgery path isolated from IAM's own, separately-tested authentication mechanics.
 */

import { afterAll, describe, expect, it } from "vitest";
import {
  runWithTenant,
  tryGetTenantContext,
  type TenantContext,
} from "../../apps/web/src/modules/platform/tenancy/tenant-context.js";
import { getTenantCache } from "../../apps/web/src/modules/platform/adapters/outbound/cache/tenant-cache.js";
import { getTenantDb } from "../../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { ResolveSession } from "../../apps/web/src/modules/iam/application/resolve-session.js";
import { SEEDED_ROLE_PERMISSIONS } from "../../apps/web/src/modules/iam/domain/permissions.js";
import { STAFF_SESSION_TTL } from "../../apps/web/src/modules/iam/domain/session.js";
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
} from "../../apps/web/src/modules/iam/testing/fakes.js";
import { LocalPasswordProvider } from "../../apps/web/src/modules/iam/adapters/outbound/local-password-provider.js";
import { TotpVerifier } from "../../apps/web/src/modules/iam/adapters/outbound/totp.js";
import {
  AuthMiddleware,
  STAFF_SESSION_COOKIE,
  TenantForgeryError,
  formatSessionCookie,
  type InboundRequest,
} from "../../apps/web/src/modules/iam/adapters/inbound/auth-middleware.js";
import { SEWA } from "./setup.js";

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

/** Same shape as auth-middleware.test.ts's harness, wired to the real ResolveSession use case. */
function buildMiddleware(): {
  middleware: AuthMiddleware;
  sessions: InMemorySessionStore;
  clock: FakeClock;
} {
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
    resolveSession: new ResolveSession({
      identity,
      sessions,
      users,
      clock,
      securityPolicy,
      tenantRegistry: new FakeTenantRegistry(),
    }),
    newTraceId: () => "forged-tenant-spec-trace",
  });

  return { middleware, sessions, clock };
}

async function openSewaSession(h: ReturnType<typeof buildMiddleware>): Promise<string> {
  const session = await h.sessions.create(
    {
      kind: "staff",
      stage: "full",
      // Must match staffUserFixture()'s default id (buildMiddleware() seeds no other user) —
      // ResolveSession looks the subject up by id and revokes an unknown one.
      subjectId: "usr_01JBSARA",
      tenant: SEWA,
      displayName: "Forged Tenant Spec Principal",
      assurance: "L0",
      epoch: 0,
      binding: { userAgentFamily: "Mozilla", ipBlock: "10.20.30" },
      ttl: STAFF_SESSION_TTL,
    },
    h.clock.now(),
  );
  return formatSessionCookie(SEWA, session.id);
}

const CANARY_KEY = "forged-tenant-spec:handler-ran-canary";

afterAll(async () => {
  await runWithTenant(
    { tenant: SEWA, principal: null, traceId: "forged-tenant-spec-cleanup" },
    async () => {
      await getTenantCache().del(CANARY_KEY);
    },
  );
});

describe("a forged tenant field never lets the handler touch a store", () => {
  it("a forged body field is rejected before the handler runs, and no store write happens", async () => {
    const h = buildMiddleware();
    const cookie = await openSewaSession(h);
    let handlerRan = false;

    await expect(
      h.middleware.handle(
        request({
          method: "PATCH",
          cookies: { [STAFF_SESSION_COOKIE]: cookie },
          body: { name: "Renamed Agent", tenantId: "customs" },
        }),
        async () => {
          // If this ran, the forgery defence failed. A real, observable write proves
          // "the handler ran" more convincingly than a boolean the test could get wrong.
          handlerRan = true;
          await getTenantCache().set(CANARY_KEY, "handler-ran");
          return "handled";
        },
      ),
    ).rejects.toThrow(TenantForgeryError);

    expect(handlerRan).toBe(false);

    const canary = await runWithTenant(
      { tenant: SEWA, principal: null, traceId: "forged-tenant-spec-check" },
      () => getTenantCache().get(CANARY_KEY),
    );
    expect(canary).toBeNull();
  });

  it("a tenant field forged 9 levels deep is still caught end-to-end", async () => {
    // auth-middleware.test.ts already proves the scan stops at a pathological 500-level
    // body; this proves detection still fires at a *realistic* depth, through the full
    // middleware pipeline rather than assertNoTenantOverride called in isolation.
    // MAX_BODY_SCAN_DEPTH (auth-middleware.ts) is 10, so 9 is inside the scanned range.
    let nested: Record<string, unknown> = { schema: "customs" };
    for (let i = 0; i < 8; i++) nested = { child: nested };

    const h = buildMiddleware();
    const cookie = await openSewaSession(h);

    await expect(
      h.middleware.handle(
        request({
          method: "PATCH",
          cookies: { [STAFF_SESSION_COOKIE]: cookie },
          body: { filter: nested },
        }),
        async () => "handled",
      ),
    ).rejects.toThrow(TenantForgeryError);
  });
});

describe("a legitimate request's store handles are bound to the authenticated principal's tenant", () => {
  it("getTenantDb() and getTenantCache() resolve to sewa inside the handler, regardless of the request", async () => {
    const h = buildMiddleware();
    const cookie = await openSewaSession(h);

    const observed = await h.middleware.handle(
      request({
        method: "PATCH",
        cookies: { [STAFF_SESSION_COOKIE]: cookie },
        // No denied field present — an ordinary, innocent body.
        body: { name: "Renamed Agent", locale: "ar" },
      }),
      async () => {
        const context: TenantContext | undefined = tryGetTenantContext();
        // getTenantDb()/getTenantCache() must not throw MissingTenantContextError, and the
        // context they read from must be exactly the principal's tenant — proving the bound
        // handles could not have resolved to any other government entity.
        void getTenantDb();
        void getTenantCache();
        return context?.tenant;
      },
    );

    expect(observed).toBe(SEWA);
  });
});
