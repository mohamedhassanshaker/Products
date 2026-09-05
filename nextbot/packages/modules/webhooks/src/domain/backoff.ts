/** FR-API-02's "retry/backoff policy". Pure, unit-testable, no I/O — the same
 * "policy math lives in domain/, never inline in the writer" discipline this
 * codebase's other retry/sweep mechanics (SLA sweep, approval-expiry sweep) follow.
 *
 * Exponential backoff with a fixed base and cap, deterministic (no jitter) so a delay
 * is reproducible in a test — matching the fact that at-least-once delivery already
 * tolerates a duplicate attempt; jitter would only help thundering-herd concerns this
 * per-tenant, per-subscription dispatcher does not have at real-world scale.
 */
export const MAX_DELIVERY_ATTEMPTS = 8;

const BASE_DELAY_MS = 30_000; // 30s
const MAX_DELAY_MS = 60 * 60_000; // 1h cap

/** The delay before the NEXT attempt, given `attemptCount` attempts already made
 * (0-indexed: called with `0` after the very first attempt failed, to schedule the
 * second). Doubles each time, capped at `MAX_DELAY_MS`. */
export function nextRetryDelayMs(attemptCount: number): number {
  const delay = BASE_DELAY_MS * 2 ** Math.max(0, attemptCount - 1);
  return Math.min(delay, MAX_DELAY_MS);
}

/** Whether a delivery that has failed `attemptCount` times should be retried again,
 * or marked `Exhausted` and left in the log for inspection (FR-API-02's own
 * "delivery-log for debugging failed deliveries" — an exhausted delivery is not
 * deleted, only stopped). */
export function shouldRetry(attemptCount: number): boolean {
  return attemptCount < MAX_DELIVERY_ATTEMPTS;
}
