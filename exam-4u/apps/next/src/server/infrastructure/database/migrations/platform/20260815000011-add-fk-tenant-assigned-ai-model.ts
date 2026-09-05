import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FR-AI-3: adds the FK from `tenant.assigned_ai_model_id` to `approved_ai_model(id)`, `ON DELETE
 * RESTRICT` (the storage-level half of `MODEL_IN_USE`: a model still assigned to any tenant cannot be
 * hard-deleted at all, not merely rejected by application code).
 *
 * **Differs from legacy's equivalent migration in one small, deliberate way**: legacy's
 * `AddAssignedAiModelToTenant1730000000015` adds the column, its index, AND the FK constraint all in
 * one `ALTER TABLE`, because legacy's `tenant` table didn't have the column yet at that point in its
 * migration history. This app's `20260815000001-create-tenant-table.ts` already created
 * `assigned_ai_model_id` (nullable, no FK) AND its `ix_tenant_ai_model` index as part of the
 * consolidated `CREATE TABLE tenant` (see that migration's own doc comment: "documented forward
 * reference, no FK constraint until `approved_ai_model` exists"). This migration therefore only adds
 * the FK constraint itself — the column and index already exist and would error if re-added.
 *
 * Runs after `CreateApprovedAiModelTable`/`SeedApprovedAiModelDefault` (dependency order — the FK
 * target table must exist first).
 */
export class AddFkTenantAssignedAiModel20260815000011 implements MigrationInterface {
  name = 'AddFkTenantAssignedAiModel20260815000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenant
        ADD CONSTRAINT fk_tenant_ai_model FOREIGN KEY (assigned_ai_model_id)
            REFERENCES approved_ai_model(id) ON DELETE RESTRICT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE tenant DROP FOREIGN KEY fk_tenant_ai_model`);
  }
}
