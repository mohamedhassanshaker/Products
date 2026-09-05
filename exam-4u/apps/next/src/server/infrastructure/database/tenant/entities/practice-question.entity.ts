import { Column, Entity, PrimaryColumn } from 'typeorm';

export type PracticeQuestionSource = 'Bank' | 'Generated';

/**
 * TypeORM mapping for the tenant-schema `practice_question` table (migration plan Phase 8). Ported
 * from `legacy/api/src/modules/practice/infrastructure/entities/practice-question.entity.ts`.
 *
 * `sourceRef` is the originating `generated_question.id` for a `'Bank'`-sourced row and `null` for a
 * `'Generated'`-sourced row (an AI-authored shortfall-fill question is never itself written to
 * `generated_question`).
 *
 * `selectedOption`/`isCorrect` start `null` and are populated once (never overwritten) by
 * `LessonPracticeService.answer` — this table has no re-answer/change-answer endpoint, matching
 * `AttemptQuestionEntity`'s own "an answered question stays answered" precedent, scaled down for a
 * session with no timer/submit lifecycle.
 */
@Entity({ name: 'practice_question' })
export class PracticeQuestionEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'practice_session_id', type: 'char', length: 36 })
  practiceSessionId!: string;

  @Column({ type: 'int' })
  position!: number;

  @Column({ name: 'question_text', type: 'text' })
  questionText!: string;

  @Column({ name: 'options_json', type: 'json' })
  optionsJson!: Record<string, string>;

  @Column({ name: 'correct_answer', type: 'varchar', length: 10 })
  correctAnswer!: string;

  @Column({ type: 'text', nullable: true })
  explanation!: string | null;

  @Column({ name: 'confidence_score', type: 'decimal', precision: 4, scale: 3, default: 0.8 })
  confidenceScore!: number;

  @Column({ type: 'enum', enum: ['Bank', 'Generated'] })
  source!: PracticeQuestionSource;

  @Column({ name: 'source_ref', type: 'varchar', length: 200, nullable: true })
  sourceRef!: string | null;

  @Column({ name: 'selected_option', type: 'varchar', length: 10, nullable: true })
  selectedOption!: string | null;

  @Column({ name: 'is_correct', type: 'tinyint', width: 1, nullable: true })
  isCorrect!: boolean | null;
}
