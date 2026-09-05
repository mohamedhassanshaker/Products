import type pino from 'pino';
import { AttemptsRepository } from '../infrastructure/attempts.repository';

/** Mirrors `StaleSessionRecoveryWorker`'s/`TenantMaintenanceWorker`'s own per-tenant candidate cap —
 * bounds a single sweep pass's query size. */
const MAX_CANDIDATES_PER_TENANT_PER_SWEEP = 200;

/**
 * FR-TAKE-6's belt-and-braces eager sweep (HLD §10.1/§10.4) — ported logic from
 * `legacy/api/src/modules/attempts/application/attempt-timeout-sweeper.worker.ts`.
 * `AttemptsService`'s lazy path (any read/write of a specific attempt closes it if its deadline has
 * passed) already guarantees a *served* attempt is never stale — but an attempt nobody ever looks at
 * again (a Member who closes the tab and never returns) would otherwise sit `InProgress` forever with
 * no lazy trigger to close it. This worker is that trigger, running independently of any request.
 *
 * **Deliberately additive, never a replacement**: reuses `AttemptsRepository.closeAndScore` — the
 * exact same `SELECT ... FOR UPDATE`-guarded transaction the lazy path already uses — so the two paths
 * racing the same attempt is provably safe (whichever gets the row lock first wins; the other's call
 * is a no-op once it observes `status !== 'InProgress'`), rather than this worker reimplementing its
 * own, second locking/scoring strategy.
 *
 * **One-tenant-at-a-time shape** (constructed already bound to a single tenant's `AttemptsRepository`,
 * mirroring `StaleSessionRecoveryWorker`'s identical "per-tenant instance, cross-tenant orchestration
 * lives in the composition root" split) — the actual cross-tenant enumeration lives in
 * `server/workers/attempt-timeout-sweeper.ts`, the composition root tying this class to
 * `platform/tenants`/`infrastructure/database`, exactly like `pdf-stale-session-recovery.ts` does for
 * `StaleSessionRecoveryWorker`.
 */
export class AttemptTimeoutSweeper {
  constructor(
    private readonly attempts: AttemptsRepository,
    private readonly logger: pino.Logger,
  ) {}

  /** One tenant's worth of the sweep. Tolerant of a single attempt's close failing unexpectedly (never
   * expected in practice — `closeAndScore` itself only ever returns `null` or a result, it doesn't
   * throw for the ordinary "already closed" race) so one bad row can never block the rest of the
   * batch. Returns the number of attempts this call actually closed. */
  async sweepTenant(): Promise<number> {
    const ids = await this.attempts.findTimedOutCandidateIds(MAX_CANDIDATES_PER_TENANT_PER_SWEEP);
    let closed = 0;
    for (const id of ids) {
      try {
        const outcome = await this.attempts.closeAndScore(id, 'TimedOut');
        if (outcome) closed += 1;
      } catch (err) {
        this.logger.error({ err, attemptId: id }, 'attempt_timeout_sweeper_close_failed');
      }
    }
    return closed;
  }
}
