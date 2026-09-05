import { DomainError } from '@/server/common/errors/domain-error';

/**
 * `curricula`-module `DomainError` subclasses — ported from
 * `legacy/api/src/modules/curricula/domain/errors.ts`, originally the ownership/metadata subset only
 * (Phase 3). Phase 6 sub-slice "6b" adds the document-ingestion errors now that this module genuinely
 * owns document upload/indexing (`NoExtractableTextError`, `SubjectRequiredForIndexingError`) — the
 * deferral note Phase 3's own version of this comment carried, now closed.
 */

/** No Curriculum with the given id exists in this tenant. */
export class CurriculumNotFoundError extends DomainError {
  constructor() {
    super('CURRICULUM_NOT_FOUND', 'No such curriculum.');
  }
}

/**
 * FR-CUR-1a: "a non-owner Member's attempt to view/modify a Curriculum they don't own returns 403
 * (`NOT_CURRICULUM_OWNER`)" — 403, not 404, since existence of a sibling record is not sensitive within
 * a tenant.
 */
export class NotCurriculumOwnerError extends DomainError {
  constructor() {
    super('NOT_CURRICULUM_OWNER', 'You do not own this curriculum.');
  }
}

/** `POST`/`PATCH /api/curricula` names a `subjectId` that does not exist in this tenant's taxonomy. */
export class SubjectNotFoundError extends DomainError {
  constructor() {
    super('SUBJECT_NOT_FOUND', 'No such subject.');
  }
}

/**
 * FR-CUR-2's pre-embedding-cost rejection: the uploaded document yielded no extractable text at all
 * (an empty/scanned/image-only PDF, or one whose parse failed outright). Deliberately the SAME code
 * for both cases — there is no separate spec-defined code for "malformed PDF" at the Curriculum
 * ingestion surface, and NFR-5 forbids leaking the underlying parser's raw error message to the
 * client. Nothing is stored and nothing is embedded when this is thrown.
 */
export class NoExtractableTextError extends DomainError {
  constructor() {
    super('NO_EXTRACTABLE_TEXT', 'No text could be extracted from the uploaded document.');
  }
}

/**
 * FR-PDF-6: a Reference-classified document could be resolved to neither an existing Curriculum nor a
 * Subject to auto-create one under (`curriculum.subject_id` is `NOT NULL`). Surfaced loudly on the
 * calling session rather than guessing a subject or dropping the reference material silently — see
 * `CurriculumIndexingService.resolveOrCreateCurriculum`'s own doc comment for the full write-up.
 */
export class SubjectRequiredForIndexingError extends DomainError {
  constructor() {
    // Reuses the already-catalogued `VALIDATION_FAILED` code verbatim (matching legacy's identical
    // choice for this exact error): `@examland/contracts`' `ErrorCode` catalog is a settled contract
    // this phase must not silently extend for a condition that genuinely is "the request did not
    // carry enough information to proceed".
    super('VALIDATION_FAILED', 'A subject must be specified to index reference material into a curriculum.');
  }
}

/**
 * Phase 8 addition (`server/practice`'s document-scoped Lesson Practice branch, FR-CUR-6): no
 * `curriculum_document` with the given id exists in this tenant. Reuses the generic
 * `DOCUMENT_NOT_FOUND` code already in `@examland/contracts`'s catalog — no new code needed.
 */
export class DocumentNotFoundError extends DomainError {
  constructor() {
    super('DOCUMENT_NOT_FOUND', 'No such document.');
  }
}
