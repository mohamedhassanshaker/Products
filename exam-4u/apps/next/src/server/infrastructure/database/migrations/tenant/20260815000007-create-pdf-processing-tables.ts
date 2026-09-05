import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `pdf_processing_session` and `generated_question` in every tenant schema (migration plan
 * Phase 6, sub-slice "6a", LLD §4 DDL). Adapted from legacy's
 * `1730000000006-create-pdf-processing-session-table.ts` +
 * `1730000000007-create-generated-question-and-ai-call-log-tables.ts` (the `ai_call_log` half of the
 * latter already exists in this app via Phase 5's own `20260815000006-create-ai-call-log-table.ts` —
 * not recreated here).
 *
 * **`session_kind`/`target_question_count`/`target_total_minutes` (legacy's full-bank-assessment
 * columns) are deliberately NOT created this sub-slice** — no second session kind/`FullBankAssessmentService`
 * exists anywhere in `apps/next` yet; adding them now would be a forward reference with zero real reader/
 * writer until that later sub-slice/phase lands, the same "half-built, dead-end" anti-pattern this
 * project's own migration history (`exam_type_curriculum`, `curriculum_document`) already rejects.
 *
 * **`idempotency_key` is deliberately NOT created this sub-slice** — its only real writer
 * (`AppendExamService`'s `Idempotency-Key` header handling) belongs to sub-slice 6c's own
 * append-to-an-existing-Exam-Type scope, not this sub-slice's upload/dedup/extraction surface. Building
 * it now would leave a table with zero real writers until 6c, the identical anti-pattern named above —
 * overriding this dispatch's own literal scope-item wording, which named `idempotency_key` up front
 * before this dispatch's own research (reading `AppendExamService`/`AppendExamDto`) confirmed it has no
 * real consumer anywhere in this sub-slice's actual feature surface. Whichever sub-slice builds the
 * append flow is expected to add this table then, using the exact legacy DDL shape (composite
 * `(scope, key)` primary key).
 *
 * `subject_id` FKs the pre-existing `subject` table (`ON DELETE SET NULL` — a deleted Subject must not
 * block deleting/keeping a session/question). `generated_question.processing_session_id` FKs
 * `pdf_processing_session(id)` `ON DELETE CASCADE` (a deleted session's generated output has no
 * independent reason to survive it). `curriculum_id`/`curriculum_document_id` (session) and
 * `linked_exam_type_id`/`batch_index` (question) are deliberately NOT FKs, matching the LLD DDL exactly
 * — `curriculum_document` doesn't even exist as a table in `apps/next` yet (see
 * `PdfProcessingSessionEntity`'s own doc comment).
 *
 * `CREATE TABLE IF NOT EXISTS` matches every prior tenant migration's idempotent-retry convention.
 */
export class CreatePdfProcessingTables20260815000007 implements MigrationInterface {
  name = 'CreatePdfProcessingTables20260815000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pdf_processing_session (
        id CHAR(36) NOT NULL,
        initiated_by_user_id CHAR(36) NULL,
        source_file_name VARCHAR(255) NOT NULL,
        content_type_hint ENUM('Lesson','Exam','Reference') NULL,
        content_type      ENUM('Lesson','Exam','Reference') NULL,
        status ENUM('Pending','Extracting','Classifying','Processing','Completed','Failed') NOT NULL DEFAULT 'Pending',
        error_message TEXT NULL, error_code VARCHAR(60) NULL,
        total_questions INT NOT NULL DEFAULT 0,
        successful_questions INT NOT NULL DEFAULT 0,
        detected_topics JSON NULL,
        estimated_questions_per_page DECIMAL(5,2) NULL,
        storage_key_prefix VARCHAR(512) NOT NULL,
        source_storage_key VARCHAR(512) NOT NULL,
        subject_id INT NULL,
        curriculum_id CHAR(36) NULL,
        curriculum_document_id CHAR(36) NULL,
        file_hash CHAR(64) NOT NULL,
        force_reprocess TINYINT(1) NOT NULL DEFAULT 0,
        reused_from_session_id CHAR(36) NULL,
        page_count INT NULL,
        tokens_used INT NOT NULL DEFAULT 0,
        total_cost DECIMAL(10,6) NOT NULL DEFAULT 0,
        budget_exhausted TINYINT(1) NOT NULL DEFAULT 0,
        last_completed_page INT NOT NULL DEFAULT 0,
        covered_concepts JSON NULL,
        resume_attempts INT NOT NULL DEFAULT 0,
        worker_id VARCHAR(100) NULL,
        heartbeat_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        completed_at DATETIME(3) NULL,
        PRIMARY KEY (id),
        KEY ix_sess_status_created (status, created_at),
        KEY ix_sess_hash_status (file_hash, status),
        KEY ix_sess_heartbeat (status, heartbeat_at),
        KEY ix_sess_user (initiated_by_user_id),
        CONSTRAINT fk_sess_subject FOREIGN KEY (subject_id) REFERENCES subject(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS generated_question (
        id CHAR(36) NOT NULL,
        processing_session_id CHAR(36) NOT NULL,
        subject_id INT NULL,
        question_text TEXT NOT NULL,
        options_json JSON NOT NULL,
        correct_answer VARCHAR(10) NOT NULL,
        explanation TEXT NULL,
        question_type VARCHAR(50) NOT NULL DEFAULT 'multiple_choice',
        blooms_level TINYINT NULL,
        source_page_range VARCHAR(50) NULL,
        source_section VARCHAR(200) NULL,
        answer_source ENUM('provided','inferred') NULL,
        confidence_score DECIMAL(4,3) NOT NULL DEFAULT 0.800,
        generation_method VARCHAR(50) NOT NULL,
        is_auto_generated TINYINT(1) NOT NULL DEFAULT 1,
        is_human_edited TINYINT(1) NOT NULL DEFAULT 0,
        is_review_flagged TINYINT(1) NOT NULL DEFAULT 0,
        notes VARCHAR(1000) NULL,
        linked_exam_type_id CHAR(36) NULL,
        batch_index INT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY ix_gq_session (processing_session_id, created_at),
        KEY ix_gq_conf (processing_session_id, confidence_score),
        KEY ix_gq_linked (linked_exam_type_id),
        CONSTRAINT chk_conf CHECK (confidence_score BETWEEN 0 AND 1),
        CONSTRAINT chk_blooms CHECK (blooms_level IS NULL OR blooms_level BETWEEN 1 AND 6),
        CONSTRAINT fk_gq_session FOREIGN KEY (processing_session_id) REFERENCES pdf_processing_session(id) ON DELETE CASCADE,
        CONSTRAINT fk_gq_subject FOREIGN KEY (subject_id) REFERENCES subject(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS generated_question`);
    await queryRunner.query(`DROP TABLE IF EXISTS pdf_processing_session`);
  }
}
