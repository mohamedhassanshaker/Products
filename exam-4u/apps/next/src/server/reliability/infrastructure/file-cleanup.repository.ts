import { randomUUID } from 'node:crypto';
import { IsNull, type DataSource, type EntityManager, type Repository } from 'typeorm';
import { FileCleanupQueueEntity } from '@/server/infrastructure/database';

/**
 * Data access for `file_cleanup_queue` (FR-IAM-4's deferred-delete queue) — ported logic from
 * `legacy/api/src/modules/reliability/infrastructure/repositories/file-cleanup.repository.ts`,
 * adapted to this app's DataSource-constructor convention (see `OutboxRepository`'s identical doc
 * comment for why).
 */
export class FileCleanupRepository {
  constructor(private readonly dataSource: DataSource) {}

  private repo(em: EntityManager = this.dataSource.manager): Repository<FileCleanupQueueEntity> {
    return em.getRepository<FileCleanupQueueEntity>('file_cleanup_queue');
  }

  /**
   * Schedules `storageKey` for later deletion — never deletes inline (FR-IAM-4: "schedules the
   * previous file for cleanup rather than deleting it inline"). Callers pass their own transactional
   * `EntityManager` when the schedule must be atomic with the row change that made the key orphaned
   * (e.g. `ProfileRepository.setPicture`'s new-key write) — a duplicate schedule for the same key is
   * harmless (a future draining worker's delete is naturally idempotent), so a standalone call
   * (`dataSource.manager`, the default) is also safe.
   */
  async schedule(storageKey: string, em: EntityManager = this.dataSource.manager): Promise<void> {
    await this.repo(em).insert({
      id: randomUUID(),
      storageKey,
      scheduledAt: new Date(),
      deletedAt: null,
      attempts: 0,
    });
  }

  /** Rows still awaiting deletion, oldest-scheduled-first, capped at `limit`. No current caller —
   * the draining worker (legacy's `TenantMaintenanceWorker.drainFileCleanupQueue`) is explicitly out
   * of this dispatch's scope; exposed now so that worker's later landing needs no repository change. */
  async findDue(limit: number): Promise<FileCleanupQueueEntity[]> {
    return this.repo().find({ where: { deletedAt: IsNull() }, order: { scheduledAt: 'ASC' }, take: limit });
  }

  /** Count of rows still awaiting deletion — the Reliability dashboard's own read path (Phase 2
   * sub-slice "2d", no legacy precedent). */
  async countDue(): Promise<number> {
    return this.repo().count({ where: { deletedAt: IsNull() } });
  }

  /** Marks `id` deleted. Never called until `StoragePort.delete` has genuinely resolved. */
  async markDeleted(id: string): Promise<void> {
    await this.repo().update({ id }, { deletedAt: new Date() });
  }

  /** Records a failed deletion attempt — leaves the row pending so a later pass retries. */
  async recordFailedAttempt(id: string, attemptsSoFar: number): Promise<void> {
    await this.repo().update({ id }, { attempts: attemptsSoFar + 1 });
  }
}
