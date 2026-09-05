import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * TypeORM mapping for the tenant-schema `exam_type` table (Phase 4, migration
 * `20260815000005-create-exam-authoring-tables.ts`) — ported from
 * `legacy/api/src/modules/exam-authoring/infrastructure/entities/exam-type.entity.ts`. `stageId` is a
 * plain FK column (not a `@ManyToOne` relation), matching `StageEntity.educationLevelId`'s established
 * "id-only, no hydrated graph" convention for cross-module references.
 *
 * `stageId` is nullable at the DB layer even though FR-AUTH-1 lists "the target Stage" as a required
 * field at creation for the manual ZIP path — `ExamAuthoringService` enforces that requirement in
 * application code (so a future authoring path, e.g. the AI pipeline's `origin='AiPipeline'` rows, can
 * legitimately have no stage at creation time without a schema change) — ported verbatim.
 */
@Entity({ name: 'exam_type' })
export class ExamTypeEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description!: string | null;

  @Column({ name: 'total_questions', type: 'int' })
  totalQuestions!: number;

  @Column({ name: 'total_minutes', type: 'int' })
  totalMinutes!: number;

  @Column({ name: 'storage_path', type: 'varchar', length: 512, nullable: true })
  storagePath!: string | null;

  @Column({ name: 'stage_id', type: 'int', nullable: true })
  stageId!: number | null;

  @Column({ name: 'storage_mode', type: 'enum', enum: ['LocalDisk', 'ObjectStore'], default: 'LocalDisk' })
  storageMode!: 'LocalDisk' | 'ObjectStore';

  @Column({ type: 'enum', enum: ['Standard', 'LessonPractice', 'LessonAssessment'], default: 'Standard' })
  kind!: 'Standard' | 'LessonPractice' | 'LessonAssessment';

  /** `ZipImport` (this phase) vs `AiPipeline` (Phase 6's own writer) — a `ZipImport`-origin exam type
   * cannot later be appended to by the AI pipeline's incremental-generation flow, which this column is
   * what a future phase checks (ported verbatim, unused by this phase's own logic beyond persisting
   * `'ZipImport'`). */
  @Column({ type: 'enum', enum: ['ZipImport', 'AiPipeline'] })
  origin!: 'ZipImport' | 'AiPipeline';

  @Column({ name: 'created_by_user_id', type: 'char', length: 36, nullable: true })
  createdByUserId!: string | null;

  /** FR-AUTH-5's deferred-deletion marker — always `null` in this phase (see
   * `ExamTypeHasActiveAttemptsError`'s doc comment: `hasActiveAttempts()` always resolves `false` until
   * Phase 7's `attempts` module exists, matching legacy's own Dev-12a/Dev-19a-era stub behavior). */
  @Column({ name: 'pending_delete_at', type: 'datetime', precision: 3, nullable: true })
  pendingDeleteAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;
}
