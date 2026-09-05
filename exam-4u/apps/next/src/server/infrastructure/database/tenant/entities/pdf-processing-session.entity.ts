import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * TypeORM mapping for the tenant-schema `pdf_processing_session` table (migration plan Phase 6,
 * sub-slice "6a", migration `20260815000007-create-pdf-processing-tables.ts`; widened by Phase 8's
 * additive migration `20260815000011-create-practice-tables.ts`) — ported from
 * `legacy/api/src/modules/pdf-processing/infrastructure/entities/pdf-processing-session.entity.ts`.
 *
 * **Phase 8 addition**: `session_kind`/`target_question_count`/`target_total_minutes` (legacy's
 * full-bank-assessment columns) are now ported, closing sub-slice "6a"'s own documented deferral —
 * `server/practice`'s `FullBankAssessmentService` is their first and only writer. `StaleSessionRecoveryWorker`
 * (Phase 6) still resumes only via the direct `PdfProcessingService.resumeProcessing` pipeline this
 * dispatch does not touch — a `full_bank_assessment` session's own resume path
 * (`FullBankAssessmentService.resumeProcessing`) is not yet wired into that worker's sweep (a
 * documented, accepted scope gap — see `docs/plans/nextjs-rewrite-phase8-plan.md`'s "Decisions made").
 *
 * Inline literal union types for the enum columns (`contentTypeHint`/`contentType`/`status`), matching
 * `ExamTypeEntity`'s established "no domain-module import from an entity file" convention — every
 * entity under this directory is a cross-module-shared infrastructure artifact, so it never imports a
 * single owning module's own `domain/**` types.
 *
 * This sub-slice reads/writes every column below (upload metadata, both dedup tiers, extraction,
 * classification, the exam-extraction generation branch's watermark/budget columns, and
 * `StaleSessionRecoveryWorker`'s heartbeat/resume-attempt columns).
 */
@Entity({ name: 'pdf_processing_session' })
export class PdfProcessingSessionEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'initiated_by_user_id', type: 'char', length: 36, nullable: true })
  initiatedByUserId!: string | null;

  @Column({ name: 'source_file_name', type: 'varchar', length: 255 })
  sourceFileName!: string;

  @Column({ name: 'content_type_hint', type: 'enum', enum: ['Lesson', 'Exam', 'Reference'], nullable: true })
  contentTypeHint!: 'Lesson' | 'Exam' | 'Reference' | null;

  @Column({ name: 'content_type', type: 'enum', enum: ['Lesson', 'Exam', 'Reference'], nullable: true })
  contentType!: 'Lesson' | 'Exam' | 'Reference' | null;

  @Column({ type: 'enum', enum: ['Pending', 'Extracting', 'Classifying', 'Processing', 'Completed', 'Failed'], default: 'Pending' })
  status!: 'Pending' | 'Extracting' | 'Classifying' | 'Processing' | 'Completed' | 'Failed';

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'error_code', type: 'varchar', length: 60, nullable: true })
  errorCode!: string | null;

  @Column({ name: 'total_questions', type: 'int', default: 0 })
  totalQuestions!: number;

  @Column({ name: 'successful_questions', type: 'int', default: 0 })
  successfulQuestions!: number;

  @Column({ name: 'detected_topics', type: 'json', nullable: true })
  detectedTopics!: string[] | null;

  @Column({ name: 'estimated_questions_per_page', type: 'decimal', precision: 5, scale: 2, nullable: true })
  estimatedQuestionsPerPage!: number | null;

  @Column({ name: 'storage_key_prefix', type: 'varchar', length: 512 })
  storageKeyPrefix!: string;

  @Column({ name: 'source_storage_key', type: 'varchar', length: 512 })
  sourceStorageKey!: string;

  @Column({ name: 'subject_id', type: 'int', nullable: true })
  subjectId!: number | null;

  /** Deliberately no FK, matching legacy's identical LLD DDL choice. */
  @Column({ name: 'curriculum_id', type: 'char', length: 36, nullable: true })
  curriculumId!: string | null;

  /** No FK — `curriculum_document` doesn't exist anywhere in `apps/next` yet (curricula document
   * upload/ingestion is explicitly deferred, see `docs/plans/nextjs-rewrite-phase3-plan.md`/
   * `nextjs-rewrite-phase5-plan.md`). Column kept for wire-shape parity with legacy and so whichever
   * later sub-slice builds `curriculum_document` can add the FK via a follow-up migration without an
   * application-code change — the exact "declare the column now, FK/writer later" precedent this
   * codebase already uses elsewhere (e.g. `exam_type_curriculum`'s own deferral history). */
  @Column({ name: 'curriculum_document_id', type: 'char', length: 36, nullable: true })
  curriculumDocumentId!: string | null;

  @Column({ name: 'file_hash', type: 'char', length: 64 })
  fileHash!: string;

  @Column({ name: 'force_reprocess', type: 'tinyint', width: 1, default: 0 })
  forceReprocess!: boolean;

  @Column({ name: 'reused_from_session_id', type: 'char', length: 36, nullable: true })
  reusedFromSessionId!: string | null;

  @Column({ name: 'page_count', type: 'int', nullable: true })
  pageCount!: number | null;

  @Column({ name: 'tokens_used', type: 'int', default: 0 })
  tokensUsed!: number;

  @Column({ name: 'total_cost', type: 'decimal', precision: 10, scale: 6, default: 0 })
  totalCost!: number;

  @Column({ name: 'budget_exhausted', type: 'tinyint', width: 1, default: 0 })
  budgetExhausted!: boolean;

  @Column({ name: 'last_completed_page', type: 'int', default: 0 })
  lastCompletedPage!: number;

  @Column({ name: 'covered_concepts', type: 'json', nullable: true })
  coveredConcepts!: string[] | null;

  @Column({ name: 'resume_attempts', type: 'int', default: 0 })
  resumeAttempts!: number;

  @Column({ name: 'worker_id', type: 'varchar', length: 100, nullable: true })
  workerId!: string | null;

  @Column({ name: 'heartbeat_at', type: 'datetime', precision: 3, nullable: true })
  heartbeatAt!: Date | null;

  /** Phase 8 addition — `'exam_extraction'` (the implicit default every pre-Phase-8 row carries) vs.
   * `'full_bank_assessment'` (Phase 8's fixed-shape whole-document bank). Distinguishes which
   * generation branch a `pdf_processing_session` row belongs to now that a second one exists. */
  @Column({ name: 'session_kind', type: 'enum', enum: ['exam_extraction', 'full_bank_assessment'], default: 'exam_extraction' })
  sessionKind!: 'exam_extraction' | 'full_bank_assessment';

  /** Phase 8 addition — `FullBankAssessmentService`'s fixed target question count for this session
   * (`null` for every `'exam_extraction'`-kind row, which has no such fixed target). */
  @Column({ name: 'target_question_count', type: 'int', nullable: true })
  targetQuestionCount!: number | null;

  /** Phase 8 addition — the fixed target total exam duration (minutes) this bank is sized for. */
  @Column({ name: 'target_total_minutes', type: 'int', nullable: true })
  targetTotalMinutes!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;

  @Column({ name: 'completed_at', type: 'datetime', precision: 3, nullable: true })
  completedAt!: Date | null;
}
