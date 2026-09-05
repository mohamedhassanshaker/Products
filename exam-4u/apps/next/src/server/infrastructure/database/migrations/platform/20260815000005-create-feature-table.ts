import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `platform.feature` (LLD §4 DDL, FR-PKG-1) — ported verbatim from
 * `legacy/api/src/infrastructure/database/migrations/platform/1730000000009-create-feature-table.ts`.
 */
export class CreateFeatureTable20260815000005 implements MigrationInterface {
  name = 'CreateFeatureTable20260815000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE feature (
        id           CHAR(36)     NOT NULL,
        \`key\`      VARCHAR(100) NOT NULL,
        name         VARCHAR(200) NOT NULL,
        description  VARCHAR(500) NULL,
        unit         VARCHAR(50)  NOT NULL,
        reset_period ENUM('NONE','DAILY','MONTHLY') NOT NULL DEFAULT 'MONTHLY',
        created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_feature_key (\`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE feature`);
  }
}
