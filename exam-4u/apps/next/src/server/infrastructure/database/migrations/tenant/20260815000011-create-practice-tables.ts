import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `practice_session`/`practice_question` in every tenant schema, and additively widens
 * `pdf_processing_session` with `session_kind`/`target_question_count`/`target_total_minutes` (migration
 * plan Phase 8) — adapted from `legacy/api/src/modules/practice/infrastructure/entities/*.entity.ts` and
 * legacy's full-bank-assessment addendum migration.
 *
 * **Additive-only, never destructive**: the `ALTER TABLE pdf_processing_session ADD COLUMN` statements
 * below only add nullable/defaulted columns — no existing column is dropped or retyped, and every
 * pre-Phase-8 row is left with `session_kind = 'exam_extraction'` (the column's own `DEFAULT`), which is
 * exactly the implicit kind every such row already was. `CREATE TABLE IF NOT EXISTS`/idempotent
 * `information_schema`-guarded `ALTER TABLE` (MySQL 8 has no `ADD COLUMN IF NOT EXISTS` — the guard below
 * is a portable substitute) match every prior tenant migration's idempotent-retry convention.
 *
 * `practice_session.curriculum_id`/`curriculum_document_id`/`subject_id` are deliberately NOT FKs
 * (matching `pdf_processing_session`'s identical soft-reference DDL choice for the same fields) — a
 * practice session is a historical record of what was practiced, not a live join target.
 */
export class CreatePracticeTables20260815000011 implements MigrationInterface {
  name = 'CreatePracticeTables20260815000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS practice_session (
        id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        kind ENUM('Prompt','LessonDocument','LessonSubject','LessonCurriculum') NOT NULL,
        prompt TEXT NULL,
        curriculum_id CHAR(36) NULL,
        curriculum_document_id CHAR(36) NULL,
        subject_id INT NULL,
        requested_count INT NOT NULL,
        status ENUM('Generating','Completed','Failed') NOT NULL DEFAULT 'Generating',
        error_code VARCHAR(60) NULL,
        error_message VARCHAR(500) NULL,
        grounding_chunks_found INT NOT NULL DEFAULT 0,
        reused_from_bank INT NOT NULL DEFAULT 0,
        generated_new INT NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        completed_at DATETIME(3) NULL,
        PRIMARY KEY (id),
        KEY ix_practice_session_user (user_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS practice_question (
        id CHAR(36) NOT NULL,
        practice_session_id CHAR(36) NOT NULL,
        position INT NOT NULL,
        question_text TEXT NOT NULL,
        options_json JSON NOT NULL,
        correct_answer VARCHAR(10) NOT NULL,
        explanation TEXT NULL,
        confidence_score DECIMAL(4,3) NOT NULL DEFAULT 0.800,
        source ENUM('Bank','Generated') NOT NULL,
        source_ref VARCHAR(200) NULL,
        selected_option VARCHAR(10) NULL,
        is_correct TINYINT(1) NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_pq_session_position (practice_session_id, position),
        KEY ix_pq_session (practice_session_id),
        CONSTRAINT fk_pq_session FOREIGN KEY (practice_session_id) REFERENCES practice_session(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    // Additive widening of `pdf_processing_session` (Phase 6 sub-slice "6a") for
    // `FullBankAssessmentService` (FR-PDF-13) — guarded via `information_schema` since MySQL 8 has no
    // `ADD COLUMN IF NOT EXISTS`.
    const [{ cnt }] = await queryRunner.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'pdf_processing_session' AND column_name = 'session_kind'`,
    );
    if (Number(cnt) === 0) {
      await queryRunner.query(`
        ALTER TABLE pdf_processing_session
          ADD COLUMN session_kind ENUM('exam_extraction','full_bank_assessment') NOT NULL DEFAULT 'exam_extraction' AFTER heartbeat_at,
          ADD COLUMN target_question_count INT NULL AFTER session_kind,
          ADD COLUMN target_total_minutes INT NULL AFTER target_question_count
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS practice_question`);
    await queryRunner.query(`DROP TABLE IF EXISTS practice_session`);
    const [{ cnt }] = await queryRunner.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'pdf_processing_session' AND column_name = 'session_kind'`,
    );
    if (Number(cnt) > 0) {
      await queryRunner.query(`
        ALTER TABLE pdf_processing_session
          DROP COLUMN session_kind,
          DROP COLUMN target_question_count,
          DROP COLUMN target_total_minutes
      `);
    }
  }
}
