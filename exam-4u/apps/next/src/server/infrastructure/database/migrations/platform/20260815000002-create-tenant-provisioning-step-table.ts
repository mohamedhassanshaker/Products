import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `platform.tenant_provisioning_step` (LLD §4 DDL) — ported verbatim from
 * `legacy/api/src/infrastructure/database/migrations/platform/1730000000002-create-tenant-
 * provisioning-step-table.ts`. The provisioning step ledger `TenantProvisioningService` reads/writes
 * to make "re-run resumes rather than duplicates" true (HLD §4.4) without ever inspecting the tenant
 * schema's own contents.
 */
export class CreateTenantProvisioningStepTable20260815000002 implements MigrationInterface {
  name = 'CreateTenantProvisioningStepTable20260815000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tenant_provisioning_step (
        id           CHAR(36) NOT NULL,
        tenant_id    CHAR(36) NOT NULL,
        step         ENUM('create_schema','run_migrations','seed_rbac','seed_admin_user','create_subscription','invite_admin') NOT NULL,
        status       ENUM('Pending','Running','Completed','Failed') NOT NULL DEFAULT 'Pending',
        attempts     INT NOT NULL DEFAULT 0,
        error        TEXT NULL,
        started_at   DATETIME(3) NULL,
        completed_at DATETIME(3) NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_prov_step (tenant_id, step),
        CONSTRAINT fk_prov_tenant FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE tenant_provisioning_step`);
  }
}
