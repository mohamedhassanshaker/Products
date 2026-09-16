import { beforeEach, describe, expect, it } from "vitest";
import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import { LocalPasswordProvider } from "../adapters/outbound/local-password-provider.js";
import { TotpVerifier, totpCodeFor, totpStepAt } from "../adapters/outbound/totp.js";
import { BACKOFF_CEILING_MS, FAILURES_BEFORE_LOCK, LOCK_DURATION_MS } from "../domain/lockout.js";
import { SEEDED_ROLE_PERMISSIONS } from "../domain/permissions.js";
import { PARTIAL_SESSION_TTL, STAFF_SESSION_TTL } from "../domain/session.js";
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
  TEST_TOTP_SECRET,
  credentialFixture,
  staffUserFixture,
} from "../testing/fakes.js";
import { CompleteTotpChallenge } from "./complete-totp-challenge.js";
import { SignIn } from "./sign-in.js";

/**
 * Staff sign-in, end to end through the local adapter with fakes for storage.
 *
 * The interesting assertions are the negative ones: that every rejection path
 * looks the same from outside, that a privileged role cannot get a session
 * without a second factor, and that the backoff schedule is actually applied.
 *
 * Argon2 is not exercised here — `FakePasswordHasher` stands in, because 19 MiB
 * and two passes per assertion would make this suite too slow to run on every
 * commit. The real hasher has its own round-trip test at minimal parameters.
 *
 * Covers ADR-0006 rules 1, 2 and 4, and api.md §3.2.
 */

const TENANT = "sewa" as TenantSlug;
const CLIENT = { userAgentFamily: "Mozilla", ipBlock: "10.20.30" };
const PASSWORD = "correct-horse";

interface Harness {
  readonly signIn: SignIn;
  readonly completeTotp: CompleteTotpChallenge;
  readonly clock: FakeClock;
  readonly users: FakeUserRepository;
  readonly credentials: FakeCredentialRepository;
  readonly sessions: InMemorySessionStore;
  readonly delays: RecordingDelay;
  readonly enrolment: FakeEnrolmentTokenIssuer;
}

function harness(options: { roles?: readonly string[]; totpSecret?: string | null } = {}): Harness {
  const clock = new FakeClock();
  const users = new FakeUserRepository(SEEDED_ROLE_PERMISSIONS);
  users.seed({ user: staffUserFixture(), roles: options.roles ?? ["AgentDesigner"] });

  const credentials = new FakeCredentialRepository();
  credentials.seed(credentialFixture({ totpSecret: options.totpSecret ?? null }));

  const sessions = new InMemorySessionStore();
  const challenges = new InMemoryChallengeStore();
  const delays = new RecordingDelay();
  const enrolment = new FakeEnrolmentTokenIssuer();
  const securityPolicy = new FakeSecurityPolicyRepository();

  const identity = new LocalPasswordProvider({
    users,
    credentials,
    challenges,
    hasher: new FakePasswordHasher(),
    totp: new TotpVerifier({ replay: new InMemoryReplayGuard(), clock }),
    enrolment,
    clock,
    delay: delays.delay,
    securityPolicy,
    tenantRegistry: new FakeTenantRegistry(),
  });

  return {
    signIn: new SignIn({ identity, sessions, users, clock, securityPolicy }),
    completeTotp: new CompleteTotpChallenge({ identity, sessions, users, clock, securityPolicy }),
    clock,
    users,
    credentials,
    sessions,
    delays,
    enrolment,
  };
}

function attempt(overrides: Partial<{ identifier: string; secret: string }> = {}) {
  return {
    identifier: "sara.almazrouei@shj.ae",
    secret: PASSWORD,
    tenant: null,
    client: CLIENT,
    ...overrides,
  };
}

describe("an unprivileged role signs in with a password alone", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness({ roles: ["AgentDesigner"] });
  });

  it("returns a session and a principal", async () => {
    const result = await h.signIn.execute(attempt());
    expect(result.kind).toBe("signed_in");
    if (result.kind !== "signed_in") return;

    expect(result.principal.id).toBe("usr_01JBSARA");
    expect(result.principal.tenant).toBe(TENANT);
    expect(result.principal.permissions.has("agents:manage")).toBe(true);
    // AgentDesigner cannot publish, so no second factor was required and none
    // was silently skipped.
    expect(result.principal.permissions.has("agents:publish")).toBe(false);
  });

  it("mints a full session bounded by the 12-hour ceiling", async () => {
    const result = await h.signIn.execute(attempt());
    if (result.kind !== "signed_in") throw new Error("expected a session");

    expect(result.expiresAt).toEqual(
      new Date(h.clock.now().getTime() + STAFF_SESSION_TTL.absoluteSeconds * 1_000),
    );
    // The physical TTL is the idle window, because it is the shorter one.
    expect(h.sessions.ttlWrites.get(result.sessionId)).toBe(STAFF_SESSION_TTL.idleSeconds);
  });

  it("is case- and whitespace-insensitive about the email", async () => {
    const result = await h.signIn.execute(attempt({ identifier: "  Sara.AlMazrouei@SHJ.ae " }));
    expect(result.kind).toBe("signed_in");
  });

  it("records the login after the session exists", async () => {
    await h.signIn.execute(attempt());
    expect(h.users.logins).toEqual([{ staffUserId: "usr_01JBSARA", at: h.clock.now() }]);
  });

  it("never lets the secret reach the session record", async () => {
    // ADR-0006 rule 1, at the storage boundary rather than the type boundary.
    const result = await h.signIn.execute(attempt());
    if (result.kind !== "signed_in") throw new Error("expected a session");

    const stored = await h.sessions.read(result.sessionId);
    expect(JSON.stringify(stored)).not.toContain(PASSWORD);
    expect(JSON.stringify(stored)).not.toContain("fake:");
  });
});

describe("every rejection looks identical from outside", () => {
  it("rejects an unknown email", async () => {
    const h = harness();
    const result = await h.signIn.execute(attempt({ identifier: "nobody@shj.ae" }));
    expect(result).toEqual({ kind: "rejected", reason: "invalid_credentials" });
  });

  it("rejects a wrong password with the same reason", async () => {
    const h = harness();
    const result = await h.signIn.execute(attempt({ secret: "wrong" }));
    expect(result).toEqual({ kind: "rejected", reason: "invalid_credentials" });
  });

  it("rejects a Suspended user with the same reason", async () => {
    // api.md §3.2 folds unknown email, wrong password and non-active account into
    // one answer so the endpoint is not an account-enumeration oracle.
    const h = harness();
    h.users.setStatus("usr_01JBSARA", "Suspended");
    const result = await h.signIn.execute(attempt());
    expect(result).toEqual({ kind: "rejected", reason: "invalid_credentials" });
  });

  it("rejects an Invited user who has not accepted", async () => {
    const h = harness();
    h.users.setStatus("usr_01JBSARA", "Invited");
    const result = await h.signIn.execute(attempt());
    expect(result).toEqual({ kind: "rejected", reason: "invalid_credentials" });
  });

  it("rejects a user with no credential row, as SSO users will have", async () => {
    const credentials = new FakeCredentialRepository();
    const clock = new FakeClock();
    const users = new FakeUserRepository(SEEDED_ROLE_PERMISSIONS);
    users.seed({ user: staffUserFixture(), roles: ["AgentDesigner"] });

    const identity = new LocalPasswordProvider({
      users,
      credentials,
      challenges: new InMemoryChallengeStore(),
      hasher: new FakePasswordHasher(),
      totp: new TotpVerifier({ replay: new InMemoryReplayGuard(), clock }),
      enrolment: new FakeEnrolmentTokenIssuer(),
      clock,
      delay: new RecordingDelay().delay,
      securityPolicy: new FakeSecurityPolicyRepository(),
      tenantRegistry: new FakeTenantRegistry(),
    });
    const signIn = new SignIn({
      identity,
      sessions: new InMemorySessionStore(),
      users,
      clock,
      securityPolicy: new FakeSecurityPolicyRepository(),
    });

    expect(await signIn.execute(attempt())).toEqual({
      kind: "rejected",
      reason: "invalid_credentials",
    });
  });

  it("mints no session on any rejection", async () => {
    const h = harness();
    await h.signIn.execute(attempt({ secret: "wrong" }));
    await h.signIn.execute(attempt({ identifier: "nobody@shj.ae" }));
    expect(h.sessions.size()).toBe(0);
  });

  it("spends hashing work on an unknown email too", async () => {
    // Skipping the hash for an unknown address makes it measurably faster to
    // probe — account enumeration by stopwatch.
    const h = harness();
    let verifyCalls = 0;
    const counting = new FakePasswordHasher();
    const wrapped = {
      algorithm: counting.algorithm,
      hash: (plain: string) => counting.hash(plain),
      verify: (encoded: string, plain: string) => {
        verifyCalls += 1;
        return counting.verify(encoded, plain);
      },
      needsRehash: () => false,
    };

    const identity = new LocalPasswordProvider({
      users: h.users,
      credentials: h.credentials,
      challenges: new InMemoryChallengeStore(),
      hasher: wrapped,
      totp: new TotpVerifier({ replay: new InMemoryReplayGuard(), clock: h.clock }),
      enrolment: h.enrolment,
      clock: h.clock,
      delay: h.delays.delay,
      securityPolicy: new FakeSecurityPolicyRepository(),
      tenantRegistry: new FakeTenantRegistry(),
    });

    await new SignIn({
      identity,
      sessions: new InMemorySessionStore(),
      users: h.users,
      clock: h.clock,
      securityPolicy: new FakeSecurityPolicyRepository(),
    }).execute(attempt({ identifier: "nobody@shj.ae" }));

    expect(verifyCalls).toBe(1);
  });
});

describe("rate limiting", () => {
  it("applies the doubling schedule to consecutive failures", async () => {
    const h = harness();
    for (let i = 0; i < 4; i++) await h.signIn.execute(attempt({ secret: "wrong" }));
    expect(h.delays.calls).toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  it("caps the delay", async () => {
    const h = harness();
    for (let i = 0; i < 6; i++) await h.signIn.execute(attempt({ secret: "wrong" }));
    for (const delay of h.delays.calls.slice(3)) {
      expect(delay).toBeLessThanOrEqual(BACKOFF_CEILING_MS);
    }
  });

  it("locks the account after the threshold", async () => {
    const h = harness();
    for (let i = 0; i < FAILURES_BEFORE_LOCK; i++) {
      await h.signIn.execute(attempt({ secret: "wrong" }));
    }
    expect(await h.signIn.execute(attempt({ secret: "wrong" }))).toEqual({
      kind: "rejected",
      reason: "locked",
    });
  });

  it("refuses the correct password while locked", async () => {
    // A lock that the right password walks through is not a lock.
    const h = harness();
    for (let i = 0; i < FAILURES_BEFORE_LOCK; i++) {
      await h.signIn.execute(attempt({ secret: "wrong" }));
    }
    expect(await h.signIn.execute(attempt())).toEqual({ kind: "rejected", reason: "locked" });
  });

  it("lets the user back in once the lock elapses", async () => {
    const h = harness();
    for (let i = 0; i < FAILURES_BEFORE_LOCK; i++) {
      await h.signIn.execute(attempt({ secret: "wrong" }));
    }
    h.clock.advanceSeconds(LOCK_DURATION_MS / 1_000);
    expect((await h.signIn.execute(attempt())).kind).toBe("signed_in");
  });

  it("resets the counter after a success, so backoff stays progressive", async () => {
    const h = harness();
    await h.signIn.execute(attempt({ secret: "wrong" }));
    await h.signIn.execute(attempt());
    h.delays.calls.length = 0;

    await h.signIn.execute(attempt({ secret: "wrong" }));
    expect(h.delays.calls).toEqual([1_000]);
  });
});

describe("mandatory TOTP for privileged roles", () => {
  it("challenges a Super Admin rather than issuing a session", async () => {
    // ADR-0006 rule 4: any role holding agents:publish or users:manage.
    const h = harness({ roles: ["SuperAdmin"], totpSecret: TEST_TOTP_SECRET });
    const result = await h.signIn.execute(attempt());
    expect(result.kind).toBe("totp_required");
  });

  it("challenges an Entity Admin, who can publish", async () => {
    const h = harness({ roles: ["EntityAdmin"], totpSecret: TEST_TOTP_SECRET });
    expect((await h.signIn.execute(attempt())).kind).toBe("totp_required");
  });

  it.each(["AgentDesigner", "KnowledgeManager", "Reviewer", "LiveAgent", "Analyst"])(
    "does not challenge %s, who can neither publish nor manage users",
    async (role) => {
      const h = harness({ roles: [role], totpSecret: TEST_TOTP_SECRET });
      expect((await h.signIn.execute(attempt())).kind).toBe("signed_in");
    },
  );

  it("derives the requirement from the live matrix, not a list of role names", async () => {
    // Every cell in B9 tab 3 is a toggle. A custom role granted users:manage at
    // runtime must start requiring TOTP with no code change.
    const h = harness({ roles: ["CustomRole"], totpSecret: TEST_TOTP_SECRET });
    h.users.setMatrix({ ...SEEDED_ROLE_PERMISSIONS, CustomRole: ["users:manage"] });
    expect((await h.signIn.execute(attempt())).kind).toBe("totp_required");
  });

  it("mints a partial session that expires in five minutes", async () => {
    const h = harness({ roles: ["SuperAdmin"], totpSecret: TEST_TOTP_SECRET });
    const result = await h.signIn.execute(attempt());
    if (result.kind !== "totp_required") throw new Error("expected a challenge");

    const partial = await h.sessions.read(result.partialSessionId);
    expect(partial?.stage).toBe("partial");
    expect(h.sessions.ttlWrites.get(result.partialSessionId)).toBe(PARTIAL_SESSION_TTL.idleSeconds);
  });

  it("forces enrolment when a privileged user has no authenticator", async () => {
    const h = harness({ roles: ["SuperAdmin"], totpSecret: null });
    const result = await h.signIn.execute(attempt());
    expect(result.kind).toBe("enrolment_required");
    // No session of any kind until enrolment is done.
    expect(h.sessions.size()).toBe(0);
  });
});

describe("completing the second factor", () => {
  async function challenged(): Promise<{
    h: Harness;
    challengeId: string;
    partialSessionId: string;
  }> {
    const h = harness({ roles: ["SuperAdmin"], totpSecret: TEST_TOTP_SECRET });
    const result = await h.signIn.execute(attempt());
    if (result.kind !== "totp_required") throw new Error("expected a challenge");
    return { h, challengeId: result.challengeId, partialSessionId: result.partialSessionId };
  }

  function currentCode(clock: FakeClock): string {
    return totpCodeFor(TEST_TOTP_SECRET, totpStepAt(clock.now()));
  }

  it("promotes the partial session to a full one", async () => {
    const { h, challengeId, partialSessionId } = await challenged();
    const result = await h.completeTotp.execute({
      challengeId,
      partialSessionId,
      code: currentCode(h.clock),
    });

    expect(result.kind).toBe("signed_in");
    if (result.kind !== "signed_in") return;
    expect(result.principal.permissions.has("users:manage")).toBe(true);
  });

  it("rotates the session id, so a captured partial cookie is worthless", async () => {
    // api.md §3.1: sessions rotate on privilege change, and going from no
    // permissions to every permission is the largest one in the system.
    const { h, challengeId, partialSessionId } = await challenged();
    const result = await h.completeTotp.execute({
      challengeId,
      partialSessionId,
      code: currentCode(h.clock),
    });
    if (result.kind !== "signed_in") throw new Error("expected a session");

    expect(result.sessionId).not.toBe(partialSessionId);
    expect(await h.sessions.read(partialSessionId)).toBeNull();
  });

  it("rejects a wrong code", async () => {
    const { h, challengeId, partialSessionId } = await challenged();
    expect(await h.completeTotp.execute({ challengeId, partialSessionId, code: "000000" })).toEqual(
      { kind: "rejected", reason: "totp_invalid" },
    );
  });

  it("rejects a replayed code, even though it is arithmetically valid", async () => {
    const { h, challengeId, partialSessionId } = await challenged();
    const code = currentCode(h.clock);
    await h.completeTotp.execute({ challengeId, partialSessionId, code });

    // A second challenge, the same code inside its window.
    const again = await h.signIn.execute(attempt());
    if (again.kind !== "totp_required") throw new Error("expected a challenge");

    expect(
      await h.completeTotp.execute({
        challengeId: again.challengeId,
        partialSessionId: again.partialSessionId,
        code,
      }),
    ).toEqual({ kind: "rejected", reason: "totp_invalid" });
  });

  it("burns the challenge after five failures", async () => {
    const { h, challengeId, partialSessionId } = await challenged();
    for (let i = 0; i < 5; i++) {
      await h.completeTotp.execute({ challengeId, partialSessionId, code: "111111" });
    }
    // Even the correct code no longer works: the user restarts at the password
    // step (api.md §3.2).
    expect(
      await h.completeTotp.execute({
        challengeId,
        partialSessionId,
        code: currentCode(h.clock),
      }),
    ).toEqual({ kind: "rejected", reason: "totp_invalid" });
  });

  it("rejects an invented challenge id", async () => {
    const { h, partialSessionId } = await challenged();
    expect(
      await h.completeTotp.execute({
        challengeId: "challenge-999",
        partialSessionId,
        code: currentCode(h.clock),
      }),
    ).toEqual({ kind: "rejected", reason: "totp_invalid" });
  });

  it("rejects a challenge presented without a partial session", async () => {
    const { h, challengeId } = await challenged();
    expect(
      await h.completeTotp.execute({
        challengeId,
        partialSessionId: "session-999",
        code: currentCode(h.clock),
      }),
    ).toEqual({ kind: "rejected", reason: "totp_invalid" });
  });

  it("rejects a challenge paired with a different user's partial session", async () => {
    // The pairing attack: a victim's challenge id alongside the attacker's own
    // partial cookie. The subject mismatch rejects it.
    const { h, challengeId } = await challenged();
    const attacker = await h.sessions.create(
      {
        kind: "staff",
        stage: "partial",
        subjectId: "usr_attacker",
        tenant: TENANT,
        displayName: "",
        assurance: "L0",
        epoch: 0,
        binding: CLIENT,
        ttl: PARTIAL_SESSION_TTL,
      },
      h.clock.now(),
    );

    expect(
      await h.completeTotp.execute({
        challengeId,
        partialSessionId: attacker.id,
        code: currentCode(h.clock),
      }),
    ).toEqual({ kind: "rejected", reason: "totp_invalid" });
  });

  it("rejects an expired partial session", async () => {
    const { h, challengeId, partialSessionId } = await challenged();
    h.clock.advanceSeconds(PARTIAL_SESSION_TTL.absoluteSeconds + 1);
    expect(
      await h.completeTotp.execute({
        challengeId,
        partialSessionId,
        code: currentCode(h.clock),
      }),
    ).toEqual({ kind: "rejected", reason: "totp_invalid" });
  });

  it("refuses to promote a full session that is offered as a partial one", async () => {
    const h = harness({ roles: ["AgentDesigner"] });
    const signedIn = await h.signIn.execute(attempt());
    if (signedIn.kind !== "signed_in") throw new Error("expected a session");

    expect(
      await h.completeTotp.execute({
        challengeId: "challenge-1",
        partialSessionId: signedIn.sessionId,
        code: currentCode(h.clock),
      }),
    ).toEqual({ kind: "rejected", reason: "totp_invalid" });
  });
});

describe("tenant binding", () => {
  it("binds to the home tenant when none is requested", async () => {
    const h = harness();
    const result = await h.signIn.execute(attempt());
    if (result.kind !== "signed_in") throw new Error("expected a session");
    expect(result.principal.tenant).toBe(TENANT);
  });

  it("honours a requested tenant the user is a member of", async () => {
    const clock = new FakeClock();
    const users = new FakeUserRepository(SEEDED_ROLE_PERMISSIONS);
    const customs = "customs" as TenantSlug;
    users.seed({ user: staffUserFixture(), roles: ["AgentDesigner"] }, [TENANT, customs]);
    users.setRoles("usr_01JBSARA", customs, ["Analyst"]);

    const credentials = new FakeCredentialRepository();
    credentials.seed(credentialFixture());

    const identity = new LocalPasswordProvider({
      users,
      credentials,
      challenges: new InMemoryChallengeStore(),
      hasher: new FakePasswordHasher(),
      totp: new TotpVerifier({ replay: new InMemoryReplayGuard(), clock }),
      enrolment: new FakeEnrolmentTokenIssuer(),
      clock,
      delay: new RecordingDelay().delay,
      securityPolicy: new FakeSecurityPolicyRepository(),
      tenantRegistry: new FakeTenantRegistry(),
    });

    const result = await new SignIn({
      identity,
      sessions: new InMemorySessionStore(),
      users,
      clock,
      securityPolicy: new FakeSecurityPolicyRepository(),
    }).execute({ ...attempt(), tenant: customs });

    if (result.kind !== "signed_in") throw new Error("expected a session");
    expect(result.principal.tenant).toBe(customs);
    // Roles are per tenant: the same person is an Analyst here, not a designer.
    expect(result.principal.roles).toEqual(["Analyst"]);
  });

  it("refuses a tenant the user is not a member of, exactly like a wrong password", async () => {
    // ADR-0002 rule 1: a caller may choose among tenants the server has already
    // authorised, and no others.
    const h = harness();
    expect(await h.signIn.execute({ ...attempt(), tenant: "customs" as TenantSlug })).toEqual({
      kind: "rejected",
      reason: "invalid_credentials",
    });
  });
});
