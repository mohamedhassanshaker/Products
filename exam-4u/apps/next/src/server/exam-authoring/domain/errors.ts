import { DomainError } from '@/server/common/errors/domain-error';

/**
 * `exam-authoring`-module `DomainError` subclasses — ported from
 * `legacy/api/src/modules/exam-authoring/domain/errors.ts`, minus the three ZIP-structural error
 * classes (`InvalidZipStructureError`/`EmptyModuleError`/`InvalidQuestionFileError`), which live in
 * `server/infrastructure/zip/errors.ts` instead (see that file's own doc comment for the module-
 * boundary reasoning). Every `ErrorCode` used here already exists in `@examland/contracts`'s catalog.
 */

/** FR-AUTH-1: "the declared total question count should reconcile with the sum of per-module counts; a
 * mismatch is flagged rather than silently accepted." Compares the request DTO's own declared
 * `totalQuestions` against the sum of its declared `modules[].questionCount` — a pure input-consistency
 * check, independent of what the ZIP actually contains. */
export class QuestionCountMismatchError extends DomainError {
  constructor(declaredTotal: number, sumOfModules: number) {
    super(
      'QUESTION_COUNT_MISMATCH',
      `Declared total question count (${declaredTotal}) does not match the sum of module question counts (${sumOfModules}).`,
      { declaredTotal, sumOfModules },
    );
  }

  /**
   * Closes a real gap legacy's own QA pass (Dev-12b retry) found: the constructor above only ever
   * compares the request DTO's own declared numbers against each other — a pure self-consistency check
   * that can never catch a ZIP whose *real* parsed content diverges from what was declared (a ZIP
   * declaring 2 questions for a module but actually containing 1 would otherwise be silently accepted).
   * This factory produces the same `QUESTION_COUNT_MISMATCH` code for that second, content-level
   * condition — one module's declared count vs. the ZIP's actual parsed question count for that module
   * — naming the offending module plus both numbers, per FR-AUTH-1's "flagged rather than silently
   * accepted" requirement and this codebase's established error-detail convention of naming the
   * specific offending entity (see `EmptyModuleError`/`InvalidQuestionFileError`).
   */
  static forModule(moduleName: string, declaredCount: number, actualCount: number): QuestionCountMismatchError {
    return new ModuleQuestionCountMismatchError(moduleName, declaredCount, actualCount);
  }
}

/** Backing implementation for {@link QuestionCountMismatchError.forModule} — kept as a private subclass
 * (rather than mutating a constructed instance's `readonly message/details`) so the base class's fields
 * stay genuinely `readonly`, matching every other `DomainError` subclass's convention of setting
 * everything through `super()`. Still `instanceof QuestionCountMismatchError` (and reports the same
 * `QUESTION_COUNT_MISMATCH` code) for any caller/test matching on the parent type. */
class ModuleQuestionCountMismatchError extends QuestionCountMismatchError {
  constructor(moduleName: string, declaredCount: number, actualCount: number) {
    super(declaredCount, actualCount);
    Object.assign(this, {
      message: `Module "${moduleName}" declares ${declaredCount} question(s), but the ZIP archive actually contains ${actualCount} valid question file(s) for that module.`,
      details: { module: moduleName, declaredCount, actualCount },
    });
  }
}

/** FR-AUTH-1: the uploaded ZIP exceeds `MAX_ZIP_SIZE_BYTES`. This app has no `multer`-equivalent
 * request-body size limiter ahead of `request.formData()` (the same documented gap
 * `profile/domain/errors.ts`'s own `FileTooLargeError` flags for avatar uploads) — the
 * `Content-Length`-based pre-check in `POST /api/exam-types/zip`'s Route Handler is this app's only
 * enforcement point for this endpoint. A distinct class from `profile`'s (not reused cross-module)
 * since each module owns its own `domain/errors.ts` by convention, even though both share the generic
 * `FILE_TOO_LARGE` contract code. */
export class FileTooLargeError extends DomainError {
  constructor(maxBytes: number) {
    super('FILE_TOO_LARGE', `The uploaded ZIP file exceeds the maximum allowed size of ${maxBytes} bytes.`);
  }
}

/** FR-AUTH-1: "duplicate exam type names within the tenant are rejected." */
export class ExamTypeNameExistsError extends DomainError {
  constructor() {
    super('EXAM_TYPE_NAME_EXISTS', 'An Exam Type with this name already exists.');
  }
}

/** No `exam_type` row with the given id in this tenant schema. */
export class ExamTypeNotFoundError extends DomainError {
  constructor() {
    super('EXAM_TYPE_NOT_FOUND', 'No such Exam Type.');
  }
}

/**
 * FR-AUTH-5: "An Exam Type with in-progress Attempts cannot be deleted immediately."
 *
 * **Forward reference now CLOSED (Phase 7)**: `ExamAuthoringRepository.hasActiveAttempts` used to
 * always resolve `false` (no `attempts` module/table existed yet) — it now queries the real `attempt`
 * table directly (see that method's own doc comment for why this reads the table rather than importing
 * `server/attempts`'s barrel, avoiding a circular module dependency).
 */
export class ExamTypeHasActiveAttemptsError extends DomainError {
  constructor() {
    super(
      'EXAM_TYPE_HAS_ACTIVE_ATTEMPTS',
      'This Exam Type has in-progress attempts and cannot be deleted until they complete or expire.',
    );
  }
}
