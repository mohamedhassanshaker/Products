import type pino from 'pino';
import { PdfProcessingSessionRepository } from '../infrastructure/pdf-processing-session.repository';

/** Mirrors `TenantMaintenanceWorker.HYGIENE_SWEEP_PAGE_SIZE`'s own per-tenant candidate cap — bounds a
 * single sweep pass's query size. */
const MAX_CANDIDATES_PER_TENANT_PER_SWEEP = 50;

/** Every outcome one {@link StaleSessionRecoveryWorker.recoverOne} call can end in — used only for
 * caller-side logging/tests, never as control flow. */
export type RecoveryOutcome = 'not_claimed' | 'resumed' | 'failed';

/**
 * FR-REL-3's `StaleSessionRecoveryWorker` (HLD §10.1, migration plan Phase 6) — ported logic from
 * `legacy/api/src/modules/pdf-processing/application/stale-session-recovery.worker.ts`. Identifies
 * `pdf_processing_session` rows whose `heartbeat_at` has gone stale (the owning pass crashed, or the AI
 * engine was down and `processSession`'s graceful-degradation path deliberately left the session in a
 * resumable, non-`Failed` state) and either resumes them or, past `maxResumeAttempts`, fails them with a
 * clear, client-visible reason. This is what makes "no session is left indefinitely ambiguous" a real
 * property: every in-flight session is eventually either `Completed` or `Failed`, never stuck at
 * `Extracting`/`Classifying`/`Processing` forever.
 *
 * **No `SessionKindResumer[]` dispatch abstraction this sub-slice** — legacy's own Dev-26/BL-25
 * generalization exists only because a SECOND session kind (`full_bank_assessment`) was introduced at
 * that point; `apps/next` has no `session_kind` column and no second session kind anywhere yet (see
 * `PdfProcessingSessionEntity`'s own doc comment), so this worker resumes every claimed session via the
 * one real pipeline that exists (`resumeSession: (sessionId: string) => Promise<void>`, injected as a
 * plain function rather than a class — the composition root passes
 * `(id) => pdfProcessingService.resumeProcessing(id)`). Adding the resumer-array generalization is a
 * mechanical, backward-compatible change for whichever later sub-slice introduces a second session
 * kind — not a refactor this sub-slice needs to pre-build.
 *
 * **Full-sweep only (documented, disclosed scope limit, matching `OutboxPublisher`/
 * `TenantMaintenanceWorker`'s own identical precedent)**: no `tenant_work_hint`-driven hinted sweep
 * exists in `apps/next` (Phase 1c's own deferral) — this worker visits every `Active` tenant on each
 * sweep. Correctness does not depend on a hint at all, only the "avoid polling every tenant schema on a
 * fast tick" cost optimization does.
 */
export class StaleSessionRecoveryWorker {
  constructor(
    private readonly sessions: PdfProcessingSessionRepository,
    private readonly resumeSession: (sessionId: string) => Promise<void>,
    private readonly sessionHeartbeatStaleMs: number,
    private readonly maxResumeAttempts: number,
    private readonly logger: pino.Logger,
  ) {}

  /**
   * Attempts to claim and recover one session (already known to be a stale candidate). Returns
   * `'not_claimed'` if a concurrent claim attempt (this worker replica or another one) won the race
   * first — never an error, since losing a claim race is an expected, routine outcome, not a failure.
   */
  async recoverOne(sessionId: string, workerId: string): Promise<RecoveryOutcome> {
    const claimed = await this.sessions.claimStale(sessionId, workerId, this.sessionHeartbeatStaleMs);
    if (!claimed) return 'not_claimed';

    const session = await this.sessions.findById(sessionId);
    if (!session) return 'not_claimed'; // Defensive only — unreachable in practice (just claimed it).

    if (session.resumeAttempts >= this.maxResumeAttempts) {
      session.status = 'Failed';
      session.errorCode = 'SESSION_RECOVERY_EXHAUSTED';
      session.errorMessage = `Session stopped making progress and was not recovered after ${session.resumeAttempts} resume attempt(s) (heartbeat stale for over ${this.sessionHeartbeatStaleMs}ms each time).`;
      await this.sessions.save(session);
      this.logger.warn({ sessionId, resumeAttempts: session.resumeAttempts }, 'stale_session_recovery_exhausted');
      return 'failed';
    }

    session.resumeAttempts += 1;
    await this.sessions.save(session);
    this.logger.info({ sessionId, resumeAttempts: session.resumeAttempts }, 'stale_session_recovery_resuming');

    // The real pipeline catches and records every reachable failure internally (see
    // `PdfProcessingService.processSession`'s own doc comment) — nothing here needs a try/catch to
    // avoid an unhandled rejection, but one more layer of defense costs nothing.
    await this.resumeSession(sessionId).catch((err: unknown) => {
      this.logger.error({ err, sessionId }, 'stale_session_recovery_resume_threw_unexpectedly');
    });
    return 'resumed';
  }

  /** One tenant's worth of the sweep: finds stale in-flight candidates and attempts to recover each,
   * tolerant of any single session's recovery failing outright so it never blocks the rest of the
   * batch. */
  async sweepTenant(workerId: string): Promise<void> {
    const candidateIds = await this.sessions.findStaleCandidateIds(this.sessionHeartbeatStaleMs, MAX_CANDIDATES_PER_TENANT_PER_SWEEP);
    for (const id of candidateIds) {
      await this.recoverOne(id, workerId).catch((err: unknown) => {
        this.logger.error({ err, sessionId: id }, 'stale_session_recovery_unexpected_error');
      });
    }
  }
}
