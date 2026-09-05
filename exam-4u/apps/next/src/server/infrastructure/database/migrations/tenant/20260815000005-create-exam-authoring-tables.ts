import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the manual-ZIP exam-authoring tables in every tenant schema (migration plan Phase 4,
 * FR-AUTH-1/FR-AUTH-3/FR-AUTH-5). Adapted from
 * `legacy/api/src/infrastructure/database/migrations/tenant/1730000000004-create-exam-authoring-tables.ts`:
 * `exam_type -> exam_module` and `exam_type -> exam_type_question`, both `ON DELETE CASCADE` from their
 * parent (FR-AUTH-5: "deleting an Exam Type removes its configuration [and] its stored question
 * content" — the cascade is what makes that a single `DELETE FROM exam_type` at the application layer).
 *
 * `exam_type.stage_id` foreign-keys the pre-existing `stage` table (Phase 3, already present in every
 * tenant schema by the time this migration runs) with `ON DELETE RESTRICT` — a Stage still referenced
 * by an Exam Type cannot be deleted, mirroring `TaxonomyService`'s own FR-TAX-4 enforcement.
 *
 * **`exam_type_curriculum` is deliberately NOT created by this migration — overriding both this
 * dispatch's own prompt and Phase 3's own `20260815000004-create-curriculum-table.ts` doc-comment
 * prediction** (which guessed this table was "Phase 4's own scope"). Reading the actual legacy code
 * (`FinalizeExamRepository.finalize`, `pdf-processing/application/finalize-exam.service.ts`,
 * `docs/PRODUCT_SPECIFICATION.md`'s FR-PDF-9: "may optionally link one or more Curricula to the
 * resulting Exam Type as part of the same finalize action (FR-AUTH-4)") proves `exam_type_curriculum`'s
 * only real writer is the PDF-processing finalize flow (migration plan Phase 6), never the manual-ZIP
 * authoring path this migration/module implements. Legacy's own migration ordering confirms this:
 * `1730000000008-create-exam-type-curriculum-table.ts` is sequenced *after*
 * `1730000000006-create-pdf-processing-session-table.ts`, not alongside
 * `1730000000004-create-exam-authoring-tables.ts`. See
 * `docs/plans/nextjs-rewrite-phase4-plan.md`'s judgment-call section for the full reasoning. Whichever
 * Phase 6 dispatch builds the finalize flow is expected to create `exam_type_curriculum` at that point,
 * using the exact legacy DDL shape.
 *
 * `CREATE TABLE IF NOT EXISTS` matches every prior tenant migration's idempotent-retry convention.
 */
export class CreateExamAuthoringTables20260815000005 implements MigrationInterface {
  name = 'CreateExamAuthoringTables20260815000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS exam_type (
        id CHAR(36) NOT NULL,
        name VARCHAR(200) NOT NULL,
        description VARCHAR(1000) NULL,
        total_questions INT NOT NULL,
        total_minutes   INT NOT NULL,
        storage_path VARCHAR(512) NULL,
        stage_id INT NULL,
        storage_mode ENUM('LocalDisk','ObjectStore') NOT NULL DEFAULT 'LocalDisk',
        kind ENUM('Standard','LessonPractice','LessonAssessment') NOT NULL DEFAULT 'Standard',
        origin ENUM('ZipImport','AiPipeline') NOT NULL,
        created_by_user_id CHAR(36) NULL,
        pending_delete_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_exam_name (name),
        KEY ix_exam_stage_kind (stage_id, kind),
        KEY ix_exam_pending_delete (pending_delete_at),
        CONSTRAINT fk_exam_stage FOREIGN KEY (stage_id) REFERENCES stage(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS exam_module (
        id CHAR(36) NOT NULL, exam_type_id CHAR(36) NOT NULL,
        module_name VARCHAR(200) NOT NULL, question_count INT NOT NULL,
        PRIMARY KEY (id), UNIQUE KEY uq_module (exam_type_id, module_name),
        CONSTRAINT fk_module_exam FOREIGN KEY (exam_type_id) REFERENCES exam_type(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS exam_type_question (
        id CHAR(36) NOT NULL,
        exam_type_id CHAR(36) NOT NULL,
        module_name VARCHAR(200) NOT NULL,
        question_key VARCHAR(200) NOT NULL,
        question_text TEXT NOT NULL,
        options_json JSON NOT NULL,
        correct_answer VARCHAR(10) NOT NULL,
        explanation TEXT NULL,
        source_generated_question_id CHAR(36) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_etq_key (exam_type_id, question_key),
        KEY ix_etq_module (exam_type_id, module_name),
        KEY ix_etq_src (source_generated_question_id),
        CONSTRAINT fk_etq_exam FOREIGN KEY (exam_type_id) REFERENCES exam_type(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS exam_type_question`);
    await queryRunner.query(`DROP TABLE IF EXISTS exam_module`);
    await queryRunner.query(`DROP TABLE IF EXISTS exam_type`);
  }
}
