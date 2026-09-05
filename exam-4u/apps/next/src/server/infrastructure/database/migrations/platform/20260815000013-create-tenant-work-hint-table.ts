import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `platform.tenant_work_hint` (HLD §10.2, migration plan Phase 2 sub-slice "2d") — ported
 * verbatim from `legacy/api/src/infrastructure/database/migrations/platform/
 * 1730000000020-create-tenant-work-hint-table.ts`.
 *
 * A tiny cross-schema "which tenants have pending work" index intended to let O(tenants)-polling
 * background workers avoid scanning every tenant schema on every tick. A hint row is written **in the
 * same transaction** as the tenant-side row that created the pending work (possible only because
 * every tenant schema and the platform schema live on the same MySQL server, so a qualified
 * cross-schema write shares the connection's transaction) — no producer of any hint kind is wired in
 * this app yet (see `tenant-work-hint.entity.ts`'s own doc comment for why that is an honest,
 * documented gap rather than a stub to apologize for). `(tenant_id, kind)` is the primary key so a
 * second hint for a tenant/kind pair that already has one pending is an `ON DUPLICATE KEY UPDATE
 * pending_since = LEAST(pending_since, VALUES(pending_since))` upsert, never a duplicate row.
 *
 * `ix_hint_kind_since` is what makes "list tenants with a pending `outbox` hint, oldest first"
 * (`WorkHintRepository.listTenantIds`) an index scan rather than a full-table scan.
 */
export class CreateTenantWorkHintTable20260815000013 implements MigrationInterface {
  name = 'CreateTenantWorkHintTable20260815000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tenant_work_hint (
        tenant_id     CHAR(36) NOT NULL,
        kind          ENUM('pdf_session','outbox','attempt_timeout') NOT NULL,
        pending_since DATETIME(3) NOT NULL,
        PRIMARY KEY (tenant_id, kind),
        KEY ix_hint_kind_since (kind, pending_since)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS tenant_work_hint`);
  }
}
