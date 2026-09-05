import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * TypeORM mapping for the tenant-schema `attempt` table (migration plan Phase 7, migration
 * `20260815000010-create-attempt-tables.ts`) — ported from
 * `legacy/api/src/modules/attempts/infrastructure/entities/attempt.entity.ts`. `userId` is a plain FK
 * column (soft reference, FR-IAM-7 — a deleted user's historical attempts are never cascade-deleted),
 * matching every other tenant-scoped "who did this" column's established id-only convention
 * (`CurriculumEntity.ownerUserId`, `ExamTypeEntity.createdByUserId`).
 *
 * **`active_key` (LLD §4 DDL) is deliberately NOT mapped here.** It is a MySQL `STORED GENERATED`
 * column — `CASE WHEN status='InProgress' THEN CONCAT(user_id,':',exam_type_id) ELSE NULL END` —
 * computed entirely server-side on every insert/update; the application never reads or writes it
 * directly, only relies on its `UNIQUE KEY uq_attempt_active` to make FR-TAKE-2's "at most ONE
 * `InProgress` attempt per (user, examType)" invariant hold even under two genuinely concurrent
 * `POST /api/attempts` requests (a race a request-time `SELECT` pre-check alone cannot prevent — see
 * `AttemptsRepository.insertAttempt`'s own doc comment and this phase's own concurrency proof test).
 * Omitting a generated column from the entity mapping is TypeORM-safe: MySQL computes it independently
 * of whatever `INSERT`/`UPDATE` statement TypeORM issues.
 */
@Entity({ name: 'attempt' })
export class AttemptEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId!: string;

  @Column({ name: 'exam_type_id', type: 'char', length: 36 })
  examTypeId!: string;

  @Column({ name: 'start_time', type: 'datetime', precision: 3 })
  startTime!: Date;

  /** Server-authoritative deadline (HLD §10.4): `startTime + examType.totalMinutes`, persisted once at
   * attempt creation and never recomputed — the client timer is display-only and derives from this
   * value plus `serverNow`, never trusted for enforcement. */
  @Column({ name: 'deadline_at', type: 'datetime', precision: 3 })
  deadlineAt!: Date;

  @Column({ name: 'end_time', type: 'datetime', precision: 3, nullable: true })
  endTime!: Date | null;

  @Column({ type: 'enum', enum: ['InProgress', 'Submitted', 'TimedOut'], default: 'InProgress' })
  status!: 'InProgress' | 'Submitted' | 'TimedOut';

  @Column({ name: 'total_questions', type: 'int' })
  totalQuestions!: number;

  @Column({ name: 'answered_count', type: 'int', default: 0 })
  answeredCount!: number;

  @Column({ name: 'correct_count', type: 'int', default: 0 })
  correctCount!: number;

  @Column({ name: 'wrong_count', type: 'int', default: 0 })
  wrongCount!: number;

  /** FR-TAKE-7: "rounded to one decimal place." `null` until the attempt is scored (`Submitted`/
   * `TimedOut`). */
  @Column({ name: 'score_percent', type: 'decimal', precision: 4, scale: 1, nullable: true })
  scorePercent!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}
