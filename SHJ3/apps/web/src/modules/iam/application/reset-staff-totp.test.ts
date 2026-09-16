import { describe, expect, it } from "vitest";
import { ResetStaffTotp } from "./reset-staff-totp.js";
import { SignIn } from "./sign-in.js";
import { LocalPasswordProvider } from "../adapters/outbound/local-password-provider.js";
import { TotpVerifier } from "../adapters/outbound/totp.js";
import { SEEDED_ROLE_PERMISSIONS } from "../domain/permissions.js";
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

/**
 * A privileged role's TOTP reset — the Security tab's per-row "Reset" action, through
 * `IdentityProvider` only (`ResetStaffTotp`'s own doc comment on why not `CredentialRepository`
 * directly). Proves the reset actually forces re-enrolment: a sign-in that used to reach the
 * TOTP challenge step now reaches `enrolment_required` again.
 */
describe("resetting a staff user's TOTP enrolment", () => {
  it("forces re-enrolment on the next sign-in", async () => {
    const clock = new FakeClock();
    const users = new FakeUserRepository(SEEDED_ROLE_PERMISSIONS);
    users.seed({ user: staffUserFixture(), roles: ["SuperAdmin"] });
    const credentials = new FakeCredentialRepository();
    credentials.seed(credentialFixture({ totpSecret: TEST_TOTP_SECRET }));
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

    const signIn = new SignIn({
      identity,
      sessions: new InMemorySessionStore(),
      users,
      clock,
      securityPolicy,
    });

    const before = await signIn.execute({
      identifier: "sara.almazrouei@shj.ae",
      secret: "correct-horse",
      tenant: null,
      client: { userAgentFamily: "Mozilla", ipBlock: "10.20.30" },
    });
    expect(before.kind).toBe("totp_required");

    await new ResetStaffTotp({ identity }).execute({
      staffUserId: "usr_01JBSARA",
      now: clock.now(),
    });

    const statusBefore = await identity.listTotpEnrolmentStatus(["usr_01JBSARA"]);
    expect(statusBefore.get("usr_01JBSARA")).toBe(false);

    const after = await signIn.execute({
      identifier: "sara.almazrouei@shj.ae",
      secret: "correct-horse",
      tenant: null,
      client: { userAgentFamily: "Mozilla", ipBlock: "10.20.30" },
    });
    expect(after.kind).toBe("enrolment_required");
  });
});
