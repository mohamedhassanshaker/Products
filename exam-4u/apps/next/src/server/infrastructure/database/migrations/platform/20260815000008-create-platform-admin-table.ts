import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `platform.platform_admin` (LLD-equivalent DDL) — ported verbatim from
 * `legacy/api/src/infrastructure/database/migrations/platform/1730000000006-create-platform-admin-table.ts`.
 * This dispatch (Phase 1 sub-slice 1b: `auth`/`rbac`/tenant-resolution) is the first to need a
 * platform-realm principal store — deliberately deferred by sub-slice 1a (see that dispatch's
 * `migrations/platform/index.ts` doc comment: "platform_admin... belongs to a later phase").
 *
 * Structurally separate from the tenant-schema `user` table (`migrations/tenant/
 * 20260815000001-create-rbac-tables.ts`): a Platform Admin has no tenant, no roles/permissions row,
 * and is never resolvable through any tenant `DataSource` — enforced simply by this table only ever
 * existing in the platform schema, which only the platform `DataSource`'s entity metadata includes.
 */
export class CreatePlatformAdminTable20260815000008 implements MigrationInterface {
  name = 'CreatePlatformAdminTable20260815000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE platform_admin (
        id            CHAR(36)     NOT NULL,
        email         VARCHAR(320) NOT NULL,
        password_hash VARCHAR(100) NOT NULL,
        name          VARCHAR(200) NOT NULL,
        is_active     TINYINT(1)   NOT NULL DEFAULT 1,
        last_login_at DATETIME(3)  NULL,
        created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_platform_admin_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE platform_admin`);
  }
}
