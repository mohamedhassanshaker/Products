import { requireTenantDataSource } from '@/server/context';
import { getAiService, getRetrievalService } from '@/server/ai';
import { getEmbeddingsPort } from '@/server/infrastructure/embeddings';
import { CurriculaRepository } from '@/server/curricula';
import { SubjectRepository } from '@/server/taxonomy';
import { getPermissionResolutionService } from '@/server/rbac';
import { PdfProcessingSessionRepository, GeneratedQuestionRepository } from '@/server/pdf-processing';
import { PromptPracticeService } from './application/prompt-practice.service';
import { LessonPracticeService } from './application/lesson-practice.service';
import { FullBankAssessmentService } from './application/full-bank-assessment.service';
import { PracticeSessionRepository } from './infrastructure/practice-session.repository';

export { PromptPracticeService, LessonPracticeService, FullBankAssessmentService, PracticeSessionRepository };
export { MIN_QUESTION_COUNT, MAX_QUESTION_COUNT } from './application/prompt-practice.service';
export { selectDiverse, NEAR_DUPLICATE_THRESHOLD } from './domain/diversity-selection';
export type { DiversityCandidate } from './domain/diversity-selection';
export { deriveDifficultyTier } from './domain/full-bank-assessment.types';
export type { DifficultyTier, FullBankAssessmentSummary, StartFullBankAssessmentInput } from './domain/full-bank-assessment.types';
export {
  EmptyPromptError,
  InvalidQuestionCountError,
  EmptyQuestionBankError,
  PracticeSessionNotFoundError,
  NotPracticeSessionOwnerError,
  PracticeQuestionNotFoundError,
} from './domain/errors';
export type {
  LessonPracticeInput,
  LessonPracticeQuestion,
  LessonPracticeResult,
  PromptPracticeInput,
  PromptPracticeQuestion,
  PromptPracticeResult,
} from './domain/practice.types';

/**
 * `server/practice`'s public barrel (migration plan Phase 8) — live/synchronous Prompt Practice
 * (FR-CUR-5), bank-first Adaptive Lesson Practice (FR-CUR-6), and the full-bank-assessment feature
 * (FR-PDF-13, scoped under `practice` per the migration plan's own phase-list wording even though its
 * source table is `pdf_processing_session`). Nothing outside this module may import `./domain/**`/
 * `./infrastructure/**`/`./application/**` directly (enforced by `apps/next/.eslintrc.cjs`'s `practice`
 * module-boundary rule).
 *
 * Every composition root below builds a fresh instance per call, bound to the *current request's*
 * tenant-scoped `DataSource` — must be called inside `withTenantContext`, matching every other
 * tenant-scoped module's composition-root convention.
 */
export function getPromptPracticeService(): PromptPracticeService {
  const dataSource = requireTenantDataSource();
  return new PromptPracticeService(getAiService(), getRetrievalService(), new CurriculaRepository(dataSource));
}

export function getLessonPracticeService(): LessonPracticeService {
  const dataSource = requireTenantDataSource();
  return new LessonPracticeService(
    getAiService(),
    getRetrievalService(),
    getEmbeddingsPort(),
    new GeneratedQuestionRepository(dataSource),
    new CurriculaRepository(dataSource),
    new SubjectRepository(dataSource),
    new PracticeSessionRepository(dataSource),
    getPermissionResolutionService(),
  );
}

/** Composition root for FR-PDF-13's full-bank-assessment feature — see
 * `FullBankAssessmentService`'s own class doc comment for why this reuses `server/pdf-processing`'s
 * `PdfProcessingSessionRepository`/`GeneratedQuestionRepository`/pure domain utilities rather than
 * duplicating them. */
export function getFullBankAssessmentService(): FullBankAssessmentService {
  const dataSource = requireTenantDataSource();
  return new FullBankAssessmentService(
    new PdfProcessingSessionRepository(dataSource),
    new GeneratedQuestionRepository(dataSource),
    new CurriculaRepository(dataSource),
    getAiService(),
    getRetrievalService(),
  );
}
