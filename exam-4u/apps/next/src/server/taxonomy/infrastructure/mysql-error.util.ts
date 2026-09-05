import { QueryFailedError } from 'typeorm';

/**
 * MySQL/mysql2 driver error codes this module needs to distinguish from any other database failure —
 * ported verbatim from
 * `legacy/api/src/modules/taxonomy/infrastructure/repositories/mysql-error.util.ts`. TypeORM's
 * `QueryFailedError` copies every property of the underlying `mysql2` error (including `code`/`errno`)
 * onto itself, so these checks work directly against the caught `QueryFailedError` without reaching
 * into `.driverError`.
 */
const ER_DUP_ENTRY = 'ER_DUP_ENTRY';
const ER_ROW_IS_REFERENCED_2 = 'ER_ROW_IS_REFERENCED_2';

/** True if `error` is a MySQL duplicate-key violation (a concurrent create-or-fetch race lost the
 * insert to another request that got there first — see `TaxonomyService.createOrFetch*`'s doc comment
 * for why this is caught rather than prevented with a check-then-insert). */
export function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof QueryFailedError && (error as unknown as { code?: string }).code === ER_DUP_ENTRY;
}

/**
 * True if `error` is a MySQL "row is referenced by a foreign key" violation (errno 1451). This is the
 * generic mechanism `TaxonomyService.delete*()` relies on to enforce FR-TAX-4 for *any* current or
 * future referencing table (including `curriculum.subject_id`'s FK, this same phase) without this
 * module ever needing to know that table's name.
 */
export function isRowReferencedError(error: unknown): boolean {
  return error instanceof QueryFailedError && (error as unknown as { code?: string }).code === ER_ROW_IS_REFERENCED_2;
}
