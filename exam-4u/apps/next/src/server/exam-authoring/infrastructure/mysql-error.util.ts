import { QueryFailedError } from 'typeorm';

/**
 * MySQL/mysql2 driver error codes this module needs to distinguish from any other database failure.
 * Deliberately duplicated from `server/taxonomy/infrastructure/mysql-error.util.ts` rather than imported
 * cross-module — matches legacy's own established convention (each Tier B module keeps its own copy of
 * this small, dependency-free check) rather than introducing a `server/**` -> `server/**` import the
 * module-boundary rule does not otherwise need for any other reason.
 */
const ER_DUP_ENTRY = 'ER_DUP_ENTRY';

/** True if `error` is a MySQL duplicate-key violation — the concurrent-create race
 * `ExamAuthoringService.createFromZip` translates into `ExamTypeNameExistsError` (FR-AUTH-1: "duplicate
 * exam type names within the tenant are rejected"). */
export function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof QueryFailedError && (error as unknown as { code?: string }).code === ER_DUP_ENTRY;
}
