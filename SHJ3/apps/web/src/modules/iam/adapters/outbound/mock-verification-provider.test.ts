import { beforeEach, describe, expect, it } from "vitest";
import { validateConfig } from "../../../platform/config.js";
import {
  ASSURANCE_LEVELS,
  effectiveAssurance,
  satisfiesAssurance,
  type AssuranceLevel,
} from "../../domain/assurance.js";
import { FakeClock } from "../../testing/fakes.js";
import {
  MOCK_ASSURANCE_LIFETIME_SECONDS,
  MOCK_IDENTITY,
  MOCK_OTP_CODE,
  MockVerificationProvider,
  createMockVerificationProvider,
} from "./mock-verification-provider.js";

/**
 * The mock verification adapter.
 *
 * ADR-0006 rule 5: **these are the tests that will validate `UaePassProvider`,
 * unchanged.** So every assertion here is written against the port's contract and
 * never against the mock's internals — no reaching into private state, no
 * assertion that only an in-memory implementation could satisfy. The fixture
 * setters (`driveTo`, `rejectNext`, `setOwnership`) are the only mock-specific
 * calls, and each has an equivalent in a UAE PASS sandbox.
 *
 * Covers ADR-0006 rules 5 and 6, RISK-006, FR-VERI-09, api.md §9.9.
 */

const BASE_ENV = {
  SHJ3_ENVIRONMENT: "development",
  SHJ3_SQL_URL: "sqlserver://localhost:1433;database=shj3",
  SHJ3_REDIS_URL: "redis://localhost:6379",
  SHJ3_SESSION_SECRET: "local-dev-session-secret-not-for-production",
  SHJ3_VERIFICATION_ADAPTER: "mock",
  // Not "mock" — this file isolates the *verification* production guard; a mock
  // payment-gateway adapter would additionally trip B-8's own, separate guard
  // (config.test.ts covers that one) and muddy what these assertions are about.
  SHJ3_PAYMENT_GATEWAY_ADAPTER: "sharjahpay",
  // A real 32-byte key (config.ts, B-2) — any 32 bytes will do for this file's own
  // purpose, which is exercising the production-mock refusal, not encryption itself.
  SHJ3_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
};

describe("it cannot be constructed in production", () => {
  it("throws, citing the rule", () => {
    // ADR-0006 rule 6's second line of defence. platform/config.ts stops the
    // process; this stops the object, so a script or a route that constructs the
    // adapter directly cannot reach a production runtime by going around boot
    // validation.
    const config = validateConfig({
      ...BASE_ENV,
      SHJ3_ENVIRONMENT: "production",
      SHJ3_VERIFICATION_ADAPTER: "uaepass",
      SHJ3_SESSION_SECRET: "a".repeat(48),
    });

    expect(() => createMockVerificationProvider(config, { clock: new FakeClock() })).toThrow(
      /ADR-0006 rule 6/,
    );
  });

  it("names the actual risk rather than saying 'not allowed'", () => {
    const config = validateConfig({
      ...BASE_ENV,
      SHJ3_ENVIRONMENT: "production",
      SHJ3_VERIFICATION_ADAPTER: "otp",
      SHJ3_SESSION_SECRET: "a".repeat(48),
    });

    try {
      createMockVerificationProvider(config, { clock: new FakeClock() });
      expect.unreachable("must throw");
    } catch (error) {
      expect((error as Error).message).toMatch(/unauthenticated payment path/i);
    }
  });

  it("constructs everywhere else, because B11 is untestable without it", () => {
    for (const environment of ["development", "test", "staging"]) {
      const config = validateConfig({
        ...BASE_ENV,
        SHJ3_ENVIRONMENT: environment,
        SHJ3_SESSION_SECRET:
          environment === "staging" ? "a".repeat(48) : BASE_ENV.SHJ3_SESSION_SECRET,
      });
      expect(createMockVerificationProvider(config, { clock: new FakeClock() })).toBeInstanceOf(
        MockVerificationProvider,
      );
    }
  });
});

describe("all four assurance levels", () => {
  let clock: FakeClock;
  let provider: MockVerificationProvider;

  beforeEach(() => {
    clock = new FakeClock();
    provider = new MockVerificationProvider({ clock });
  });

  it("declares support for the whole ladder", () => {
    // A fixture that supports three rungs is a fixture whose tests do not carry
    // over when kiosk journeys land (RISK-006).
    expect(provider.supportedLevels()).toEqual(ASSURANCE_LEVELS);
  });

  it("reaches L1 through a UAE PASS-shaped redirect", async () => {
    const challenge = await provider.challenge({
      sessionId: "cs_01JB",
      targetLevel: "L1",
      channel: "widget",
      locale: "en",
    });

    expect(challenge.kind).toBe("redirect");
    expect(challenge.redirectUrl).toMatch(/^https:\/\//);

    const result = await provider.verify(challenge.challengeId, {
      kind: "callback",
      authorizationCode: "auth-code",
    });
    expect(result.level).toBe("L1");
  });

  it("reaches L2 through an OTP", async () => {
    const challenge = await provider.challenge({
      sessionId: "cs_01JB",
      targetLevel: "L2",
      channel: "widget",
      locale: "en",
    });
    expect(challenge.kind).toBe("otp");
    expect(challenge.redirectUrl).toBeNull();

    const result = await provider.verify(challenge.challengeId, {
      kind: "otp",
      code: MOCK_OTP_CODE,
    });
    expect(result.level).toBe("L2");
  });

  it("reaches L3 through a document scan, the level that currently gates nothing", async () => {
    const challenge = await provider.challenge({
      sessionId: "cs_01JB",
      targetLevel: "L3",
      channel: "kiosk",
      locale: "ar",
    });
    expect(challenge.kind).toBe("document_scan");

    const result = await provider.verify(challenge.challengeId, {
      kind: "document",
      scanReference: "scan-1",
    });
    expect(result.level).toBe("L3");
    expect(satisfiesAssurance(result.level, "L2")).toBe(true);
  });

  it("falls back to OTP on WhatsApp, which cannot follow a redirect", async () => {
    const challenge = await provider.challenge({
      sessionId: "cs_01JB",
      targetLevel: "L1",
      channel: "whatsapp",
      locale: "ar",
    });
    expect(challenge.kind).toBe("otp");
  });
});

describe("the verified identity", () => {
  let provider: MockVerificationProvider;
  let clock: FakeClock;

  beforeEach(() => {
    clock = new FakeClock();
    provider = new MockVerificationProvider({ clock });
  });

  async function verifyToL2(): Promise<{ level: AssuranceLevel; identityJson: string }> {
    const challenge = await provider.challenge({
      sessionId: "cs_01JB",
      targetLevel: "L2",
      channel: "widget",
      locale: "en",
    });
    const result = await provider.verify(challenge.challengeId, {
      kind: "otp",
      code: MOCK_OTP_CODE,
    });
    return { level: result.level, identityJson: JSON.stringify(result.identity) };
  }

  it("returns the Emirates ID already hashed", async () => {
    // api.md §12 invariant 4 / FR-VERI-09: a raw national identifier never
    // enters the application, so there is no field it could enter through.
    //
    // Asserted as "64 lowercase hex characters" rather than by an algorithm
    // prefix (`"sha256:..."` used to be here) — `CitizenIdentities.
    // emiratesIdHash` is `CHAR(64)` and `CK_CitizenIdentities_noPlaintextId`
    // requires `LEN(emiratesIdHash) = 64` exactly, a real constraint a
    // prefixed value overflows. Found live, against the real column, the
    // first time B-8's `CompleteVerification` actually persisted this value.
    const { identityJson } = await verifyToL2();
    const parsed = JSON.parse(identityJson) as { emiratesIdHash: string };
    expect(parsed.emiratesIdHash).toMatch(/^[0-9a-f]{64}$/);
    // A raw Emirates ID is 15 digits. None may appear anywhere in the payload.
    expect(identityJson).not.toMatch(/\d{15}/);
  });

  it("masks the mobile number", async () => {
    const { identityJson } = await verifyToL2();
    expect(identityJson).toContain(MOCK_IDENTITY.mobileMasked);
    expect(identityJson).toContain("*");
  });

  it("returns no identity at L0", async () => {
    // Returning one anyway would let application code read a verified name it has
    // no right to at that level.
    const provider2 = new MockVerificationProvider({ clock });
    const challenge = await provider2.challenge({
      sessionId: "cs_01JB",
      targetLevel: "L0",
      channel: "widget",
      locale: "en",
    });
    const result = await provider2.verify(challenge.challengeId, {
      kind: "callback",
      authorizationCode: "auth-code",
    });
    expect(result.level).toBe("L0");
    expect(result.identity).toBeNull();
  });
});

describe("assurance decays", () => {
  it("carries an expiry a payment two hours later cannot satisfy", async () => {
    // api.md §9.9. One OTP must not become a month of payment authority inside
    // a 30-day citizen session.
    const clock = new FakeClock();
    const provider = new MockVerificationProvider({ clock });

    const challenge = await provider.challenge({
      sessionId: "cs_01JB",
      targetLevel: "L2",
      channel: "widget",
      locale: "en",
    });
    const result = await provider.verify(challenge.challengeId, {
      kind: "otp",
      code: MOCK_OTP_CODE,
    });

    expect(result.expiresAt.getTime() - result.verifiedAt.getTime()).toBe(
      MOCK_ASSURANCE_LIFETIME_SECONDS * 1_000,
    );

    clock.advanceSeconds(2 * 60 * 60);
    const held = {
      level: result.level,
      verifiedAt: result.verifiedAt,
      expiresAt: result.expiresAt,
    };
    expect(satisfiesAssurance(effectiveAssurance(held, clock.now()), "L2")).toBe(false);
  });

  it("can be driven to an already-expired result", async () => {
    const clock = new FakeClock();
    const provider = new MockVerificationProvider({ clock });
    provider.setAssuranceLifetime(0);

    const challenge = await provider.challenge({
      sessionId: "cs_01JB",
      targetLevel: "L2",
      channel: "widget",
      locale: "en",
    });
    const result = await provider.verify(challenge.challengeId, {
      kind: "otp",
      code: MOCK_OTP_CODE,
    });

    expect(
      effectiveAssurance(
        { level: result.level, verifiedAt: result.verifiedAt, expiresAt: result.expiresAt },
        clock.now(),
      ),
    ).toBe("L0");
  });
});

describe("failure is reachable", () => {
  let clock: FakeClock;
  let provider: MockVerificationProvider;

  beforeEach(() => {
    clock = new FakeClock();
    provider = new MockVerificationProvider({ clock });
  });

  async function otpChallenge(): Promise<string> {
    const challenge = await provider.challenge({
      sessionId: "cs_01JB",
      targetLevel: "L2",
      channel: "widget",
      locale: "en",
    });
    return challenge.challengeId;
  }

  it("returns L0 for a wrong OTP", async () => {
    const id = await otpChallenge();
    const result = await provider.verify(id, { kind: "otp", code: "999999" });
    expect(result.level).toBe("L0");
    expect(result.identity).toBeNull();
  });

  it("returns L0 when driven to reject", async () => {
    const id = await otpChallenge();
    provider.rejectNext();
    expect((await provider.verify(id, { kind: "otp", code: MOCK_OTP_CODE })).level).toBe("L0");
  });

  it("recovers after one driven rejection, so a test drives failures one at a time", async () => {
    const first = await otpChallenge();
    provider.rejectNext();
    await provider.verify(first, { kind: "otp", code: MOCK_OTP_CODE });

    const second = await otpChallenge();
    expect((await provider.verify(second, { kind: "otp", code: MOCK_OTP_CODE })).level).toBe("L2");
  });

  it("returns L0 for an invented challenge id", async () => {
    expect(
      (await provider.verify("mockchal_nope", { kind: "otp", code: MOCK_OTP_CODE })).level,
    ).toBe("L0");
  });

  it("spends a challenge on first use, whatever the outcome", async () => {
    // Real authorization codes are one-shot, so a fixture that allowed reuse
    // would let the application replay one and nothing would catch it until UAE
    // PASS was connected.
    const id = await otpChallenge();
    expect((await provider.verify(id, { kind: "otp", code: MOCK_OTP_CODE })).level).toBe("L2");
    expect((await provider.verify(id, { kind: "otp", code: MOCK_OTP_CODE })).level).toBe("L0");
  });

  it("returns L0 for an expired challenge", async () => {
    const id = await otpChallenge();
    clock.advanceSeconds(10 * 60);
    expect((await provider.verify(id, { kind: "otp", code: MOCK_OTP_CODE })).level).toBe("L0");
  });

  it("refuses a response of the wrong kind", async () => {
    // A test that completes a redirect challenge with an OTP code has found a
    // real application bug; a lenient mock would hide it.
    const challenge = await provider.challenge({
      sessionId: "cs_01JB",
      targetLevel: "L1",
      channel: "widget",
      locale: "en",
    });
    expect(
      (await provider.verify(challenge.challengeId, { kind: "otp", code: MOCK_OTP_CODE })).level,
    ).toBe("L0");
  });
});

describe("driveTo lets a test reproduce a provider returning less than was asked", () => {
  it("grants the forced level rather than the requested one", async () => {
    // The case worth having: UAE PASS returning an identity but no OTP.
    // Application code that assumes it got what it requested is the bug this
    // exists to catch.
    const provider = new MockVerificationProvider({ clock: new FakeClock() });
    provider.driveTo("L1");

    const challenge = await provider.challenge({
      sessionId: "cs_01JB",
      targetLevel: "L2",
      channel: "widget",
      locale: "en",
    });
    const result = await provider.verify(challenge.challengeId, {
      kind: "otp",
      code: MOCK_OTP_CODE,
    });

    expect(result.level).toBe("L1");
    expect(satisfiesAssurance(result.level, "L2")).toBe(false);
  });

  it("goes back to honouring the request when cleared", async () => {
    const provider = new MockVerificationProvider({ clock: new FakeClock() });
    provider.driveTo("L1");
    provider.driveTo(null);

    const challenge = await provider.challenge({
      sessionId: "cs_01JB",
      targetLevel: "L2",
      channel: "widget",
      locale: "en",
    });
    expect(
      (await provider.verify(challenge.challengeId, { kind: "otp", code: MOCK_OTP_CODE })).level,
    ).toBe("L2");
  });
});

describe("the account-ownership check", () => {
  const account = { accountNumber: "SEWA-4471", serviceKind: "electricity" };

  it("matches by default", async () => {
    const provider = new MockVerificationProvider({ clock: new FakeClock() });
    expect(await provider.confirmAccountOwnership(MOCK_IDENTITY, account)).toEqual({
      matched: true,
      reason: "matched",
    });
  });

  it("can be driven to refuse — B11 tab 1's most consequential toggle", async () => {
    const provider = new MockVerificationProvider({ clock: new FakeClock() });
    provider.setOwnership({ matched: false, reason: "not_matched" });
    expect((await provider.confirmAccountOwnership(MOCK_IDENTITY, account)).matched).toBe(false);
  });

  it("distinguishes an outage from a refusal", async () => {
    // A directory being down must not read as "this account is not yours": the
    // caller fails closed either way, but only one of the two is worth paging
    // someone about.
    const provider = new MockVerificationProvider({ clock: new FakeClock() });
    provider.setOwnership({ matched: false, reason: "unavailable" });
    const result = await provider.confirmAccountOwnership(MOCK_IDENTITY, account);
    expect(result.reason).toBe("unavailable");
    expect(result.matched).toBe(false);
  });
});

describe("reset", () => {
  it("clears state so it cannot leak between tests", async () => {
    const provider = new MockVerificationProvider({ clock: new FakeClock() });
    provider.driveTo("L0");
    provider.setOwnership({ matched: false, reason: "not_matched" });
    provider.rejectNext();
    provider.setAssuranceLifetime(1);

    provider.reset();

    const challenge = await provider.challenge({
      sessionId: "cs_01JB",
      targetLevel: "L2",
      channel: "widget",
      locale: "en",
    });
    const result = await provider.verify(challenge.challengeId, {
      kind: "otp",
      code: MOCK_OTP_CODE,
    });

    expect(result.level).toBe("L2");
    expect(result.expiresAt.getTime() - result.verifiedAt.getTime()).toBe(
      MOCK_ASSURANCE_LIFETIME_SECONDS * 1_000,
    );
    expect(
      (
        await provider.confirmAccountOwnership(MOCK_IDENTITY, {
          accountNumber: "SEWA-1",
          serviceKind: "water",
        })
      ).matched,
    ).toBe(true);
  });
});
