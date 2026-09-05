import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * TypeORM mapping for the tenant-schema `file_cleanup_queue` table (created by
 * `migrations/tenant/20260815000002-create-reliability-tables.ts`, Phase 1 sub-slice 1c, FR-IAM-4) —
 * ported verbatim from `legacy/api/src/modules/reliability/infrastructure/entities/
 * file-cleanup-queue.entity.ts`. Closes the forward reference `UserEntity.pic`'s own migration
 * comment names: replacing a profile picture schedules the *previous* storage key for later
 * deletion rather than deleting it inline (`ProfileRepository.setPicture`).
 *
 * **Deliberately unconsumed this dispatch**: no draining worker exists yet — legacy's
 * `TenantMaintenanceWorker.drainFileCleanupQueue` is explicitly out of scope (belongs to the fuller
 * `tenant-maintenance.worker.ts` a later phase builds). Rows accumulate here, correctly and
 * durably, until that worker lands — the same kind of "table exists, consumer lands later" forward
 * reference `TENANT_ENTITIES`'s own history already establishes.
 */
@Entity({ name: 'file_cleanup_queue' })
export class FileCleanupQueueEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'storage_key', type: 'varchar', length: 512 })
  storageKey!: string;

  @CreateDateColumn({ name: 'scheduled_at', type: 'datetime', precision: 3 })
  scheduledAt!: Date;

  /** `NULL` = still pending deletion. Set once `StoragePort.delete` has genuinely succeeded for this
   * key — never optimistically before the delete call resolves. */
  @Column({ name: 'deleted_at', type: 'datetime', precision: 3, nullable: true })
  deletedAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  attempts!: number;
}
