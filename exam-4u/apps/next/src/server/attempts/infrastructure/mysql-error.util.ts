import { QueryFailedError } from 'typeorm';

/**
 * MySQL/mysql2 driver error codes this module needs to distinguish from any other database failure.
 * Deliberately duplicated from `server/exam-authoring/infrastructure/mysql-error.util.ts` rather than
 * imported cross-module — matches this app's established convention (each module keeps its own copy of
 * this small, dependency-free check) rather than introducing a `server/**` -> `server/**` import the
 * module-boundary rule does not otherwise need for any other reason.
 */
const ER_DUP_ENTRY = 'ER_DUP_ENTRY';

/** True if `error` is a MySQL duplicate-key violation — `AttemptsService.startAttempt` translates this
 * into `AttemptAlreadyInProgressError` when it lost the real `uq_attempt_active` race (see
 * `AttemptsRepository.insertAttempt`'s own doc comment). */
export function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof QueryFailedError && (error as unknown as { code?: string }).code === ER_DUP_ENTRY;
}
