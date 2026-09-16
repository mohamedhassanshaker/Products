/**
 * RFC 6238 TOTP verification.
 *
 * ADR-0006 rule 4 makes a second factor mandatory for every role that can publish
 * or manage users, so this is the code standing between a stolen backoffice
 * password and a published government agent.
 *
 * ## Why this is implemented rather than imported
 *
 * `otpauth` and `speakeasy` both do this correctly. The choice to implement it is
 * about what the alternative actually buys:
 *
 *  - The algorithm is HMAC-SHA1 over an 8-byte counter plus a truncation, and
 *    Node's `crypto` provides the only hard part. What remains is base32 decoding
 *    and a modulo — about forty lines, all of it specified by RFC 6238 and none of
 *    it subject to change.
 *  - The two things this *must* get right are the skew window and single-use
 *    enforcement. Skew is four lines either way. Replay protection is not in any
 *    of those libraries, because it needs shared storage — so the interesting
 *    half would have been written here regardless, wrapped around a dependency
 *    that supplied the uninteresting half.
 *  - There is no CI and therefore no dependency scanning (RISK-002). A package in
 *    the authentication path is a supply-chain surface that has to be justified,
 *    and "saves forty lines of RFC-specified arithmetic" does not justify it.
 *
 * The parameters are the RFC 6238 baseline — SHA-1, 6 digits, 30-second step —
 * because that is what Google Authenticator, Microsoft Authenticator and 1Password
 * interoperate on. SHA-256 would be stronger in the abstract and unusable in
 * practice, and a second factor nobody can enrol is worse than a conventional one.
 *
 * ## Two failure modes that must both be rejected
 *
 *  1. **Skew.** A phone whose clock is a few seconds off produces the neighbouring
 *     step's code, so ±1 step is accepted (api.md §3.2). Wider would triple the
 *     guessing surface for a six-digit code; narrower would generate support
 *     tickets.
 *  2. **Replay.** A code stays arithmetically valid for the whole 90-second
 *     window, so accepting it twice is accepting it for 90 seconds — long enough
 *     to matter if it was read over someone's shoulder or captured by a proxy.
 *     api.md §3.2: a replayed code inside its window is `auth.totp_invalid`, not a
 *     success.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Clock } from "../../../platform/ports/provisioning.js";
import type { ReplayGuard } from "../../ports/session-store.js";

/** RFC 6238 default step. Authenticator apps assume it. */
export const TOTP_STEP_SECONDS = 30;

export const TOTP_DIGITS = 6;

/** ±1 step. See the module note on why not more. */
export const TOTP_SKEW_STEPS = 1;

/**
 * How long a used code is remembered: the full window it could still be accepted
 * in, plus one step of margin so a code accepted at the very edge of its window
 * cannot be replayed a second later at the edge of the next.
 */
export const TOTP_REPLAY_TTL_SECONDS = TOTP_STEP_SECONDS * (2 * TOTP_SKEW_STEPS + 2);

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * RFC 4648 base32, case-insensitive, padding and separators ignored.
 *
 * Authenticator apps display secrets in space-separated uppercase groups and
 * users paste them back with the spaces intact, so tolerating whitespace is not
 * laxity — it is the difference between enrolment working and not.
 */
export function decodeBase32(secret: string): Buffer {
  const normalised = secret.replace(/[\s=-]/g, "").toUpperCase();

  const bytes: number[] = [];
  let buffer = 0;
  let bitsHeld = 0;

  for (const character of normalised) {
    const value = BASE32_ALPHABET.indexOf(character);
    if (value < 0) {
      throw new Error("TOTP secret is not valid base32.");
    }
    buffer = (buffer << 5) | value;
    bitsHeld += 5;

    if (bitsHeld >= 8) {
      bitsHeld -= 8;
      bytes.push((buffer >> bitsHeld) & 0xff);
    }
  }

  if (bytes.length === 0) {
    throw new Error("TOTP secret is empty.");
  }
  return Buffer.from(bytes);
}

/** The RFC 6238 time step containing `now`. */
export function totpStepAt(now: Date): number {
  return Math.floor(now.getTime() / 1_000 / TOTP_STEP_SECONDS);
}

/**
 * The code for one counter value.
 *
 * The dynamic truncation is RFC 4226 §5.3: the low nibble of the last byte
 * selects a four-byte window, whose high bit is masked off so the result is
 * positive on every platform.
 */
export function totpCodeFor(secretBase32: string, counter: number, digits = TOTP_DIGITS): string {
  const counterBytes = Buffer.alloc(8);
  // Split across two 32-bit halves: a counter of seconds/30 stays well inside
  // Number's safe range, but `writeUInt32BE` is the only unsigned 64-bit-safe
  // way to lay it out without BigInt conversions on every verification.
  counterBytes.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBytes.writeUInt32BE(counter % 2 ** 32, 4);

  const digest = createHmac("sha1", decodeBase32(secretBase32)).update(counterBytes).digest();

  const lastByte = digest[digest.length - 1];
  if (lastByte === undefined) {
    throw new Error("HMAC digest was empty, which is impossible unless crypto is broken.");
  }
  const offset = lastByte & 0x0f;
  const truncated =
    ((digest[offset] ?? 0) & 0x7f) * 2 ** 24 +
    (digest[offset + 1] ?? 0) * 2 ** 16 +
    (digest[offset + 2] ?? 0) * 2 ** 8 +
    (digest[offset + 3] ?? 0);

  return String(truncated % 10 ** digits).padStart(digits, "0");
}

/**
 * Every code acceptable at `now`, oldest step first.
 *
 * Exported because the test suite needs to produce a valid code, a
 * one-step-stale code and a two-step-stale code without duplicating the
 * algorithm — a test that reimplements the code under test proves only that the
 * two agree with each other.
 */
export function totpCodesInWindow(
  secretBase32: string,
  now: Date,
  skewSteps = TOTP_SKEW_STEPS,
): string[] {
  const current = totpStepAt(now);
  const codes: string[] = [];
  for (let offset = -skewSteps; offset <= skewSteps; offset++) {
    codes.push(totpCodeFor(secretBase32, current + offset));
  }
  return codes;
}

/**
 * `replayed` is separated from `rejected` for logs and metrics only. Both become
 * `auth.totp_invalid` on the wire: a caller who could tell them apart would learn
 * that the code was arithmetically correct, which is a confirmation an attacker
 * holding a captured code should not get.
 */
export type TotpVerification = "accepted" | "rejected" | "replayed";

export interface TotpVerifierDeps {
  readonly replay: ReplayGuard;
  readonly clock: Clock;
}

export interface TotpVerifyInput {
  /** Namespaces the replay record. `StaffUsers.id`, so one user's code cannot burn another's. */
  readonly subject: string;
  readonly secretBase32: string;
  readonly code: string;
}

export class TotpVerifier {
  constructor(private readonly deps: TotpVerifierDeps) {}

  async verify(input: TotpVerifyInput): Promise<TotpVerification> {
    const submitted = input.code.replace(/\s/g, "");
    if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(submitted)) return "rejected";

    const candidates = totpCodesInWindow(input.secretBase32, this.deps.clock.now());

    // Every candidate is compared, and the results accumulated, rather than
    // returning on the first match. An early return leaks which step matched
    // through timing, which tells an attacker how far off the target's clock is —
    // small, but free to avoid.
    let matched = false;
    for (const candidate of candidates) {
      if (constantTimeEquals(candidate, submitted)) matched = true;
    }
    if (!matched) return "rejected";

    // Only a correct code is remembered. Recording wrong ones would let an
    // attacker fill the guard with guesses and lock the legitimate code out.
    const fresh = await this.deps.replay.remember(
      input.subject,
      submitted,
      TOTP_REPLAY_TTL_SECONDS,
    );
    return fresh ? "accepted" : "replayed";
  }
}

/**
 * Length-safe constant-time comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, and both operands here are
 * fixed-length digit strings, so an unequal length is already a rejection — but
 * checking it first keeps the throw unreachable rather than relying on the caller.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
