import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the tenant-schema `ai_call_log` table (migration plan Phase 5's own "AI cost accounting"
 * line) — ported verbatim from
 * `legacy/api/src/infrastructure/database/migrations/tenant/1730000000007-create-generated-question-and-ai-call-log-tables.ts`'s
 * `ai_call_log` half (the `generated_question` half of that legacy migration belongs to Phase 6's
 * own PDF-processing schema, not this dispatch).
 *
 * No FK on `processing_session_id` — this app has no `pdf_processing_session` table yet (Phase 6),
 * and some calls this table logs (e.g. a standalone Prompt Practice call) never have one at all.
 * `task` is a plain `varchar`, not an enum, so a future AI operation never requires a migration just
 * to log it.
 */
export class CreateAiCallLogTable20260815000006 implements MigrationInterface {
  name = 'CreateAiCallLogTable20260815000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ai_call_log (
        id                    CHAR(36)      NOT NULL,
        processing_session_id CHAR(36)      NULL,
        task                  VARCHAR(40)   NOT NULL,
        model                 VARCHAR(120)  NOT NULL,
        prompt_tokens         INT           NOT NULL DEFAULT 0,
        completion_tokens     INT           NOT NULL DEFAULT 0,
        cost_usd              DECIMAL(10,6) NULL,
        cost_unavailable      TINYINT(1)    NOT NULL DEFAULT 0,
        latency_ms            INT           NOT NULL,
        outcome               ENUM('Success','Failed') NOT NULL,
        error                 VARCHAR(500)  NULL,
        correlation_id        VARCHAR(64)   NULL,
        created_at            DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY ix_ai_call_log_task (task),
        KEY ix_ai_call_log_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS ai_call_log`);
  }
}
