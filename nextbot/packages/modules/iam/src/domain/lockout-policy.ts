/**
 * Pure lockout-decision logic (FR-SEC-03). Kept side-effect-free and unit-tested
 * exhaustively; the application layer (`authenticate-user.ts`) is responsible for
 * reading/writing the actual `app_user.failed_login_count` / `locked_until` columns
 * and calling into this module to decide what those writes should be.
 */

export interface LockoutPolicy {
  /** Default 5, per this dispatch's brief / FR-SEC-03. */
  maxFailedAttempts: number;
  /** Default 15, per this dispatch's brief / FR-SEC-03. */
  cooldownMinutes: number;
}

export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = {
  maxFailedAttempts: 5,
  cooldownMinutes: 15,
};

export interface LockoutState {
  failedLoginCount: number;
  lockedUntil: Date | null;
}

/**
 * Returns whether the account is currently locked, given its stored state and "now".
 * A `lockedUntil` in the past is treated as unlocked (the cooldown has elapsed) even
 * if `failedLoginCount` hasn't been reset yet — resetting the counter is the caller's
 * job on the next successful login, not this function's.
 */
export function isLocked(state: LockoutState, now: Date = new Date()): boolean {
  return state.lockedUntil != null && state.lockedUntil.getTime() > now.getTime();
}

/** Seconds remaining until the lockout cooldown expires (0 if not locked). */
export function lockoutRetryAfterSeconds(state: LockoutState, now: Date = new Date()): number {
  if (!isLocked(state, now)) return 0;
  return Math.ceil(((state.lockedUntil as Date).getTime() - now.getTime()) / 1000);
}

/**
 * Computes the next lockout state after a failed login attempt. Once
 * `failedLoginCount` (post-increment) reaches `maxFailedAttempts`, `lockedUntil` is
 * set to `now + cooldownMinutes` and the counter is reset to 0 for the *next* window
 * (so a subsequent failed attempt after the cooldown starts counting fresh, rather
 * than instantly re-locking on attempt 1 of the new window).
 */
export function recordFailedAttempt(
  state: LockoutState,
  policy: LockoutPolicy = DEFAULT_LOCKOUT_POLICY,
  now: Date = new Date(),
): LockoutState {
  const nextCount = state.failedLoginCount + 1;
  if (nextCount >= policy.maxFailedAttempts) {
    return {
      failedLoginCount: 0,
      lockedUntil: new Date(now.getTime() + policy.cooldownMinutes * 60_000),
    };
  }
  return { failedLoginCount: nextCount, lockedUntil: state.lockedUntil };
}

/** The state to persist after a successful login: counters cleared, lock released. */
export function recordSuccessfulAttempt(): LockoutState {
  return { failedLoginCount: 0, lockedUntil: null };
}
