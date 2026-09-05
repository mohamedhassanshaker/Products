import { DomainError } from '@/server/common/errors/domain-error';

/** FR-TAKE-1: no such Exam Type (discovery/instructions/start). */
export class AttemptExamTypeNotFoundError extends DomainError {
  constructor() {
    super('EXAM_TYPE_NOT_FOUND', 'The requested Exam Type was not found.');
  }
}

/**
 * FR-TAKE-2: the caller already has an `InProgress` attempt for this Exam Type — carries the existing
 * attempt's id so the client can offer a "resume" action (`ResumeAttemptDialog` in the legacy UI,
 * ported as this app's own resume dialog). Thrown both by `AttemptsService.startAttempt`'s optimistic
 * pre-check AND by the real database-level `uq_attempt_active` race guard (see
 * `AttemptsRepository.insertAttempt`'s own doc comment) — the up-front check is an optimization for the
 * non-racing common case, never the sole guarantee.
 */
export class AttemptAlreadyInProgressError extends DomainError {
  constructor(public readonly existingAttemptId: string) {
    super('ATTEMPT_ALREADY_IN_PROGRESS', 'You already have an exam attempt in progress for this Exam Type.', { attemptId: existingAttemptId });
  }
}

/** FR-TAKE-3: a module's question bank cannot supply its configured `questionCount`. */
export class InsufficientQuestionBankError extends DomainError {
  constructor(moduleName: string, available: number, required: number) {
    super(
      'INSUFFICIENT_QUESTION_BANK',
      `Module '${moduleName}' requires ${required} question(s) but only ${available} are available.`,
      { moduleName, available, required },
    );
  }
}

/** No such attempt at all (any attempt-scoped route). */
export class AttemptNotFoundError extends DomainError {
  constructor() {
    super('ATTEMPT_NOT_FOUND', 'The requested attempt was not found.');
  }
}

/** The authenticated caller does not own this attempt and (where checked) does not hold the tenant-wide
 * oversight permission either. */
export class NotAttemptOwnerError extends DomainError {
  constructor() {
    super('NOT_ATTEMPT_OWNER', 'You do not have access to this attempt.');
  }
}

/** FR-TAKE-4/FR-TAKE-5/FR-TAKE-6/FR-TAKE-7: the attempt is not (or no longer) `InProgress` — covers
 * both "already submitted" and "already timed out" (lazy or eager) uniformly; the client's single
 * "Time's up"/already-finished interstitial listens for this one code regardless of which closed it. */
export class AttemptNotInProgressError extends DomainError {
  constructor() {
    super('ATTEMPT_NOT_IN_PROGRESS', 'This attempt is no longer in progress.');
  }
}

/** FR-TAKE-4: navigating to a question index outside the attempt's range, or belonging to a different
 * attempt — always a 404, never silently clamped. */
export class AttemptQuestionNotFoundError extends DomainError {
  constructor() {
    super('QUESTION_NOT_FOUND', 'No question exists at that index for this attempt.');
  }
}
