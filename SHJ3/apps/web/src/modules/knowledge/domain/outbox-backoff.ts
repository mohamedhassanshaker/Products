/** §9.2's documented backoff schedule: `2^attemptCount` seconds, capped at one hour. A row past `maxAttempts` becomes `Dead` rather than being retried forever. Pure and separately tested so `process-knowledge-outbox.ts` doesn't have to re-derive the formula inline. */

const ONE_HOUR_SECONDS = 3600;

export function backoffSeconds(attemptCount: number): number {
  return Math.min(2 ** attemptCount, ONE_HOUR_SECONDS);
}

export function nextAvailableAt(now: Date, attemptCount: number): Date {
  return new Date(now.getTime() + backoffSeconds(attemptCount) * 1000);
}

export function outboxRowBecomesDead(attemptCount: number, maxAttempts: number): boolean {
  return attemptCount >= maxAttempts;
}
