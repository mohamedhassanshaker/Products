import { DomainError } from '@/server/common/errors/domain-error';

/**
 * `practice`-module `DomainError` subclasses (migration plan Phase 8, FR-CUR-5/FR-CUR-6). Ported from
 * `legacy/api/src/modules/practice/domain/errors.ts`. `CURRICULUM_NOT_FOUND` is NOT redeclared here —
 * `PromptPracticeService`/`LessonPracticeService` reuse `curricula`'s `CurriculumNotFoundError`/
 * `NotCurriculumOwnerError`/`DocumentNotFoundError`/`SubjectNotFoundError` directly (the same
 * cross-module reuse `FinalizeExamService` already established in this app).
 */

/** FR-CUR-5: an empty or whitespace-only `prompt` — rejected before any embedding/AI call is made. */
export class EmptyPromptError extends DomainError {
  constructor() {
    super('EMPTY_PROMPT', 'Enter a prompt describing what you would like to practice.');
  }
}

/** FR-CUR-5/FR-CUR-6: `count` outside the inclusive 1-30 range — shared by Prompt Practice and
 * Adaptive Lesson Practice, since both bound `count` identically. */
export class InvalidQuestionCountError extends DomainError {
  constructor() {
    super('INVALID_QUESTION_COUNT', 'Enter a number of questions between 1 and 30.');
  }
}

/**
 * FR-CUR-6: "a document merely being present in a Curriculum with no packaged questions behind it
 * does not by itself satisfy a practice request." Thrown when the resolved bank (document-, subject-,
 * or curriculum-scoped) has zero already-finalized `generated_question` rows — before any AI
 * shortfall-fill call is attempted, per the spec's own "the bank, not the raw document, is the
 * source of practice questions" framing.
 */
export class EmptyQuestionBankError extends DomainError {
  constructor() {
    super('EMPTY_QUESTION_BANK', 'No practice questions are available yet for this selection.');
  }
}

/** FR-CUR-6: `GET /api/practice/sessions/:id`/`POST .../answer` named a session id that does not
 * exist in this tenant. Reuses the generic `SESSION_NOT_FOUND` code
 * `server/pdf-processing`'s `PdfProcessingSessionNotFoundError` already established for an unrelated
 * table — the same cross-module code-reuse precedent `PromptPracticeService` sets for
 * `CURRICULUM_NOT_FOUND`. */
export class PracticeSessionNotFoundError extends DomainError {
  constructor() {
    super('SESSION_NOT_FOUND', 'No such practice session.');
  }
}

/** FR-CUR-6: a practice session belongs to a different user — a distinct, dedicated code (unlike
 * Prompt Practice's Curriculum lookup, which never distinguishes) so a Member's own practice history
 * can tell a genuine 404 apart from a same-tenant sibling's session, mirroring `AttemptsService`'s
 * identical per-attempt-ownership shape. */
export class NotPracticeSessionOwnerError extends DomainError {
  constructor() {
    super('NOT_SESSION_OWNER', 'You do not have access to this practice session.');
  }
}

/** FR-CUR-6: `POST /api/practice/sessions/:id/answer` named a `position` with no corresponding
 * `practice_question` row in this session. Reuses the generic `QUESTION_NOT_FOUND` code. */
export class PracticeQuestionNotFoundError extends DomainError {
  constructor() {
    super('QUESTION_NOT_FOUND', 'No such practice question.');
  }
}
