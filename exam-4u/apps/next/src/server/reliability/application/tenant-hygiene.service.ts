import type pino from 'pino';
import type { StoragePort } from '@/server/common/ports/storage.port';
import type { UserRepository } from '@/server/auth';
import type { FileCleanupRepository } from '../infrastructure/file-cleanup.repository';

const FILE_CLEANUP_BATCH_SIZE = 100;

/**
 * Bundles `TenantMaintenanceWorker`'s two per-tenant, tenant-schema-scoped hygiene duties (HLD §10.1:
 * "prune expired reset tokens, delete files scheduled for cleanup") behind one collaborator — ported
 * logic (not code) from `legacy/api/src/modules/reliability/application/tenant-hygiene.service.ts`'s
 * `TenantHygieneService`. Keeps `TenantMaintenanceWorker` a thin coordinator over each duty's real
 * implementation rather than growing a fifth/sixth direct collaborator of its own for every new
 * maintenance task (this codebase's "no god services" convention).
 *
 * **Constructed fresh per tenant, not a process-wide singleton** — unlike legacy (where
 * `UserRepository`/`FileCleanupRepository` resolve their `Repository` lazily from the *ambient*
 * ALS-bound tenant `EntityManager` on every call, so one `TenantHygieneService` instance can safely
 * serve every tenant in turn), this app's repository classes are constructed with an already-resolved
 * `DataSource` up front (this app's own established convention — see `UserRepository`'s doc comment).
 * `TenantMaintenanceWorker.sweepTenantHygiene` therefore constructs a new `TenantHygieneService` per
 * tenant, inside `TenantScopeService.runFor`'s callback, using that tenant's own just-acquired
 * `DataSource` — a lightweight, side-effect-free construction (no I/O happens until a method below is
 * actually called).
 */
export class TenantHygieneService {
  constructor(
    private readonly users: UserRepository,
    private readonly fileCleanup: FileCleanupRepository,
    private readonly storage: StoragePort,
    private readonly logger: pino.Logger,
  ) {}

  /** HLD §10.1: "prune expired reset tokens." Must be called from inside a resolved tenant scope
   * (`TenantScopeService.runFor`) — the caller's `UserRepository` must already be bound to the target
   * tenant's `DataSource`. Returns the number of rows cleared. */
  async pruneExpiredResetTokens(): Promise<number> {
    return this.users.pruneExpiredResetTokens();
  }

  /**
   * HLD §10.1: "delete files scheduled for cleanup" (FR-IAM-4) — drains up to
   * {@link FILE_CLEANUP_BATCH_SIZE} due `file_cleanup_queue` rows: deletes the object from storage,
   * then marks the row deleted **only after** the delete call genuinely resolves (never
   * optimistically). A storage failure for one key is recorded (`recordFailedAttempt`) and left
   * pending for a later pass — it never aborts the rest of the batch, matching every other worker's
   * identical "one bad item never blocks the batch" convention.
   *
   * @returns how many objects were actually deleted this pass.
   */
  async drainFileCleanupQueue(): Promise<number> {
    const due = await this.fileCleanup.findDue(FILE_CLEANUP_BATCH_SIZE);
    let deleted = 0;
    for (const row of due) {
      try {
        await this.storage.delete(row.storageKey);
        await this.fileCleanup.markDeleted(row.id);
        deleted += 1;
      } catch (err) {
        await this.fileCleanup.recordFailedAttempt(row.id, row.attempts);
        this.logger.warn({ err, storageKey: row.storageKey }, 'file_cleanup_delete_failed');
      }
    }
    return deleted;
  }
}
