import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `platform.approved_ai_model` (FR-AI-2) — ported verbatim from
 * `legacy/api/src/infrastructure/database/migrations/platform/1730000000013-create-approved-ai-model-table.ts`.
 * The Platform Admin-curated OpenRouter model allowlist (migration plan Phase 2 sub-slice "2b" —
 * allowlist admin CRUD; the actual OpenRouter/LLM call path that *consumes* this table is Phase 5's
 * job, per the migration plan's own phase sequence — this table has no dependency on that phase
 * existing).
 *
 * The `default_flag` generated column + its unique index is the DB-side half of "exactly one platform
 * default" — it can enforce "at most one" but not "at least one"; `AiModelsService`'s transaction
 * rules own the rest.
 */
export class CreateApprovedAiModelTable20260815000009 implements MigrationInterface {
  name = 'CreateApprovedAiModelTable20260815000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE approved_ai_model (
        id                    CHAR(36)     NOT NULL,
        open_router_model_id  VARCHAR(200) NOT NULL,
        display_name          VARCHAR(200) NOT NULL,
        is_enabled            TINYINT(1)   NOT NULL DEFAULT 1,
        is_platform_default   TINYINT(1)   NOT NULL DEFAULT 0,
        created_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_aim_model (open_router_model_id),
        KEY ix_aim_enabled (is_enabled)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    await queryRunner.query(`
      ALTER TABLE approved_ai_model
        ADD COLUMN default_flag TINYINT(1) GENERATED ALWAYS AS (CASE WHEN is_platform_default = 1 THEN 1 ELSE NULL END) VIRTUAL,
        ADD UNIQUE KEY uq_aim_single_default (default_flag)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE approved_ai_model`);
  }
}
