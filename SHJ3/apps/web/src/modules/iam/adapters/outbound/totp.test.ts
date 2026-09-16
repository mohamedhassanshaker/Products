import { describe, expect, it } from "vitest";
import { FakeClock, InMemoryReplayGuard, TEST_TOTP_SECRET } from "../../testing/fakes.js";
import {
  TOTP_DIGITS,
  TOTP_REPLAY_TTL_SECONDS,
  TOTP_SKEW_STEPS,
  TOTP_STEP_SECONDS,
  TotpVerifier,
  decodeBase32,
  totpCodeFor,
  totpCodesInWindow,
  totpStepAt,
} from "./totp.js";

/**
 * TOTP.
 *
 * Two properties carry the weight here — the skew window and single-use
 * enforcement — because they are the two an implementation gets wrong in ways a
 * happy-path test cannot see: a window one step too wide triples the guessing
 * surface, and a missing replay check leaves a captured code valid for 90
 * seconds.
 *
 * The RFC 6238 test vectors are asserted as well, because an implementation that
 * is self-consistent but not RFC-compliant produces codes no authenticator app
 * agrees with — and that failure surfaces during enrolment, in front of a user.
 *
 * Covers ADR-0006 rule 4 and api.md §3.2.
 */

const SUBJECT = "usr_01JBSARA";

function verifierAt(iso: string): { verifier: TotpVerifier; clock: FakeClock } {
  const clock = new FakeClock(new Date(iso));
  const verifier = new TotpVerifier({ replay: new InMemoryReplayGuard(), clock });
  return { verifier, clock };
}

describe("RFC 6238 conformance", () => {
  /**
   * The RFC 6238 appendix B vectors for HMAC-SHA1, using the published seed
   * `12345678901234567890` — base32 `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ`.
   * Truncated to six digits, which is what authenticator apps display.
   */
  const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

  it.each([
    [59, "287082"],
    [1_111_111_109, "081804"],
    [1_111_111_111, "050471"],
    [1_234_567_890, "005924"],
    [2_000_000_000, "279037"],
  ])("matches the published code at t=%i", (epochSeconds, expected) => {
    const counter = Math.floor(epochSeconds / TOTP_STEP_SECONDS);
    expect(totpCodeFor(RFC_SECRET, counter)).toBe(expected);
  });

  it("uses the 30-second step and 6 digits authenticator apps assume", () => {
    expect(TOTP_STEP_SECONDS).toBe(30);
    expect(TOTP_DIGITS).toBe(6);
  });

  it("pads a short code to the full width", () => {
    // A truncation that happens to be small must still be six characters, or a
    // client comparing strings rejects a valid code.
    const counter = Math.floor(1_234_567_890 / TOTP_STEP_SECONDS);
    expect(totpCodeFor(RFC_SECRET, counter)).toHaveLength(TOTP_DIGITS);
  });

  it("advances the step every 30 seconds", () => {
    const base = totpStepAt(new Date("2026-09-08T09:00:00.000Z"));
    expect(totpStepAt(new Date("2026-09-08T09:00:29.999Z"))).toBe(base);
    expect(totpStepAt(new Date("2026-09-08T09:00:30.000Z"))).toBe(base + 1);
  });
});

describe("base32 decoding", () => {
  it("tolerates the spacing and case an authenticator app displays", () => {
    // Users paste the secret back with the app's spaces intact. Rejecting that
    // breaks enrolment for no security benefit.
    const spaced = decodeBase32("jbsw y3dp ehpk 3pxp");
    expect(spaced.equals(decodeBase32(TEST_TOTP_SECRET))).toBe(true);
  });

  it("ignores padding", () => {
    expect(decodeBase32("JBSWY3DPEHPK3PXP=====").equals(decodeBase32(TEST_TOTP_SECRET))).toBe(true);
  });

  it("rejects a secret that is not base32", () => {
    expect(() => decodeBase32("not-base32!")).toThrow(/base32/);
  });

  it("rejects an empty secret rather than hashing nothing", () => {
    expect(() => decodeBase32("")).toThrow(/empty/);
  });
});

describe("the skew window", () => {
  const AT = "2026-09-08T09:05:00.000Z";

  it("accepts the current code", async () => {
    const { verifier, clock } = verifierAt(AT);
    const current = totpCodeFor(TEST_TOTP_SECRET, totpStepAt(clock.now()));
    await expect(
      verifier.verify({ subject: SUBJECT, secretBase32: TEST_TOTP_SECRET, code: current }),
    ).resolves.toBe("accepted");
  });

  it("accepts one step either side, for a phone with a drifting clock", async () => {
    const step = totpStepAt(new Date(AT));
    for (const offset of [-1, 1]) {
      const { verifier } = verifierAt(AT);
      const code = totpCodeFor(TEST_TOTP_SECRET, step + offset);
      await expect(
        verifier.verify({ subject: SUBJECT, secretBase32: TEST_TOTP_SECRET, code }),
      ).resolves.toBe("accepted");
    }
  });

  it("rejects two steps out, so the window stays ±1", async () => {
    // Widening this triples the guessing surface for a six-digit code. api.md
    // §3.2 fixes it at ±1 step.
    const step = totpStepAt(new Date(AT));
    for (const offset of [-2, 2]) {
      const { verifier } = verifierAt(AT);
      const code = totpCodeFor(TEST_TOTP_SECRET, step + offset);
      await expect(
        verifier.verify({ subject: SUBJECT, secretBase32: TEST_TOTP_SECRET, code }),
      ).resolves.toBe("rejected");
    }
  });

  it("offers exactly three candidate codes", () => {
    expect(totpCodesInWindow(TEST_TOTP_SECRET, new Date(AT))).toHaveLength(2 * TOTP_SKEW_STEPS + 1);
  });

  it("rejects a code that expires while the user is typing", async () => {
    const { verifier, clock } = verifierAt(AT);
    const stale = totpCodeFor(TEST_TOTP_SECRET, totpStepAt(clock.now()));
    // Two steps later the code is outside the window, even though it was valid
    // when it appeared on screen.
    clock.advanceSeconds(TOTP_STEP_SECONDS * 2);
    await expect(
      verifier.verify({ subject: SUBJECT, secretBase32: TEST_TOTP_SECRET, code: stale }),
    ).resolves.toBe("rejected");
  });

  it("rejects a malformed code without consulting the secret", async () => {
    const { verifier } = verifierAt(AT);
    for (const code of ["", "12345", "1234567", "abcdef", "12 34 5"]) {
      await expect(
        verifier.verify({ subject: SUBJECT, secretBase32: TEST_TOTP_SECRET, code }),
      ).resolves.toBe("rejected");
    }
  });

  it("strips the spaces an authenticator app puts in a code", async () => {
    const { verifier, clock } = verifierAt(AT);
    const current = totpCodeFor(TEST_TOTP_SECRET, totpStepAt(clock.now()));
    const spaced = `${current.slice(0, 3)} ${current.slice(3)}`;
    await expect(
      verifier.verify({ subject: SUBJECT, secretBase32: TEST_TOTP_SECRET, code: spaced }),
    ).resolves.toBe("accepted");
  });
});

describe("replay rejection", () => {
  const AT = "2026-09-08T09:05:00.000Z";

  it("refuses the same code twice", async () => {
    // api.md §3.2: a replayed code inside its window is auth.totp_invalid, not a
    // success. Without this, a shoulder-surfed code stays usable for 90 seconds.
    const { verifier, clock } = verifierAt(AT);
    const code = totpCodeFor(TEST_TOTP_SECRET, totpStepAt(clock.now()));
    const input = { subject: SUBJECT, secretBase32: TEST_TOTP_SECRET, code };

    await expect(verifier.verify(input)).resolves.toBe("accepted");
    await expect(verifier.verify(input)).resolves.toBe("replayed");
  });

  it("still refuses it after the clock moves inside the window", async () => {
    const { verifier, clock } = verifierAt(AT);
    const code = totpCodeFor(TEST_TOTP_SECRET, totpStepAt(clock.now()));
    const input = { subject: SUBJECT, secretBase32: TEST_TOTP_SECRET, code };

    await expect(verifier.verify(input)).resolves.toBe("accepted");
    clock.advanceSeconds(TOTP_STEP_SECONDS);
    await expect(verifier.verify(input)).resolves.toBe("replayed");
  });

  it("namespaces by subject, so one user's code cannot burn another's", async () => {
    const clock = new FakeClock(new Date(AT));
    const verifier = new TotpVerifier({ replay: new InMemoryReplayGuard(), clock });
    const code = totpCodeFor(TEST_TOTP_SECRET, totpStepAt(clock.now()));

    await expect(
      verifier.verify({ subject: "usr_a", secretBase32: TEST_TOTP_SECRET, code }),
    ).resolves.toBe("accepted");
    await expect(
      verifier.verify({ subject: "usr_b", secretBase32: TEST_TOTP_SECRET, code }),
    ).resolves.toBe("accepted");
  });

  it("does not remember wrong codes", async () => {
    // Remembering failures would let an attacker pre-burn the legitimate code by
    // guessing it before the user types it.
    const { verifier, clock } = verifierAt(AT);
    const step = totpStepAt(clock.now());
    const future = totpCodeFor(TEST_TOTP_SECRET, step + 5);

    await expect(
      verifier.verify({ subject: SUBJECT, secretBase32: TEST_TOTP_SECRET, code: future }),
    ).resolves.toBe("rejected");

    // The same code becomes legitimate five steps later, and must be accepted.
    clock.advanceSeconds(TOTP_STEP_SECONDS * 5);
    await expect(
      verifier.verify({ subject: SUBJECT, secretBase32: TEST_TOTP_SECRET, code: future }),
    ).resolves.toBe("accepted");
  });

  it("remembers a used code for longer than it could still be accepted", () => {
    // The guard's TTL must outlast the acceptance window, or a code could be
    // forgotten while still arithmetically valid.
    const acceptanceWindow = TOTP_STEP_SECONDS * (2 * TOTP_SKEW_STEPS + 1);
    expect(TOTP_REPLAY_TTL_SECONDS).toBeGreaterThan(acceptanceWindow);
  });
});
