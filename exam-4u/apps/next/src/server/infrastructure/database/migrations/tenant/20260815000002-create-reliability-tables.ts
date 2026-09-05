import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the reliability tables in every tenant schema (Dev-22/BL-20, FR-REL-1, FR-IAM-4) — ported
 * verbatim (DDL unchanged) from `legacy/api/src/infrastructure/database/migrations/tenant/
 * 1730000000015-create-reliability-tables.ts`-equivalent DDL (spread across
 * `outbox-message.entity.ts`/`processed-event.entity.ts`/`file-cleanup-queue.entity.ts` in legacy's
 * own history). `server/reliability`'s repositories are the sole consumers.
 *
 * **Deliberately not ported this dispatch**: `platform.tenant_work_hint` (a *platform*-schema table,
 * not tenant-schema — legacy's hinted-sweep optimization) and its `upsertTenantWorkHint` write from
 * `OutboxRepository.enqueue`. This dispatch builds only the full-sweep safety net (see
 * `server/reliability`'s own doc comment) — the hinted sweep is a pure performance optimization for
 * "tens to low hundreds" of tenants (HLD §10.2), not a correctness requirement, and re-adding it
 * later needs no reshaping migration here (it lives entirely in the platform schema).
 */
export class CreateReliabilityTables20260815000002 implements MigrationInterface {
  name = 'CreateReliabilityTables20260815000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE outbox_message (
        id CHAR(36) NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        payload JSON NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        processed_at DATETIME(3) NULL,
        attempts INT NOT NULL DEFAULT 0,
        last_error VARCHAR(1000) NULL,
        locked_by VARCHAR(100) NULL,
        locked_until DATETIME(3) NULL,
        PRIMARY KEY (id),
        KEY ix_outbox_claim (processed_at, available_at, locked_until)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await queryRunner.query(`
      CREATE TABLE processed_event (
        consumer VARCHAR(100) NOT NULL,
        event_id CHAR(36) NOT NULL,
        processed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (consumer, event_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await queryRunner.query(`
      CREATE TABLE file_cleanup_queue (
        id CHAR(36) NOT NULL,
        storage_key VARCHAR(512) NOT NULL,
        scheduled_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        deleted_at DATETIME(3) NULL,
        attempts INT NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        KEY ix_file_cleanup_pending (deleted_at, scheduled_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE file_cleanup_queue`);
    await queryRunner.query(`DROP TABLE processed_event`);
    await queryRunner.query(`DROP TABLE outbox_message`);
  }
}
