import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `platform.tenant` (LLD §4 DDL, reproduced verbatim including the generated-column trick
 * that enforces "only one default tenant" via a unique index rather than application-level locking).
 *
 * **Consolidation judgment call** (`docs/plans/nextjs-rewrite-phase1-plan.md` "Decisions made"):
 * legacy shipped this table's full column set across four separate migrations as the feature grew
 * over many already-*deployed* phases (`CreateTenantTable` → `AddPendingAdminEmailToTenant` →
 * `AddAccentColorOverrideToTenant` → the column half of `AddAssignedAiModelToTenant`, each a real
 * `ALTER TABLE` against a schema that already had live rows). This app's platform schema does not
 * exist until this migration runs — there are no deployed rows to preserve across incremental
 * `ALTER`s — so all four are consolidated into one `CREATE TABLE` reflecting the final, already-
 * settled LLD shape. The incremental-migration discipline exists to let a schema evolve safely in
 * production without data loss; replaying that discipline for a table that doesn't exist yet would
 * only add file-count noise, not safety. `assigned_ai_model_id`'s FK constraint is the one thing
 * deliberately **not** included yet (see its own column comment below) — everything else is exactly
 * the union of those four legacy migrations' DDL.
 */
export class CreateTenantTable20260815000001 implements MigrationInterface {
  name = 'CreateTenantTable20260815000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tenant (
        id                        CHAR(36)      NOT NULL,
        name                      VARCHAR(200)  NOT NULL,
        subdomain_slug            VARCHAR(63)   NOT NULL,
        schema_name               VARCHAR(64)   NOT NULL,
        status                    ENUM('Provisioning','Active','Suspended','Failed') NOT NULL DEFAULT 'Provisioning',
        is_default                TINYINT(1)    NOT NULL DEFAULT 0,
        allow_email_registration  TINYINT(1)    NOT NULL DEFAULT 1,
        allow_google_sign_in      TINYINT(1)    NOT NULL DEFAULT 0,
        default_self_register_role VARCHAR(100) NULL,
        logo_url                  VARCHAR(1024) NULL,
        -- FR-MT-10 (Phase 9 owns the read/write logic; column created now to avoid a later reshaping
        -- migration — see this migration's own class doc comment).
        accent_color_override     CHAR(6)       NULL,
        provisioning_error        TEXT          NULL,
        provisioning_heartbeat_at DATETIME(3)   NULL,
        -- FR-MT-4: the first Tenant Admin's invited email, persisted so a provisioning retry can
        -- re-run seed_admin_user without the caller resupplying it.
        pending_admin_email       VARCHAR(320)  NULL,
        -- FR-AI-3 (Phase 5 owns the read/write logic + the FK to approved_ai_model, which doesn't
        -- exist yet — documented forward reference, no FK constraint until that table exists).
        assigned_ai_model_id      CHAR(36)      NULL,
        created_at                DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at                DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        deleted_at                DATETIME(3)   NULL,
        purge_after_at            DATETIME(3)   NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_tenant_slug   (subdomain_slug),
        UNIQUE KEY uq_tenant_schema (schema_name),
        KEY ix_tenant_status (status),
        KEY ix_tenant_purge  (deleted_at, purge_after_at),
        KEY ix_tenant_ai_model (assigned_ai_model_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await queryRunner.query(`
      ALTER TABLE tenant
        ADD COLUMN default_flag TINYINT(1) GENERATED ALWAYS AS (CASE WHEN is_default = 1 THEN 1 ELSE NULL END) VIRTUAL,
        ADD UNIQUE KEY uq_tenant_single_default (default_flag)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE tenant`);
  }
}
