import { DomainError } from '@/server/common/errors/domain-error';

/**
 * `taxonomy`-module `DomainError` subclasses — ported from
 * `legacy/api/src/modules/taxonomy/domain/errors.ts`. Every `ErrorCode` used here already exists in
 * `@examland/contracts`'s catalog (`INVALID_NAME`/`TAXONOMY_ENTRY_NOT_FOUND`/`TAXONOMY_ENTRY_IN_USE`)
 * — this module only adds new throw sites for already-settled codes, no new codes.
 */

/** FR-TAX-2: "Name validation: required, trimmed, 2–150 characters." Thrown by `TaxonomyService`
 * before any database call, so an invalid name never reaches the create-or-fetch duplicate-detection
 * logic at all. */
export class InvalidNameError extends DomainError {
  constructor() {
    super('INVALID_NAME', 'Name is required and must be between 2 and 150 characters.');
  }
}

/** No taxonomy row (at any of the three levels) with the given id, or a create call naming a parent
 * (`educationLevelId`/`stageId`) that does not exist. */
export class TaxonomyEntryNotFoundError extends DomainError {
  constructor() {
    super('TAXONOMY_ENTRY_NOT_FOUND', 'No such taxonomy entry.');
  }
}

/**
 * FR-TAX-4: "A taxonomy entry referenced by any Exam Type, Curriculum, or User (via education level)
 * cannot be deleted outright... it must be reassigned or the dependents removed first, preventing
 * orphaned foreign keys." See `TaxonomyService`'s own doc comment for the two-part enforcement
 * strategy (explicit `user` check for `education_level`, generic MySQL FK-violation translation for
 * every level, including future Exam Type/Curriculum references).
 */
export class TaxonomyEntryInUseError extends DomainError {
  constructor() {
    super('TAXONOMY_ENTRY_IN_USE', 'This taxonomy entry is still referenced elsewhere and cannot be deleted.');
  }
}
