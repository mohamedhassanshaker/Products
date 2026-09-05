import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds `platform.approved_ai_model` with exactly one row — `anthropic/claude-3.5-haiku`, marked the
 * platform default — so a fresh deployment has a working, selectable model without a Platform Admin
 * action first. Ported verbatim from
 * `legacy/api/src/infrastructure/database/migrations/platform/1730000000014-seed-approved-ai-model-default.ts`.
 *
 * **Idempotency rule (a QA-testable invariant): guarded on the table being EMPTY, not on this row's id
 * being absent.** Consequences, all intentional (ported verbatim from legacy's identical rationale):
 * - Safe to re-run any number of times — it never inserts a second row once the table is non-empty.
 * - It can never violate `uq_aim_single_default` (it only ever fires when count = 0).
 * - It does **not** resurrect this row if a Platform Admin later deliberately deleted it and approved
 *   something else — "empty" only describes a fresh install, not "this specific id is missing."
 * - No other code path anywhere hard-codes this model id — this migration file is the literal's one
 *   and only appearance in this app.
 */
export class SeedApprovedAiModelDefault20260815000010 implements MigrationInterface {
  name = 'SeedApprovedAiModelDefault20260815000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO approved_ai_model (id, open_router_model_id, display_name, is_enabled, is_platform_default)
      SELECT '00000000-0000-4000-8000-000000000a01',
             'anthropic/claude-3.5-haiku', 'Claude 3.5 Haiku', 1, 1
      WHERE NOT EXISTS (SELECT 1 FROM approved_ai_model)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Deliberately a no-op-ish targeted delete rather than a symmetric "undo the seed": reverting
    // "seed if empty" by deleting this specific id could delete an operator's own legitimately-approved
    // row if they happened to reuse this reserved id (they can't — it's never offered as user input —
    // but symmetry with the up() guard is kept regardless, matching legacy's identical comment). A real
    // rollback of this migration drops the whole table via the prior migration's down().
    await queryRunner.query(`DELETE FROM approved_ai_model WHERE id = '00000000-0000-4000-8000-000000000a01'`);
  }
}
