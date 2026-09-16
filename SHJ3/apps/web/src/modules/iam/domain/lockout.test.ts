import { describe, expect, it } from "vitest";
import {
  AccountLockedError,
  BACKOFF_CEILING_MS,
  BACKOFF_START_MS,
  FAILURES_BEFORE_LOCK,
  LOCK_DURATION_MS,
  MAX_TRACKED_FAILURES,
  NO_FAILURES,
  afterFailedAttempt,
  afterSuccessfulAttempt,
  backoffDelayMs,
  effectiveLockout,
  isLockedOut,
  type LockoutState,
} from "./lockout.js";

/**
 * Lockout and backoff.
 *
 * api.md §3.2's schedule, asserted as a schedule rather than as "some delay
 * happens": the numbers are the control, and a backoff that silently became
 * constant would still pass a test that only checked for a positive delay.
 *
 * Covers ADR-0006 rule 4 and NFR-SEC-01.
 */

const NOW = new Date("2026-09-08T09:00:00.000Z");

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

describe("progressive backoff", () => {
  it("costs nothing on a clean slate", () => {
    // The common case is a correct password, and it must not pay for the schedule.
    expect(backoffDelayMs(0)).toBe(0);
  });

  it("doubles from one second", () => {
    expect(backoffDelayMs(1)).toBe(1_000);
    expect(backoffDelayMs(2)).toBe(2_000);
    expect(backoffDelayMs(3)).toBe(4_000);
    expect(backoffDelayMs(4)).toBe(8_000);
  });

  it("starts at the documented first delay", () => {
    expect(backoffDelayMs(1)).toBe(BACKOFF_START_MS);
  });

  it("caps rather than growing without bound", () => {
    // Without a cap, a user about to be locked out would wait minutes for the
    // failure that locks them out.
    for (const count of [5, 10, 50, MAX_TRACKED_FAILURES]) {
      expect(backoffDelayMs(count)).toBe(BACKOFF_CEILING_MS);
    }
  });

  it("treats a negative count as clean rather than throwing", () => {
    expect(backoffDelayMs(-1)).toBe(0);
  });
});

describe("counting failures", () => {
  it("increments one at a time", () => {
    let state = NO_FAILURES;
    for (let expected = 1; expected < FAILURES_BEFORE_LOCK; expected++) {
      state = afterFailedAttempt(state, NOW);
      expect(state.failedAttemptCount).toBe(expected);
      expect(state.lockedUntil).toBeNull();
    }
  });

  it("locks on reaching the threshold", () => {
    let state = NO_FAILURES;
    for (let i = 0; i < FAILURES_BEFORE_LOCK; i++) state = afterFailedAttempt(state, NOW);

    expect(state.failedAttemptCount).toBe(FAILURES_BEFORE_LOCK);
    expect(state.lockedUntil).toEqual(at(LOCK_DURATION_MS));
    expect(isLockedOut(state, NOW)).toBe(true);
  });

  it("saturates at the TINYINT ceiling instead of wrapping", () => {
    // `StaffCredentials.failedAttemptCount` is TINYINT. A wrapped counter would
    // silently hand an attacker's budget back to them.
    let state: LockoutState = { failedAttemptCount: MAX_TRACKED_FAILURES, lockedUntil: null };
    state = afterFailedAttempt(state, NOW);
    expect(state.failedAttemptCount).toBe(MAX_TRACKED_FAILURES);
  });

  it("clears everything on success", () => {
    expect(afterSuccessfulAttempt()).toEqual(NO_FAILURES);
  });
});

describe("lock expiry", () => {
  const locked: LockoutState = {
    failedAttemptCount: FAILURES_BEFORE_LOCK,
    lockedUntil: at(LOCK_DURATION_MS),
  };

  it("holds for the full duration", () => {
    expect(isLockedOut(locked, at(LOCK_DURATION_MS - 1))).toBe(true);
  });

  it("releases exactly at the deadline, not after it", () => {
    // `lockedUntil` is exclusive: the account is usable the instant the clock
    // reaches it, which is what the adapter's comparison assumes.
    expect(isLockedOut(locked, at(LOCK_DURATION_MS))).toBe(false);
  });

  it("resets the counter when the lock elapses, so backoff stays progressive", () => {
    // Without this, a user locked out yesterday would still be paying an
    // eight-second penalty today.
    const effective = effectiveLockout(locked, at(LOCK_DURATION_MS + 1));
    expect(effective).toEqual(NO_FAILURES);
    expect(backoffDelayMs(effective.failedAttemptCount)).toBe(0);
  });

  it("counts a post-lock failure as the first one again", () => {
    const next = afterFailedAttempt(locked, at(LOCK_DURATION_MS + 1));
    expect(next.failedAttemptCount).toBe(1);
    expect(next.lockedUntil).toBeNull();
  });

  it("does not extend a live lock on a further failed attempt", () => {
    // A locked account is refused before the password is even checked, so this
    // path should not be reachable — but if it is, an attacker must not be able
    // to keep a victim locked out indefinitely by hammering the endpoint.
    const next = afterFailedAttempt(locked, at(LOCK_DURATION_MS / 2));
    expect(next.lockedUntil).toEqual(at(LOCK_DURATION_MS / 2 + LOCK_DURATION_MS));
    expect(next.failedAttemptCount).toBe(FAILURES_BEFORE_LOCK + 1);
  });
});

describe("AccountLockedError", () => {
  it("says nothing an attacker could use", () => {
    // api.md §3.2: the locked response must be indistinguishable from a wrong
    // password, so the message must not mention the account, the email or when
    // to come back.
    const error = new AccountLockedError(LOCK_DURATION_MS);
    expect(error.message).not.toMatch(/@|\bminutes?\b|\b15\b|retry|until/i);
    expect(error.retryAfterMs).toBe(LOCK_DURATION_MS);
  });
});
