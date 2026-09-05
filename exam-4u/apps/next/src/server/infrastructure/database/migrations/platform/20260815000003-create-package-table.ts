import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `platform.package` (LLD §4 DDL, full shape) — ported verbatim from
 * `legacy/api/src/infrastructure/database/migrations/platform/1730000000004-create-package-table.ts`
 * — so `tenant_subscription`'s foreign key has a table to reference. Full CRUD (Platform Admin catalog
 * management) is Phase 2 scope; this dispatch's `20260815000007-seed-feature-package-catalog`
 * migration is the only writer.
 */
export class CreatePackageTable20260815000003 implements MigrationInterface {
  name = 'CreatePackageTable20260815000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`package\` (
        id              CHAR(36)     NOT NULL,
        \`key\`         VARCHAR(100) NOT NULL,
        name            VARCHAR(200) NOT NULL,
        description     VARCHAR(500) NULL,
        price_cents     INT          NOT NULL DEFAULT 0,
        currency        CHAR(3)      NOT NULL DEFAULT 'usd',
        stripe_price_id VARCHAR(255) NULL,
        is_active       TINYINT(1)   NOT NULL DEFAULT 1,
        sort_order      INT          NOT NULL DEFAULT 0,
        created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_package_key (\`key\`),
        KEY ix_package_active_sort (is_active, sort_order)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`package\``);
  }
}
