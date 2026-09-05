import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * TypeORM mapping for the tenant-schema `attempt_question` table (migration plan Phase 7) — ported
 * from `legacy/api/src/modules/attempts/infrastructure/entities/attempt-question.entity.ts`. Each row
 * is a snapshot of one `exam_type_question` taken at attempt-generation time (FR-TAKE-2) — the question
 * text/options/correct answer/explanation are copied in, never joined live, so a later edit or deletion
 * of the source `exam_type_question` row never changes a Member's already-taken attempt (attempts are
 * an immutable historical record).
 *
 * `subjectName` is always `null` in this phase — `exam_type_question` carries no direct subject link
 * (only `sourceGeneratedQuestionId`, which would require a join through `generated_question` to
 * resolve a subject), and FR-TAKE-1..9 never requires a subject label on a review/history row.
 * Documented judgment call (ported from legacy), not a silent gap.
 */
@Entity({ name: 'attempt_question' })
export class AttemptQuestionEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'attempt_id', type: 'char', length: 36 })
  attemptId!: string;

  /** 0-based display order within the attempt (FR-TAKE-4). Assigned once at generation time from the
   * final, fully-shuffled-across-modules question order — never recomputed. */
  @Column({ name: 'question_index', type: 'int' })
  questionIndex!: number;

  @Column({ name: 'subject_name', type: 'varchar', length: 200, nullable: true })
  subjectName!: string | null;

  /** = `exam_type_question.question_key` at generation time — the stable identity adaptive history
   * (LLD §8.6) looks up in future attempts against this same Exam Type. */
  @Column({ name: 'question_key', type: 'varchar', length: 200 })
  questionKey!: string;

  /** = `exam_type_question.sourceGeneratedQuestionId` at generation time — copied in once, never
   * live-joined afterward (this table's own "immutable historical record" convention, see class doc
   * comment). `null` whenever the source `exam_type_question` itself had no known generated-question
   * origin (e.g. a `ZipImport`-authored Exam Type) — resolved to "no associated images" by
   * `AttemptsService`, never an error. */
  @Column({ name: 'source_generated_question_id', type: 'char', length: 36, nullable: true })
  sourceGeneratedQuestionId!: string | null;

  @Column({ name: 'question_text', type: 'text' })
  questionText!: string;

  @Column({ name: 'options_json', type: 'json' })
  optionsJson!: Record<string, string>;

  @Column({ name: 'correct_answer', type: 'varchar', length: 10 })
  correctAnswer!: string;

  @Column({ name: 'selected_option', type: 'varchar', length: 10, nullable: true })
  selectedOption!: string | null;

  /** Computed only at submit/timeout time (LLD §8.7), never on each individual answer — `null` for an
   * unanswered question even after scoring, which is exactly what makes an unanswered-but-attempted
   * question read back as "never attempted" for a future attempt's adaptive history (§8.6) rather than
   * miscounted as "previously wrong." */
  @Column({ name: 'is_correct', type: 'boolean', nullable: true })
  isCorrect!: boolean | null;

  @Column({ type: 'text', nullable: true })
  explanation!: string | null;

  @Column({ name: 'answered_at', type: 'datetime', precision: 3, nullable: true })
  answeredAt!: Date | null;
}
