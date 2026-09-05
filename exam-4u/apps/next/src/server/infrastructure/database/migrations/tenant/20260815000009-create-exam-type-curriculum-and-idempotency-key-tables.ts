import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `exam_type_curriculum` and `idempotency_key` in every tenant schema (migration plan Phase 6,
 * sub-slice "6c" — FR-AUTH-4, FR-PDF-9, FR-PDF-10). Adapted from
 * `legacy/api/src/infrastructure/database/migrations/tenant/1730000000008-create-exam-type-curriculum-table.ts`
 * and `.../1730000000011-create-idempotency-key-table.ts`.
 *
 * **`exam_type_curriculum` closes Phase 4's/Phase 3's own documented deferral** (see
 * `20260815000005-create-exam-authoring-tables.ts`'s and `20260815000004-create-curriculum-table.ts`'s
 * own doc comments) — its only real writer, `FinalizeExamRepository.finalize`, lands in this sub-slice.
 * `ON DELETE CASCADE` on both FKs: deleting an Exam Type or a Curriculum removes the link row (neither
 * side should ever leave a dangling link). `chk_ctx_weight` is the schema-level backstop for
 * `FinalizeExamService.validateCurriculumLinks`'s own 1-10 application check.
 *
 * **`idempotency_key` closes sub-slice "6a"'s own documented deferral** (see that sub-slice's
 * "Decisions made" #2) — its only real writer, `AppendExamService.append`'s `Idempotency-Key` header
 * handling, lands in this sub-slice too. `scope` is kept in the composite primary key even though
 * `'pdf-append'` is the only scope any code writes today.
 *
 * Ordering: this migration FKs `exam_type` (`20260815000005`) and `curriculum` (`20260815000004`), both
 * applied earlier in `TENANT_MIGRATIONS`' array order.
 *
 * `CREATE TABLE IF NOT EXISTS` matches every prior tenant migration's idempotent-retry convention.
 */
export class CreateExamTypeCurriculumAndIdempotencyKeyTables20260815000009 implements MigrationInterface {
  name = 'CreateExamTypeCurriculumAndIdempotencyKeyTables20260815000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS exam_type_curriculum (
        exam_type_id CHAR(36) NOT NULL,
        curriculum_id CHAR(36) NOT NULL,
        context_weight TINYINT NOT NULL DEFAULT 5,
        applicable_modules_json JSON NULL,
        PRIMARY KEY (exam_type_id, curriculum_id),
        KEY ix_etc_curriculum (curriculum_id),
        CONSTRAINT fk_etc_exam FOREIGN KEY (exam_type_id) REFERENCES exam_type(id) ON DELETE CASCADE,
        CONSTRAINT fk_etc_curriculum FOREIGN KEY (curriculum_id) REFERENCES curriculum(id) ON DELETE CASCADE,
        CONSTRAINT chk_ctx_weight CHECK (context_weight BETWEEN 1 AND 10)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS idempotency_key (
        \`key\` VARCHAR(120) NOT NULL,
        scope VARCHAR(60) NOT NULL,
        response_hash CHAR(64) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`key\`, scope)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS idempotency_key`);
    await queryRunner.query(`DROP TABLE IF EXISTS exam_type_curriculum`);
  }
}
