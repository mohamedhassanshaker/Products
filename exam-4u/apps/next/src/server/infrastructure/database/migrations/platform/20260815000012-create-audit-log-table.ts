import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `platform.audit_log` (HLD §5.3, migration plan Phase 2 sub-slice "2d") — ported verbatim
 * from `legacy/api/src/infrastructure/database/migrations/platform/1730000000007-create-audit-log-table.ts`.
 * The single append-only table every platform-admin mutation (and every `System`-attributed
 * webhook-driven mutation) writes a row to. No foreign keys to `tenant`/`platform_admin` — an audit
 * row must remain readable even after the tenant/admin it references is later purged/deactivated, so
 * `tenant_id`/`actor_id` are plain, unconstrained columns rather than FKs (a deliberate choice: an
 * audit trail that could be silently deleted by an `ON DELETE CASCADE` would defeat its own purpose).
 *
 * **One additive index beyond legacy's own two** (`ix_audit_actor_time`, `ix_audit_target`) — this
 * dispatch's own Audit Log console page (§18.10 of `docs/design/UX_GUIDELINES.md`) filters by actor
 * and by target in addition to legacy's action/tenant filters, so both need their own composite index
 * rather than falling back to a full table scan. Purely additive (no column/behavior change), so it
 * carries no compatibility risk with legacy's identical table shape.
 */
export class CreateAuditLogTable20260815000012 implements MigrationInterface {
  name = 'CreateAuditLogTable20260815000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE audit_log (
        id           CHAR(36)     NOT NULL,
        actor_type   ENUM('PlatformAdmin','TenantUser','System') NOT NULL,
        actor_id     VARCHAR(64)  NULL,
        tenant_id    CHAR(36)     NULL,
        action       VARCHAR(100) NOT NULL,
        target_type  VARCHAR(100) NULL,
        target_id    VARCHAR(64)  NULL,
        summary      JSON         NULL,
        ip           VARCHAR(64)  NULL,
        created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY ix_audit_tenant_time (tenant_id, created_at),
        KEY ix_audit_action_time (action, created_at),
        KEY ix_audit_actor_time (actor_id, created_at),
        KEY ix_audit_target (target_type, target_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE audit_log`);
  }
}
