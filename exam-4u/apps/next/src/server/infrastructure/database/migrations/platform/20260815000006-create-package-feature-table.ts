import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `platform.package_feature` (LLD §4 DDL, FR-PKG-3) — ported verbatim from
 * `legacy/api/src/infrastructure/database/migrations/platform/1730000000010-create-package-feature-
 * table.ts`. References both `package` and `feature`, so this migration must run after both
 * `CreatePackageTable`/`CreateFeatureTable` (enforced by `PLATFORM_MIGRATIONS`' array order).
 */
export class CreatePackageFeatureTable20260815000006 implements MigrationInterface {
  name = 'CreatePackageFeatureTable20260815000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE package_feature (
        id          CHAR(36) NOT NULL,
        package_id  CHAR(36) NOT NULL,
        feature_id  CHAR(36) NOT NULL,
        \`limit\`   INT      NULL,
        enabled     TINYINT(1) NOT NULL DEFAULT 1,
        PRIMARY KEY (id),
        UNIQUE KEY uq_pkg_feature (package_id, feature_id),
        KEY ix_pf_feature (feature_id),
        CONSTRAINT fk_pf_package FOREIGN KEY (package_id) REFERENCES \`package\`(id) ON DELETE CASCADE,
        CONSTRAINT fk_pf_feature FOREIGN KEY (feature_id) REFERENCES feature(id)  ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE package_feature`);
  }
}
