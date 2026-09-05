import { DomainError } from '@/server/common/errors/domain-error';

/**
 * `pdf-processing`-module `DomainError` subclasses (migration plan Phase 6, sub-slice "6a") — ported
 * verbatim from `legacy/api/src/modules/pdf-processing/domain/errors.ts`, trimmed to what this
 * sub-slice's own upload/dedup/classify/status-poll scope actually throws. Every `ErrorCode` used here
 * already exists in `@examland/contracts`'s catalog — this sub-slice only adds new throw sites for
 * already-settled codes, matching every other module's own doc-comment convention.
 */

/** FR-PDF-1: the uploaded file's leading bytes do not contain the `%PDF-` signature. */
export class InvalidFileSignatureError extends DomainError {
  constructor() {
    super('INVALID_FILE_SIGNATURE', 'The uploaded file is not a genuine PDF.');
  }
}

/** FR-PDF-1: the uploaded file's name does not end in `.pdf`. */
export class InvalidExtensionError extends DomainError {
  constructor() {
    super('INVALID_EXTENSION', 'Only .pdf files are accepted.');
  }
}

/** FR-PDF-1: a zero-byte upload. */
export class EmptyFileError extends DomainError {
  constructor() {
    super('EMPTY_FILE', 'The uploaded file is empty.');
  }
}

/** FR-PDF-1: the uploaded file exceeds the tenant-wide configured maximum (default 50MB). */
export class FileTooLargeError extends DomainError {
  constructor(maxBytes: number) {
    super('FILE_TOO_LARGE', `The uploaded file exceeds the maximum allowed size of ${maxBytes} bytes.`);
  }
}

/**
 * FR-PDF-3: "A classification result outside the three recognized types is a processing failure with
 * a specific `UNRECOGNIZED_CONTENT_TYPE` error identifying the unrecognized label, not silently
 * coerced to a default branch." `rawLabel` is the engine's own, deliberately undoctored
 * `ClassifyContentOut.contentType` string — this error's whole reason for existing is to surface that
 * exact value to the caller/log, never a generic "unrecognized" message with no detail.
 */
export class UnrecognizedContentTypeError extends DomainError {
  constructor(rawLabel: string) {
    super(
      'UNRECOGNIZED_CONTENT_TYPE',
      `The AI engine classified this document as "${rawLabel}", which is not one of the recognized content types (lesson, exam, reference).`,
      { rawLabel },
    );
  }
}

/** No `pdf_processing_session` row with the given id exists in this tenant. */
export class PdfProcessingSessionNotFoundError extends DomainError {
  constructor() {
    super('SESSION_NOT_FOUND', 'No such PDF processing session.');
  }
}

/** LLD §7.3's `GET /pdf-processing/sessions/:id`: "owner or `exams.review`" (the route itself is
 * gated on `pdf.review` for every caller; `exams.review` is the separate, business-level oversight
 * permission that lets a reviewer poll a session they did not personally upload — mirrors legacy's
 * identical two-permission split) — a non-owning, non-reviewer caller polling someone else's session. */
export class NotSessionOwnerError extends DomainError {
  constructor() {
    super('NOT_SESSION_OWNER', 'You do not have access to this processing session.');
  }
}

/**
 * Sub-slice "6c" additions (FR-PDF-8/9/10). Every `ErrorCode` used below already exists in
 * `@examland/contracts`'s catalog.
 */

/** No `generated_question` row with the given id exists. Reuses the already-settled generic
 * `QUESTION_NOT_FOUND` code (documented judgment call: the LLD/spec name no dedicated code for this
 * exact resource, and `packages/contracts`'s `ErrorCode` catalog is a closed set this sub-slice must
 * not silently extend). */
export class GeneratedQuestionNotFoundError extends DomainError {
  constructor() {
    super('QUESTION_NOT_FOUND', 'No such generated question.');
  }
}

/** FR-PDF-9: "If no question in the session meets the selection criteria, finalize is rejected with a
 * specific `NO_ELIGIBLE_QUESTIONS` error rather than creating an empty Exam Type." Thrown by
 * `FinalizeExamService.finalize` before any write happens. */
export class NoEligibleQuestionsError extends DomainError {
  constructor() {
    super(
      'NO_ELIGIBLE_QUESTIONS',
      'No generated question in this session meets the selected confidence threshold (and, if requested, the auto-generated-only restriction).',
    );
  }
}

/** FR-AUTH-4: "Context weight is a bounded integer 1-10 (`INVALID_CONTEXT_WEIGHT` outside that
 * range)." */
export class InvalidContextWeightError extends DomainError {
  constructor(contextWeight: number) {
    super('INVALID_CONTEXT_WEIGHT', `Context weight (${contextWeight}) must be an integer between 1 and 10.`, { contextWeight });
  }
}

/**
 * FR-PDF-10: "Appending is rejected (`APPEND_NOT_SUPPORTED_FOR_LEGACY_ZIP`) against an Exam Type
 * that was authored via the manual ZIP path... since it lacks the manifest structure the AI pipeline
 * appends to; the error explains this distinction rather than failing generically." Thrown by
 * `AppendExamService.append` whenever `ExamTypeEntity.origin === 'ZipImport'`.
 */
export class AppendNotSupportedForLegacyZipError extends DomainError {
  constructor() {
    super(
      'APPEND_NOT_SUPPORTED_FOR_LEGACY_ZIP',
      'This Exam Type was authored via manual ZIP upload and has no AI-pipeline manifest structure to append to. Only Exam Types finalized from a PDF processing session support appending.',
    );
  }
}
