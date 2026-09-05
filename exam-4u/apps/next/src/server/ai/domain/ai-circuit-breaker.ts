/**
 * A minimal, dependency-free circuit breaker for `AiService` (migration plan Phase 5) — ported
 * verbatim from `legacy/api/src/infrastructure/ai/ai-service/ai-circuit-breaker.ts`: "5 consecutive
 * failures open the breaker and the 6th call returns in <10 ms with no network I/O"; "the breaker
 * half-opens after `openDurationMs` and one probe closes it".
 *
 * Deliberately in-process, per-instance state (no shared cache/DB) — a breaker's whole purpose is to
 * protect *this* process's outbound calls from a dead dependency; sharing it across replicas would
 * add a coordination dependency for no benefit (each replica independently discovers and recovers
 * from an outage at the same wall-clock pace anyway).
 */
export type BreakerState = 'closed' | 'open' | 'half-open';

export class AiCircuitBreaker {
  private state: BreakerState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private halfOpenProbeInFlight = false;

  constructor(
    private readonly failureThreshold: number,
    private readonly openDurationMs: number,
  ) {}

  getState(): BreakerState {
    if (this.state === 'open' && Date.now() - this.openedAt >= this.openDurationMs) {
      this.state = 'half-open';
    }
    return this.state;
  }

  /** @returns `true` if a call is allowed to proceed (closed, or the single half-open probe slot). */
  allowRequest(): boolean {
    const state = this.getState();
    if (state === 'closed') return true;
    if (state === 'half-open' && !this.halfOpenProbeInFlight) {
      this.halfOpenProbeInFlight = true;
      return true;
    }
    return false; // open, or a half-open probe is already in flight
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'closed';
    this.halfOpenProbeInFlight = false;
  }

  /** Only connection/transport-classified failures should call this — a schema/content failure must
   * NEVER trip the breaker. */
  recordFailure(): void {
    this.halfOpenProbeInFlight = false;
    if (this.state === 'half-open') {
      // A failed probe re-opens the breaker immediately and restarts the open-duration clock.
      this.state = 'open';
      this.openedAt = Date.now();
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }
}
