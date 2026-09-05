import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `attempt` and `attempt_question` in every tenant schema (migration plan Phase 7, LLD §4
 * DDL). Adapted from legacy's `1730000000005-create-attempt-tables.ts` (and the Dev-25b addendum
 * migration adding `source_generated_question_id`, folded in here directly since this app has no
 * earlier attempts migration to append to).
 *
 * **`active_key` is a MySQL `STORED GENERATED` column** — `CASE WHEN status='InProgress' THEN
 * CONCAT(user_id,':',exam_type_id) ELSE NULL END` — computed entirely server-side, never read or
 * written by the application (see `AttemptEntity`'s own doc comment for why it is deliberately NOT
 * mapped as a TypeORM column). `UNIQUE KEY uq_attempt_active (active_key)` is what makes "at most ONE
 * `InProgress` attempt per (user, examType)" a real, database-enforced invariant: since every
 * non-`InProgress` row's `active_key` is `NULL`, and MySQL's `UNIQUE` constraint treats multiple `NULL`s
 * as distinct (never colliding with each other), only ever-`InProgress` rows for the *same*
 * `(user_id, exam_type_id)` pair can collide — exactly the invariant FR-TAKE-2 requires, enforced even
 * under two genuinely concurrent `INSERT`s racing the same user/examType (this phase's own concurrency
 * proof test exercises this for real).
 *
 * `exam_type_id`/`user_id` are deliberately NOT FKs (matching legacy's own DDL exactly) — an attempt is
 * an immutable historical record that must survive its source Exam Type or the answering user being
 * later deleted (FR-IAM-7/FR-AUTH-5's own "soft reference" convention already established elsewhere in
 * this schema, e.g. `ExamTypeEntity.createdByUserId`).
 *
 * `CREATE TABLE IF NOT EXISTS` matches every prior tenant migration's idempotent-retry convention.
 */
export class CreateAttemptTables20260815000010 implements MigrationInterface {
  name = 'CreateAttemptTables20260815000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS attempt (
        id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        exam_type_id CHAR(36) NOT NULL,
        start_time DATETIME(3) NOT NULL,
        deadline_at DATETIME(3) NOT NULL,
        end_time DATETIME(3) NULL,
        status ENUM('InProgress','Submitted','TimedOut') NOT NULL DEFAULT 'InProgress',
        total_questions INT NOT NULL,
        answered_count INT NOT NULL DEFAULT 0,
        correct_count INT NOT NULL DEFAULT 0,
        wrong_count INT NOT NULL DEFAULT 0,
        score_percent DECIMAL(4,1) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        active_key VARCHAR(73) AS (CASE WHEN status = 'InProgress' THEN CONCAT(user_id, ':', exam_type_id) ELSE NULL END) STORED,
        PRIMARY KEY (id),
        UNIQUE KEY uq_attempt_active (active_key),
        KEY ix_attempt_user_exam (user_id, exam_type_id, created_at),
        KEY ix_attempt_exam (exam_type_id, created_at),
        KEY ix_attempt_status_deadline (status, deadline_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS attempt_question (
        id CHAR(36) NOT NULL,
        attempt_id CHAR(36) NOT NULL,
        question_index INT NOT NULL,
        subject_name VARCHAR(200) NULL,
        question_key VARCHAR(200) NOT NULL,
        source_generated_question_id CHAR(36) NULL,
        question_text TEXT NOT NULL,
        options_json JSON NOT NULL,
        correct_answer VARCHAR(10) NOT NULL,
        selected_option VARCHAR(10) NULL,
        is_correct TINYINT(1) NULL,
        explanation TEXT NULL,
        answered_at DATETIME(3) NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_aq_attempt_index (attempt_id, question_index),
        KEY ix_aq_attempt (attempt_id),
        CONSTRAINT fk_aq_attempt FOREIGN KEY (attempt_id) REFERENCES attempt(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS attempt_question`);
    await queryRunner.query(`DROP TABLE IF EXISTS attempt`);
  }
}
