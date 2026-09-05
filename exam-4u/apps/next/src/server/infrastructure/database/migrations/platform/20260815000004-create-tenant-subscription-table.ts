import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `platform.tenant_subscription` (LLD §4 DDL, full shape) — ported verbatim from
 * `legacy/api/src/infrastructure/database/migrations/platform/1730000000005-create-tenant-
 * subscription-table.ts`. `CreateSubscriptionStep` is this dispatch's only writer (one `ACTIVE` row
 * per tenant against the seeded catalog package).
 */
export class CreateTenantSubscriptionTable20260815000004 implements MigrationInterface {
  name = 'CreateTenantSubscriptionTable20260815000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tenant_subscription (
        id                       CHAR(36) NOT NULL,
        tenant_id                CHAR(36) NOT NULL,
        package_id               CHAR(36) NOT NULL,
        status                   ENUM('ACTIVE','PAST_DUE','CANCELED') NOT NULL DEFAULT 'ACTIVE',
        provider_customer_id     VARCHAR(255) NULL,
        provider_subscription_id VARCHAR(255) NULL,
        current_period_start     DATETIME(3) NULL,
        current_period_end       DATETIME(3) NULL,
        created_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_sub_tenant (tenant_id),
        UNIQUE KEY uq_sub_provider (provider_subscription_id),
        KEY ix_sub_package (package_id),
        CONSTRAINT fk_sub_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenant(id)    ON DELETE CASCADE,
        CONSTRAINT fk_sub_package FOREIGN KEY (package_id) REFERENCES \`package\`(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE tenant_subscription`);
  }
}
