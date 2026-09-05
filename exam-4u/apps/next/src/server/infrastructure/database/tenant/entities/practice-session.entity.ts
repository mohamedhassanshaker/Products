import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** The `practice_session.kind` values (migration plan Phase 8, LLD §4 DDL equivalent) — ported from
 * legacy's identical enum. `'Prompt'` is declared but never written (Prompt Practice is never
 * persisted, see `PromptPracticeService`'s own doc comment) — kept for wire-shape parity with legacy
 * and so a later dispatch adding Prompt Practice history/persistence would not need a widening
 * migration. */
export type PracticeSessionKind = 'Prompt' | 'LessonDocument' | 'LessonSubject' | 'LessonCurriculum';

export type PracticeSessionStatus = 'Generating' | 'Completed' | 'Failed';

/**
 * TypeORM mapping for the tenant-schema `practice_session` table (migration plan Phase 8, migration
 * `20260815000011-create-practice-tables.ts`) — ported from
 * `legacy/api/src/modules/practice/infrastructure/entities/practice-session.entity.ts`.
 *
 * `curriculumId`/`curriculumDocumentId`/`subjectId` are plain, un-hydrated FK columns, matching every
 * other cross-module reference in this codebase (`CurriculumEntity.subjectId`'s own doc comment).
 * None of the three is ever populated together — `'LessonDocument'` sets `curriculumDocumentId` (and,
 * since a document always belongs to exactly one Curriculum, `curriculumId`) but leaves `subjectId`
 * as the request's own validated scope; `'LessonSubject'` sets only `subjectId`, leaving both
 * curriculum columns `null`; `'LessonCurriculum'` sets `curriculumId` (and `subjectId`) but leaves
 * `curriculumDocumentId` `null` — synthesis spans every document under the Curriculum, so no single
 * document FK is correct.
 */
@Entity({ name: 'practice_session' })
export class PracticeSessionEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'user_id', type: 'char', length: 36 })
  userId!: string;

  @Column({ type: 'enum', enum: ['Prompt', 'LessonDocument', 'LessonSubject', 'LessonCurriculum'] })
  kind!: PracticeSessionKind;

  @Column({ type: 'text', nullable: true })
  prompt!: string | null;

  @Column({ name: 'curriculum_id', type: 'char', length: 36, nullable: true })
  curriculumId!: string | null;

  @Column({ name: 'curriculum_document_id', type: 'char', length: 36, nullable: true })
  curriculumDocumentId!: string | null;

  @Column({ name: 'subject_id', type: 'int', nullable: true })
  subjectId!: number | null;

  @Column({ name: 'requested_count', type: 'int' })
  requestedCount!: number;

  @Column({ type: 'enum', enum: ['Generating', 'Completed', 'Failed'], default: 'Generating' })
  status!: PracticeSessionStatus;

  @Column({ name: 'error_code', type: 'varchar', length: 60, nullable: true })
  errorCode!: string | null;

  @Column({ name: 'error_message', type: 'varchar', length: 500, nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'grounding_chunks_found', type: 'int', default: 0 })
  groundingChunksFound!: number;

  /** Count of this session's questions sourced from the existing packaged bank (FR-CUR-6's own
   * "minimizing redundant AI calls" metric). */
  @Column({ name: 'reused_from_bank', type: 'int', default: 0 })
  reusedFromBank!: number;

  @Column({ name: 'generated_new', type: 'int', default: 0 })
  generatedNew!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @Column({ name: 'completed_at', type: 'datetime', precision: 3, nullable: true })
  completedAt!: Date | null;
}
