import { beforeEach, describe, expect, it } from "vitest";
import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import { LocalPasswordProvider } from "../adapters/outbound/local-password-provider.js";
import { TotpVerifier } from "../adapters/outbound/totp.js";
import { SEEDED_ROLE_PERMISSIONS } from "../domain/permissions.js";
import {
  CITIZEN_SESSION_TTL,
  PARTIAL_SESSION_TTL,
  STAFF_SESSION_TTL,
  slideSession,
} from "../domain/session.js";
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
} from "../testing/fakes.js";
import { ResolveSession } from "./resolve-session.js";
import { SignIn } from "./sign-in.js";

/**
 * The per-request read path.
 *
 * This is where the cost of opaque server-side sessions is paid — four reads
 * instead of a token decode — so these tests assert what that cost buys: a
 * permission-matrix edit landing on the next request, a suspension landing
 * immediately, and both expiry windows enforced on read rather than trusted to
 * the store's own TTL.
 *
 * Covers ADR-0006 rules 1, 2 and 7, and api.md §3.1 and §3.6.
 */

const TENANT = "sewa" as TenantSlug;
const CLIENT = { userAgentFamily: "Mozilla", ipBlock: "10.20.30" };

interface Harness {
  readonly resolve: ResolveSession;
  readonly signIn: SignIn;
  readonly clock: FakeClock;
  readonly users: FakeUserRepository;
  readonly sessions: InMemorySessionStore;
}

function harness(roles: readonly string[] = ["AgentDesigner"]): Harness {
  const clock = new FakeClock();
  const users = new FakeUserRepository(SEEDED_ROLE_PERMISSIONS);
  users.seed({ user: staffUserFixture(), roles });

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

  return {
    resolve: new ResolveSession({ identity, sessions, users, clock, securityPolicy, tenantRegistry: new FakeTenantRegistry() }),
    signIn: new SignIn({ identity, sessions, users, clock, securityPolicy }),
    clock,
    users,
    sessions,
  };
}

async function signedInSessionId(h: Harness): Promise<string> {
  const result = await h.signIn.execute({
    identifier: "sara.almazrouei@shj.ae",
    secret: "correct-horse",
    tenant: null,
    client: CLIENT,
  });
  if (result.kind !== "signed_in") throw new Error("expected a session");
  return result.sessionId;
}

describe("resolving a live session", () => {
  let h: Harness;
  let sessionId: string;

  beforeEach(async () => {
    h = harness();
    sessionId = await signedInSessionId(h);
  });

  it("returns a principal", async () => {
    const result = await h.resolve.execute({ sessionId, client: CLIENT });
    expect(result.kind).toBe("active");
    if (result.kind !== "active") return;

    expect(result.principal.id).toBe("usr_01JBSARA");
    expect(result.principal.tenant).toBe(TENANT);
    expect(result.principal.permissions.has("agents:manage")).toBe(true);
  });

  it("slides the idle window", async () => {
    h.clock.advanceSeconds(600);
    await h.resolve.execute({ sessionId, client: CLIENT });
    // 30 minutes from the request just served, not from sign-in.
    expect(h.sessions.ttlWrites.get(sessionId)).toBe(STAFF_SESSION_TTL.idleSeconds);
  });

  it("clamps the slid TTL to the absolute ceiling", async () => {
    // The property that stops a sliding window renewing a stolen cookie forever.
    h.clock.advanceSeconds(STAFF_SESSION_TTL.absoluteSeconds - 120);
    const aged = await h.sessions.read(sessionId);
    if (!aged) throw new Error("expected a record");
    h.sessions.put(slideSession(aged, h.clock.now()));

    await h.resolve.execute({ sessionId, client: CLIENT });
    expect(h.sessions.ttlWrites.get(sessionId)).toBe(120);
  });

  it("reads permissions fresh, so a B9 tab 3 edit lands on the next request", async () => {
    // api.md §3.1 point 3. An editable matrix that lags behind a live session is
    // a matrix an admin cannot trust.
    h.users.setMatrix({ ...SEEDED_ROLE_PERMISSIONS, AgentDesigner: ["analytics:view"] });

    const result = await h.resolve.execute({ sessionId, client: CLIENT });
    if (result.kind !== "active") throw new Error("expected an active session");
    expect(result.principal.permissions.has("agents:manage")).toBe(false);
    expect(result.principal.permissions.has("analytics:view")).toBe(true);
  });

  it("reduces access when a role is removed, and never escalates it", async () => {
    h.users.setRoles("usr_01JBSARA", TENANT, ["DeletedRole"]);
    const result = await h.resolve.execute({ sessionId, client: CLIENT });
    if (result.kind !== "active") throw new Error("expected an active session");
    expect(result.principal.permissions.size).toBe(0);
  });

  it("does not revoke on a role change — permissions are re-read, not re-issued", async () => {
    // api.md §3.6: only status changes and password rotation revoke.
    h.users.setRoles("usr_01JBSARA", TENANT, ["Analyst"]);
    const result = await h.resolve.execute({ sessionId, client: CLIENT });
    expect(result.kind).toBe("active");
  });
});

describe("expiry is enforced on read, not left to the store", () => {
  it("reports idle expiry and destroys the record", async () => {
    const h = harness();
    const sessionId = await signedInSessionId(h);

    h.clock.advanceSeconds(STAFF_SESSION_TTL.idleSeconds);
    expect(await h.resolve.execute({ sessionId, client: CLIENT })).toEqual({
      kind: "expired",
      reason: "idle",
    });
    // A store holding useless session records is a store whose contents no
    // longer answer "who is signed in".
    expect(await h.sessions.read(sessionId)).toBeNull();
  });

  it("reports absolute expiry for a continuously active session", async () => {
    const h = harness();
    const sessionId = await signedInSessionId(h);

    // Use it every 25 minutes — inside the 30-minute idle window every time, so
    // the session is never idle and only the ceiling can end it.
    const step = 1_500;
    let elapsed = 0;
    while (elapsed + step < STAFF_SESSION_TTL.absoluteSeconds) {
      h.clock.advanceSeconds(step);
      elapsed += step;
      expect((await h.resolve.execute({ sessionId, client: CLIENT })).kind).toBe("active");
    }

    h.clock.advanceSeconds(step);
    expect(await h.resolve.execute({ sessionId, client: CLIENT })).toEqual({
      kind: "expired",
      reason: "absolute",
    });
  });

  it("reports an unknown id as absent, indistinguishably from an expired one", async () => {
    const h = harness();
    expect(await h.resolve.execute({ sessionId: "session-999", client: CLIENT })).toEqual({
      kind: "absent",
    });
  });
});

describe("revocation", () => {
  it("refuses a suspended user immediately", async () => {
    // The in-flight case: the session record still exists because it was read
    // before the suspension landed.
    const h = harness();
    const sessionId = await signedInSessionId(h);
    h.users.setStatus("usr_01JBSARA", "Suspended");

    expect(await h.resolve.execute({ sessionId, client: CLIENT })).toEqual({
      kind: "revoked",
      reason: "suspended",
    });
    expect(await h.sessions.read(sessionId)).toBeNull();
  });

  it("refuses a user reverted to Invited", async () => {
    const h = harness();
    const sessionId = await signedInSessionId(h);
    h.users.setStatus("usr_01JBSARA", "Invited");
    expect((await h.resolve.execute({ sessionId, client: CLIENT })).kind).toBe("revoked");
  });

  it("refuses a session minted before an epoch bump", async () => {
    const h = harness();
    const sessionId = await signedInSessionId(h);
    await h.users.bumpSessionEpoch("usr_01JBSARA");

    expect(await h.resolve.execute({ sessionId, client: CLIENT })).toEqual({
      kind: "revoked",
      reason: "epoch",
    });
  });

  it("refuses a partial session anywhere but the TOTP route", async () => {
    const h = harness();
    const partial = await h.sessions.create(
      {
        kind: "staff",
        stage: "partial",
        subjectId: "usr_01JBSARA",
        tenant: TENANT,
        displayName: "",
        assurance: "L0",
        epoch: 0,
        binding: CLIENT,
        ttl: PARTIAL_SESSION_TTL,
      },
      h.clock.now(),
    );

    expect(await h.resolve.execute({ sessionId: partial.id, client: CLIENT })).toEqual({
      kind: "revoked",
      reason: "stage",
    });
  });

  it("refuses a cookie replayed from a different network and browser", async () => {
    const h = harness();
    const sessionId = await signedInSessionId(h);

    expect(
      await h.resolve.execute({
        sessionId,
        client: { userAgentFamily: "curl", ipBlock: "203.0.113" },
      }),
    ).toEqual({ kind: "revoked", reason: "binding" });
    expect(await h.sessions.read(sessionId)).toBeNull();
  });

  it("refuses a session whose user has gone", async () => {
    const h = harness();
    const orphan = await h.sessions.create(
      {
        kind: "staff",
        stage: "full",
        subjectId: "usr_deleted",
        tenant: TENANT,
        displayName: "Gone",
        assurance: "L0",
        epoch: 0,
        binding: CLIENT,
        ttl: STAFF_SESSION_TTL,
      },
      h.clock.now(),
    );

    expect(await h.resolve.execute({ sessionId: orphan.id, client: CLIENT })).toEqual({
      kind: "revoked",
      reason: "unknown_subject",
    });
  });

  it("does not slide a session it refused", async () => {
    const h = harness();
    const sessionId = await signedInSessionId(h);
    const beforeTtl = h.sessions.ttlWrites.get(sessionId);

    h.users.setStatus("usr_01JBSARA", "Suspended");
    await h.resolve.execute({ sessionId, client: CLIENT });

    // The record is gone, so nothing was extended.
    expect(h.sessions.ttlWrites.get(sessionId)).toBeUndefined();
    expect(beforeTtl).toBe(STAFF_SESSION_TTL.idleSeconds);
  });
});

describe("citizen sessions", () => {
  it("resolves to a principal with no roles and no permissions", async () => {
    // api.md §3.5: citizens have no permissions, they have an assurance level.
    const h = harness();
    const citizen = await h.sessions.create(
      {
        kind: "citizen",
        stage: "full",
        subjectId: "cs_01JBCITIZEN",
        tenant: TENANT,
        displayName: "Sara Al Mazrouei",
        assurance: "L2",
        epoch: 0,
        binding: CLIENT,
        ttl: CITIZEN_SESSION_TTL,
      },
      h.clock.now(),
    );

    const result = await h.resolve.execute({ sessionId: citizen.id, client: CLIENT });
    if (result.kind !== "active") throw new Error("expected an active session");

    expect(result.principal.roles).toEqual([]);
    expect(result.principal.permissions.size).toBe(0);
    expect(result.principal.assurance).toBe("L2");
  });

  it("does not consult the staff user table for a citizen", async () => {
    // A citizen has no StaffUsers row, so a resolution that required one would
    // sign every citizen out.
    const h = harness();
    const citizen = await h.sessions.create(
      {
        kind: "citizen",
        stage: "full",
        subjectId: "cs_unknown_to_staff_table",
        tenant: TENANT,
        displayName: "",
        assurance: "L0",
        epoch: 0,
        binding: CLIENT,
        ttl: CITIZEN_SESSION_TTL,
      },
      h.clock.now(),
    );

    expect((await h.resolve.execute({ sessionId: citizen.id, client: CLIENT })).kind).toBe(
      "active",
    );
  });

  it("uses the 24-hour idle window, not the staff one", async () => {
    const h = harness();
    const citizen = await h.sessions.create(
      {
        kind: "citizen",
        stage: "full",
        subjectId: "cs_01JBCITIZEN",
        tenant: TENANT,
        displayName: "",
        assurance: "L0",
        epoch: 0,
        binding: CLIENT,
        ttl: CITIZEN_SESSION_TTL,
      },
      h.clock.now(),
    );

    h.clock.advanceSeconds(STAFF_SESSION_TTL.idleSeconds + 60);
    expect((await h.resolve.execute({ sessionId: citizen.id, client: CLIENT })).kind).toBe(
      "active",
    );
  });
});
