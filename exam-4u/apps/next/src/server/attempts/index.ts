import { requireTenantDataSource } from '@/server/context';
import { getPermissionResolutionService } from '@/server/rbac';
import { buildMediaServices } from '@/server/media';
import { AttemptsService } from './application/attempts.service';
import { AttemptTimeoutSweeper } from './application/attempt-timeout-sweeper';
import { AttemptsRepository } from './infrastructure/attempts.repository';

export { AttemptsService, AttemptTimeoutSweeper, AttemptsRepository };
export { selectAdaptiveQuestions, shuffleInPlace, QuestionBankShortfallError } from './domain/adaptive-selection';
export type { AdaptiveCandidate, AnswerHistory } from './domain/adaptive-selection';
export {
  AttemptAlreadyInProgressError,
  AttemptExamTypeNotFoundError,
  AttemptNotFoundError,
  AttemptNotInProgressError,
  AttemptQuestionNotFoundError,
  InsufficientQuestionBankError,
  NotAttemptOwnerError,
} from './domain/errors';
export type {
  AnswerResult,
  AttemptHeader,
  AttemptHistoryItem,
  AttemptQuestionImage,
  AttemptQuestionView,
  AttemptReview,
  AttemptReviewItem,
  AttemptStatus,
  AvailableExamSummary,
  ExamInstructions,
  StartAttemptResult,
  SubmitResult,
} from './domain/attempts.types';

/**
 * `server/attempts`'s public barrel (migration plan Phase 7) — exam-taking + adaptive selection
 * (FR-TAKE-1..9) and `AttemptTimeoutSweeper`'s belt-and-braces backstop (FR-TAKE-6). Nothing outside
 * this module may import `./domain/**`/`./infrastructure/**`/`./application/**` directly (enforced by
 * `apps/next/.eslintrc.cjs`'s `attempts` module-boundary rule).
 *
 * {@link getAttemptsService} builds a fresh instance per call, bound to the *current request's*
 * tenant-scoped `DataSource` — must be called inside `withTenantContext` (matches every other
 * tenant-scoped module's composition-root convention).
 *
 * {@link buildAttemptsRepository}/{@link buildAttemptTimeoutSweeper} are ALSO re-exported directly
 * (not just wrapped by {@link getAttemptsService}) for the same reason `server/pdf-processing` exports
 * `buildPdfProcessingService`/`PdfProcessingSessionRepository` directly: `server/workers/attempt-
 * timeout-sweeper.ts` (a genuinely external, cross-module composition root, mirroring
 * `server/workers/pdf-stale-session-recovery.ts`'s established shape) needs to construct a
 * tenant-scoped instance bound to an EXPLICIT, already-acquired `DataSource` rather than reading one
 * off the ambient ALS context.
 */
export function getAttemptsService(): AttemptsService {
  const dataSource = requireTenantDataSource();
  const { imageAssociation } = buildMediaServices(dataSource);
  return new AttemptsService(new AttemptsRepository(dataSource), getPermissionResolutionService(), imageAssociation);
}

/** Composition-root building block for `server/workers/attempt-timeout-sweeper.ts`'s per-tenant sweep
 * — takes an explicit `DataSource` (see {@link getAttemptsService}'s doc comment for why). */
export function buildAttemptsRepository(dataSource: ReturnType<typeof requireTenantDataSource>): AttemptsRepository {
  return new AttemptsRepository(dataSource);
}

/** Composition-root building block for `server/workers/attempt-timeout-sweeper.ts`'s per-tenant sweep. */
export function buildAttemptTimeoutSweeper(
  dataSource: ReturnType<typeof requireTenantDataSource>,
  logger: ConstructorParameters<typeof AttemptTimeoutSweeper>[1],
): AttemptTimeoutSweeper {
  return new AttemptTimeoutSweeper(new AttemptsRepository(dataSource), logger);
}
