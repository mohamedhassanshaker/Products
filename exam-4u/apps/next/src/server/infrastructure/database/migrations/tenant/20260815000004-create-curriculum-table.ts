import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `curriculum` table in every tenant schema (migration plan Phase 3, FR-CUR-1/FR-CUR-1a
 * — **ownership/metadata only**). Adapted from
 * `legacy/api/src/infrastructure/database/migrations/tenant/1730000000005-create-curriculum-tables.ts`,
 * with `curriculum_document` (and its FK) deliberately **not** ported — see
 * `docs/plans/nextjs-rewrite-phase3-plan.md`'s "The curricula scope-split judgment call" for the full
 * reasoning: that table's columns (`page_count`/`chunk_count`/`content_type`) are products of a
 * text-extraction/chunking/embedding pipeline that does not exist in this app yet (Phase 5/6's job),
 * and its exact final shape isn't settled until that infrastructure does exist — shipping it now would
 * mean Phase 5/6 reshapes a table this phase already created rather than defining it once, correctly,
 * alongside its first real writer.
 *
 * `curriculum.subject_id` FKs the pre-existing `subject` table (this same phase's own
 * `20260815000003-create-taxonomy-tables.ts`, applied first — see `TENANT_MIGRATIONS`'s ordering) with
 * `ON DELETE RESTRICT` — a Subject still referenced by a Curriculum cannot be deleted, mirroring
 * `stage`/`subject`'s own identical FK-to-parent pattern. `curriculum.owner_user_id` is deliberately
 * **not** an FK (soft reference — FR-IAM-7 keeps a deleted user's created Curricula, never
 * cascade-deletes them).
 *
 * **`exam_type_curriculum` is deliberately NOT created by this migration** (FR-CUR-7, Curriculum-exam
 * linkage, is Phase 4's own scope) — matches legacy's identical "the phase that actually links Curricula
 * to an Exam Type should add the junction table" deferral.
 *
 * `CREATE TABLE IF NOT EXISTS` matches every prior tenant migration's idempotent-retry convention.
 */
export class CreateCurriculumTable20260815000004 implements MigrationInterface {
  name = 'CreateCurriculumTable20260815000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS curriculum (
        id CHAR(36) NOT NULL,
        name VARCHAR(200) NOT NULL,
        description VARCHAR(1000) NULL,
        subject_id INT NOT NULL,
        owner_user_id CHAR(36) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY ix_cur_owner (owner_user_id),
        KEY ix_cur_subject (subject_id),
        CONSTRAINT fk_cur_subject FOREIGN KEY (subject_id) REFERENCES subject(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS curriculum`);
  }
}
