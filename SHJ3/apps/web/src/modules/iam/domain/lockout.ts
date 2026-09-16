/**
 * Login attempt counting, progressive backoff and account lockout.
 *
 * ADR-0006 rule 4: the local password adapter is throwaway code built to
 * production standard anyway, because it will front a government backoffice for
 * some period. Rate limiting is the part of that standard most often deferred,
 * so it is pure logic here rather than a middleware concern — which means it is
 * unit-testable without a clock, a store or a request.
 *
 * ## The schedule, and why it is shaped this way
 *
 * api.md §3.2: progressive backoff 1s → 2s → 4s … capped, then a 15-minute lock.
 * Two mechanisms, doing two different jobs:
 *
 *  - **Backoff** makes online guessing uneconomic while leaving a legitimate
 *    user who mistyped their password able to retry within seconds.
 *  - **Lockout** stops the attack outright once the attempt count can no longer
 *    be explained by typing errors.
 *
 * Backoff alone would let an attacker grind at one guess per cap interval
 * forever; a lock alone would turn three typos into a fifteen-minute outage for
 * a Super Admin. Both, in that order, is the compromise.
 *
 * ## Why not 429
 *
 * api.md §3.2 is explicit: a locked account answers `401 auth.account_locked`,
 * never `429`. A distinct status would distinguish "a real account under attack"
 * from "an unknown email", which is an account-enumeration oracle handed to the
 * attacker for free. The response shape is an adapter concern; the reason it must
 * not vary is recorded here because this module is what decides that a lock
 * happened.
 *
 * No vendor imports, no I/O, no ambient clock — `now` is always a parameter
 * (architecture.md §4).
 */

/**
 * The counters as persisted on `platform.StaffCredentials`.
 *
 * Deliberately the same two fields the table carries (`failedAttemptCount`,
 * `lockedUntil`) and nothing more: a lockout state that cannot round-trip
 * through the credential row would be a policy the database forgets on restart.
 */
export interface LockoutState {
  readonly failedAttemptCount: number;
  /** Exclusive: the account is usable again the instant the clock reaches this. */
  readonly lockedUntil: Date | null;
}

/** A clean slate — after a successful sign-in, and after a lock expires. */
export const NO_FAILURES: LockoutState = { failedAttemptCount: 0, lockedUntil: null };

/** First delay, applied after the first failure. */
export const BACKOFF_START_MS = 1_000;

/**
 * Ceiling on the doubling. Beyond this the lock does the work, so a larger cap
 * would only punish a legitimate user who is about to be locked out anyway.
 */
export const BACKOFF_CEILING_MS = 8_000;

/** Failures tolerated before the account locks. */
export const FAILURES_BEFORE_LOCK = 5;

export const LOCK_DURATION_MS = 15 * 60_000;

/**
 * `StaffCredentials.failedAttemptCount` is `TINYINT`, so the counter saturates
 * rather than wrapping. Saturating at 255 loses nothing: every value at or above
 * `FAILURES_BEFORE_LOCK` produces the same decision, and a wrapped counter would
 * silently reset an attacker's budget to zero.
 */
export const MAX_TRACKED_FAILURES = 255;

/**
 * How long to wait before honouring the next attempt, given the failures so far.
 *
 * Doubling from 1s, capped. Zero for a clean slate, so the common case — a user
 * signing in correctly — pays nothing.
 *
 * `ceilingMs` defaults to the hardcoded `BACKOFF_CEILING_MS` — optional so every existing
 * caller (and every test) is unaffected; a tenant's real `SecurityPolicy.backoffCeilingSeconds`
 * (Security tab, `modules/iam/domain/security-policy.ts`) is passed in `* 1000` by the one
 * real enforcement site (`LocalPasswordProvider`) that resolves it.
 */
export function backoffDelayMs(failedAttemptCount: number, ceilingMs: number = BACKOFF_CEILING_MS): number {
  if (failedAttemptCount <= 0) return 0;
  const doubled = BACKOFF_START_MS * 2 ** (failedAttemptCount - 1);
  return Math.min(doubled, ceilingMs);
}

/**
 * The state as it actually stands at `now`, with an elapsed lock cleared.
 *
 * **Every read goes through this.** A lock whose `lockedUntil` has passed also
 * resets the failure counter, which is what makes the backoff *progressive*
 * rather than permanent: a user who was locked out yesterday starts today at
 * full speed. Reading the stored row directly would leave them at an 8-second
 * backoff indefinitely.
 */
export function effectiveLockout(stored: LockoutState, now: Date): LockoutState {
  if (stored.lockedUntil && stored.lockedUntil.getTime() <= now.getTime()) return NO_FAILURES;
  return stored;
}

/** True while the account is locked. Reads the effective state, never the raw row. */
export function isLockedOut(stored: LockoutState, now: Date): boolean {
  return effectiveLockout(stored, now).lockedUntil !== null;
}

/**
 * The state after one more failed attempt.
 *
 * Reaching `failuresBeforeLock` sets the lock; the counter is kept rather than
 * reset so that the audit trail shows how far past the threshold the attempt
 * count went.
 *
 * `failuresBeforeLock`/`lockDurationMs` default to the hardcoded constants — optional so
 * every existing caller (and every test) is unaffected; the one real enforcement site
 * (`LocalPasswordProvider`) resolves the tenant's real `SecurityPolicy` and passes it in.
 */
export function afterFailedAttempt(
  stored: LockoutState,
  now: Date,
  failuresBeforeLock: number = FAILURES_BEFORE_LOCK,
  lockDurationMs: number = LOCK_DURATION_MS,
): LockoutState {
  const current = effectiveLockout(stored, now);
  const failedAttemptCount = Math.min(current.failedAttemptCount + 1, MAX_TRACKED_FAILURES);

  if (failedAttemptCount >= failuresBeforeLock) {
    return { failedAttemptCount, lockedUntil: new Date(now.getTime() + lockDurationMs) };
  }
  return { failedAttemptCount, lockedUntil: null };
}

/**
 * The state after a successful sign-in.
 *
 * A success clears the counter completely. The alternative — decrementing —
 * would let an attacker who knows one valid credential keep another account's
 * budget topped up, and buys nothing.
 */
export function afterSuccessfulAttempt(): LockoutState {
  return NO_FAILURES;
}

/**
 * Raised when an attempt arrives against a locked account.
 *
 * `retryAfterMs` is carried for logging and for the operator-facing B9 screen. It
 * is **not** for the HTTP response: api.md §3.2 requires the locked answer to be
 * byte-identical to a wrong password, so telling the caller when to come back
 * would reintroduce exactly the oracle the identical response exists to close.
 */
export class AccountLockedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("The account is temporarily locked after repeated failed sign-in attempts.");
    this.name = "AccountLockedError";
  }
}
