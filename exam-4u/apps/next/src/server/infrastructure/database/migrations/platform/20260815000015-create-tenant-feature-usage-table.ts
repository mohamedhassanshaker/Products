import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `platform.tenant_feature_usage` (LLD §4 DDL, FR-PKG-5) — ported verbatim from
 * `legacy/api/src/infrastructure/database/migrations/platform/1730000000011-create-tenant-feature-
 * usage-table.ts`, added by the post-Phase-10-e2e closure dispatch that ports `platform/usage`
 * (confirmed never migrated by any prior phase — see `docs/plans/nextjs-rewrite-phase10-plan.md`'s
 * "Post-e2e closure" section). `uq_usage` is what makes `TenantFeatureUsageRepository`'s atomic upsert
 * (`INSERT ... ON DUPLICATE KEY UPDATE count = count + 1`) race-safe across concurrent requests for the
 * same tenant+feature+period. References both `tenant` and `feature`, so this migration must run after
 * both `CreateTenantTable`/`CreateFeatureTable` (enforced by `PLATFORM_MIGRATIONS`' array order).
 */
export class CreateTenantFeatureUsageTable20260815000015 implements MigrationInterface {
  name = 'CreateTenantFeatureUsageTable20260815000015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tenant_feature_usage (
        id         CHAR(36)    NOT NULL,
        tenant_id  CHAR(36)    NOT NULL,
        feature_id CHAR(36)    NOT NULL,
        period_key VARCHAR(20) NOT NULL,
        count      INT         NOT NULL DEFAULT 0,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_usage (tenant_id, feature_id, period_key),
        CONSTRAINT fk_usage_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenant(id)  ON DELETE CASCADE,
        CONSTRAINT fk_usage_feature FOREIGN KEY (feature_id) REFERENCES feature(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE tenant_feature_usage`);
  }
}
