import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * TypeORM mapping for the tenant-schema `exam_type_curriculum` join table (LLD §4 DDL, FR-AUTH-4).
 * Migration plan Phase 6, sub-slice "6c" — created here, alongside `FinalizeExamRepository.finalize`,
 * its own real first writer (Phase 4's `20260815000005-create-exam-authoring-tables.ts` and Phase 3's
 * `20260815000004-create-curriculum-table.ts` both deliberately deferred it, see those migrations' own
 * doc comments, until this dispatch existed). Ported from
 * `legacy/api/src/modules/exam-authoring/infrastructure/entities/exam-type-curriculum.entity.ts`.
 *
 * Composite primary key `(exam_type_id, curriculum_id)` — an Exam Type can only be linked to a given
 * Curriculum once. `contextWeight` is bounded 1-10 at the *application* layer
 * (`FinalizeExamService.validateCurriculumLinks`, throwing `INVALID_CONTEXT_WEIGHT`) — the DB-level
 * `chk_ctx_weight` CHECK constraint (this migration) is the defense-in-depth backstop.
 * `applicableModulesJson` is `null` when a link applies to every module of the Exam Type.
 */
@Entity({ name: 'exam_type_curriculum' })
export class ExamTypeCurriculumEntity {
  @PrimaryColumn({ name: 'exam_type_id', type: 'char', length: 36 })
  examTypeId!: string;

  @PrimaryColumn({ name: 'curriculum_id', type: 'char', length: 36 })
  curriculumId!: string;

  @Column({ name: 'context_weight', type: 'tinyint', default: 5 })
  contextWeight!: number;

  @Column({ name: 'applicable_modules_json', type: 'json', nullable: true })
  applicableModulesJson!: string[] | null;
}
