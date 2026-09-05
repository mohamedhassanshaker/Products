import { describe, expect, it, vi } from 'vitest';
import type pino from 'pino';
import { PdfProcessingSessionEntity } from '@/server/infrastructure/database';
import type { PdfProcessingSessionRepository } from '../infrastructure/pdf-processing-session.repository';
import { StaleSessionRecoveryWorker } from './stale-session-recovery.worker';

function fakeSession(overrides: Partial<PdfProcessingSessionEntity> = {}): PdfProcessingSessionEntity {
  return Object.assign(new PdfProcessingSessionEntity(), {
    id: 'sess-1',
    status: 'Extracting',
    resumeAttempts: 0,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  });
}

function makeWorker(overrides?: {
  claimStale?: ReturnType<typeof vi.fn>;
  findById?: ReturnType<typeof vi.fn>;
  save?: ReturnType<typeof vi.fn>;
  findStaleCandidateIds?: ReturnType<typeof vi.fn>;
  resumeSession?: ReturnType<typeof vi.fn>;
  maxResumeAttempts?: number;
}) {
  const sessions = {
    claimStale: overrides?.claimStale ?? vi.fn().mockResolvedValue(true),
    findById: overrides?.findById ?? vi.fn().mockResolvedValue(fakeSession()),
    save: overrides?.save ?? vi.fn().mockImplementation(async (s: unknown) => s),
    findStaleCandidateIds: overrides?.findStaleCandidateIds ?? vi.fn().mockResolvedValue([]),
  } as unknown as PdfProcessingSessionRepository;

  const resumeSession = overrides?.resumeSession ?? vi.fn().mockResolvedValue(undefined);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as pino.Logger;

  const worker = new StaleSessionRecoveryWorker(sessions, resumeSession, 300_000, overrides?.maxResumeAttempts ?? 3, logger);
  return { worker, sessions, resumeSession, logger };
}

/** Unit coverage for the *policy* `recoverOne`/`sweepTenant` decide (resume vs Failed, tolerating a
 * single session's failure) — the underlying DB-level claim mechanism itself (real multi-replica race,
 * real conditional-update semantics) is a real-MySQL integration concern, not this suite's job. */
describe('StaleSessionRecoveryWorker', () => {
  describe('recoverOne', () => {
    it("returns 'not_claimed' when the conditional-update claim loses the race (affectedRows=0)", async () => {
      const { worker, sessions, resumeSession } = makeWorker({ claimStale: vi.fn().mockResolvedValue(false) });
      const outcome = await worker.recoverOne('sess-1', 'worker-A');
      expect(outcome).toBe('not_claimed');
      expect(sessions.findById).not.toHaveBeenCalled();
      expect(resumeSession).not.toHaveBeenCalled();
    });

    it('resumes a claimed session under the resume-attempts limit: increments resumeAttempts and calls the resume callback', async () => {
      const { worker, sessions, resumeSession } = makeWorker({
        findById: vi.fn().mockResolvedValue(fakeSession({ resumeAttempts: 1 })),
      });

      const outcome = await worker.recoverOne('sess-1', 'worker-A');

      expect(outcome).toBe('resumed');
      expect(sessions.save).toHaveBeenCalledWith(expect.objectContaining({ resumeAttempts: 2 }));
      expect(resumeSession).toHaveBeenCalledWith('sess-1');
    });

    it('fails a session that has already reached maxResumeAttempts, with a clear reason, and never calls the resume callback', async () => {
      const { worker, sessions, resumeSession } = makeWorker({
        findById: vi.fn().mockResolvedValue(fakeSession({ resumeAttempts: 3 })),
        maxResumeAttempts: 3,
      });

      const outcome = await worker.recoverOne('sess-1', 'worker-A');

      expect(outcome).toBe('failed');
      expect(sessions.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'Failed', errorCode: 'SESSION_RECOVERY_EXHAUSTED' }));
      expect(resumeSession).not.toHaveBeenCalled();
    });

    it('an unexpected throw from the resume callback is caught and logged, never left as an unhandled rejection', async () => {
      const { worker, logger } = makeWorker({
        resumeSession: vi.fn().mockRejectedValue(new Error('boom')),
      });
      await expect(worker.recoverOne('sess-1', 'worker-A')).resolves.toBe('resumed');
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-1' }), 'stale_session_recovery_resume_threw_unexpectedly');
    });

    it('a not-found session after a successful claim (defensive, unreachable in practice) returns not_claimed rather than throwing', async () => {
      const { worker } = makeWorker({ findById: vi.fn().mockResolvedValue(null) });
      expect(await worker.recoverOne('sess-1', 'worker-A')).toBe('not_claimed');
    });
  });

  describe('sweepTenant', () => {
    it("one candidate's recovery failing unexpectedly never stops the sweep from attempting the rest", async () => {
      const { worker, sessions } = makeWorker({
        findStaleCandidateIds: vi.fn().mockResolvedValue(['a', 'b']),
        claimStale: vi.fn().mockRejectedValueOnce(new Error('db boom')).mockResolvedValueOnce(true),
      });
      await worker.sweepTenant('worker-A');
      expect(sessions.claimStale).toHaveBeenCalledTimes(2);
    });

    it('attempts recovery for every stale candidate id returned', async () => {
      const { worker, sessions } = makeWorker({ findStaleCandidateIds: vi.fn().mockResolvedValue(['a', 'b', 'c']) });
      await worker.sweepTenant('worker-A');
      expect(sessions.claimStale).toHaveBeenCalledTimes(3);
    });
  });
});
