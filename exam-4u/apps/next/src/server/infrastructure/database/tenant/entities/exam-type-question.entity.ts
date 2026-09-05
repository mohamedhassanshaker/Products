import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * TypeORM mapping for the tenant-schema `exam_type_question` table (Phase 4) — ported from
 * `legacy/api/src/modules/exam-authoring/infrastructure/entities/exam-type-question.entity.ts`.
 * `optionsJson` is mapped as TypeORM's `json` column type, which serializes/deserializes a plain JS
 * object automatically — the exact `{"A":"…","B":"…",…}` shape the manual-ZIP question-file format
 * uses.
 *
 * `questionKey` is this row's stable identity within its `exam_type` ("stable identity for adaptive
 * history"; "makes append idempotent"). For this phase's ZIP-import path, it is derived
 * deterministically from the archive's own `moduleName/fileName` (see
 * `ExamAuthoringService`'s `deriveQuestionKey`) so re-uploading the exact same ZIP twice against a
 * *new* Exam Type name still produces the same keys — not append-idempotent yet (`ZipImport`-origin
 * exams don't support append at all, see `ExamTypeEntity.origin`'s doc comment), but keeps this column
 * meaningful for the future AI-pipeline append path that does (Phase 6).
 */
@Entity({ name: 'exam_type_question' })
export class ExamTypeQuestionEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'exam_type_id', type: 'char', length: 36 })
  examTypeId!: string;

  @Column({ name: 'module_name', type: 'varchar', length: 200 })
  moduleName!: string;

  @Column({ name: 'question_key', type: 'varchar', length: 200 })
  questionKey!: string;

  @Column({ name: 'question_text', type: 'text' })
  questionText!: string;

  @Column({ name: 'options_json', type: 'json' })
  optionsJson!: Record<string, string>;

  @Column({ name: 'correct_answer', type: 'varchar', length: 10 })
  correctAnswer!: string;

  @Column({ type: 'text', nullable: true })
  explanation!: string | null;

  @Column({ name: 'source_generated_question_id', type: 'char', length: 36, nullable: true })
  sourceGeneratedQuestionId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;
}
