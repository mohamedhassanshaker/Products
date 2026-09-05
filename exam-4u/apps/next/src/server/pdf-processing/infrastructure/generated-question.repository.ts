import type { DataSource, Repository } from 'typeorm';
import { GeneratedQuestionEntity } from '@/server/infrastructure/database';

/**
 * Data access for `generated_question` (migration plan Phase 6, sub-slice "6a") — minimal this
 * sub-slice: row insertion happens transactionally alongside the owning session's watermark advance
 * (`PdfProcessingSessionRepository.persistBatchAndAdvanceWatermark`), so this repository's only real
 * consumer is `PdfGenerationOrchestrator.process`'s post-generation `countForSession` read (used to set
 * `session.totalQuestions`/`successfulQuestions` once a branch finishes). Paginated review/edit/bulk
 * queries (`findManyInSession`, etc.) are sub-slice 6c's own scope (question-review.service.ts). Uses
 * the literal table-name string form, matching every other repository in this app.
 */
export class GeneratedQuestionRepository {
  private readonly questions: Repository<GeneratedQuestionEntity>;

  constructor(dataSource: DataSource) {
    this.questions = dataSource.getRepository<GeneratedQuestionEntity>('generated_question');
  }

  /** The count of `generated_question` rows a session has produced so far — used to set
   * `pdf_processing_session.total_questions`/`successful_questions` once a content-type generation
   * branch finishes (both fields carry the identical value this sub-slice, since nothing here ever
   * deletes a row after insertion — review/bulk-delete is sub-slice 6c's own scope). */
  async countForSession(sessionId: string): Promise<number> {
    return this.questions.count({ where: { processingSessionId: sessionId } });
  }

  // ── FR-PDF-7 / FR-PDF-11 (Phase 6, sub-slice "6b") ─────────────────────────────────────────────

  /** Every question a session produced — `ImageExtractionService`'s page-overlap association pass reads
   * the complete set in one query rather than per-image. */
  async findAllForSession(sessionId: string): Promise<GeneratedQuestionEntity[]> {
    return this.questions.find({ where: { processingSessionId: sessionId } });
  }

  /** FR-PDF-7's classification input: every question for this session not yet mapped to a Subject
   * (`subject_id IS NULL`) — the "only unmapped" half of LLD §8.3's "classify-subject (batched, only
   * unmapped...)" step, and the reason a re-run never disturbs an already-correct mapping. */
  async findUnmappedForSession(sessionId: string): Promise<GeneratedQuestionEntity[]> {
    return this.questions
      .createQueryBuilder('q')
      .where('q.processing_session_id = :sessionId', { sessionId })
      .andWhere('q.subject_id IS NULL')
      .getMany();
  }

  /** FR-AUTH-6's retroactive-remapping scope: every question *linked to* a given Exam Type
   * (`linked_exam_type_id`, set at finalize/append time — sub-slice 6c's own writers) not yet mapped to
   * a Subject. Scoped by Exam Type rather than by processing session because an Exam Type can
   * accumulate questions from multiple sessions via the append flow; scoping by one session would
   * silently miss appended content. */
  async findUnmappedForExamType(examTypeId: string): Promise<GeneratedQuestionEntity[]> {
    return this.questions
      .createQueryBuilder('q')
      .where('q.linked_exam_type_id = :examTypeId', { examTypeId })
      .andWhere('q.subject_id IS NULL')
      .getMany();
  }

  /** Applies one FR-PDF-7 mapping — never called for a `subjectId: null` mapping ("cannot determine"),
   * see `SubjectClassificationService`'s own doc comment. */
  async updateSubject(id: string, subjectId: number): Promise<void> {
    await this.questions.update({ id }, { subjectId });
  }

  // ── FR-PDF-8/9/10 (Phase 6, sub-slice "6c") ────────────────────────────────────────────────────

  async findById(id: string): Promise<GeneratedQuestionEntity | null> {
    return this.questions.findOne({ where: { id } });
  }

  /** FR-PDF-8's paginated review list backing — newest first, matching every other paginated list in
   * this app's established convention. */
  async findPage(sessionId: string, page: number, pageSize: number): Promise<{ items: GeneratedQuestionEntity[]; total: number }> {
    const [items, total] = await this.questions.findAndCount({
      where: { processingSessionId: sessionId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total };
  }

  /** Applies an edit patch — `QuestionReviewService.editQuestion` always includes `isHumanEdited: true`
   * in `patch`, never touching `is_review_flagged` (see that service's own class doc comment for why
   * the two flags are never conflated). */
  async update(id: string, patch: Partial<GeneratedQuestionEntity>): Promise<void> {
    await this.questions.update({ id }, patch);
  }

  async setReviewFlag(id: string, flagged: boolean): Promise<void> {
    await this.questions.update({ id }, { isReviewFlagged: flagged });
  }

  /** Every row in `ids` that genuinely belongs to `sessionId` — any id not actually in this session is
   * silently excluded (never an error), so `QuestionReviewService.bulkDelete`/`bulkRegenerate` and
   * `AppendExamService.append` can never be tricked into acting on a row from a different session/
   * tenant via a caller-supplied id list. */
  async findManyInSession(sessionId: string, ids: string[]): Promise<GeneratedQuestionEntity[]> {
    if (ids.length === 0) return [];
    return this.questions
      .createQueryBuilder('q')
      .where('q.processing_session_id = :sessionId', { sessionId })
      .andWhere('q.id IN (:...ids)', { ids })
      .getMany();
  }

  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.questions.delete(ids);
  }

  async insertMany(entities: GeneratedQuestionEntity[]): Promise<void> {
    if (entities.length === 0) return;
    await this.questions.insert(entities);
  }

  /** FR-PDF-9's finalize eligibility query: every question in `sessionId` meeting `minConfidence` (and,
   * if `autoGeneratedOnly`, also `is_auto_generated = 1`) that is not already linked to an Exam Type
   * (`linked_exam_type_id IS NULL` — a question can only ever be finalized/appended once). */
  // ── Sub-slice "6d" (confidence-calibration analytics) ──────────────────────────────────────────

  /** The tenant-wide, session-unscoped reviewer-feedback projection `aggregateCalibrationStats`
   * consumes — only the four feedback-relevant columns, never question text/options/ids (this
   * feature has no need for them, a documented "no over-exposure" security note matching legacy's
   * own). `linked_exam_type_id IS NOT NULL` becomes `isFinalized` at the SQL layer via a raw boolean
   * expression rather than a second query. */
  async findAllForCalibration(): Promise<{ generationMethod: string; confidenceScore: number; isHumanEdited: boolean; isFinalized: boolean }[]> {
    const rows = await this.questions
      .createQueryBuilder('q')
      .select('q.generation_method', 'generationMethod')
      .addSelect('q.confidence_score', 'confidenceScore')
      .addSelect('q.is_human_edited', 'isHumanEdited')
      .addSelect('CASE WHEN q.linked_exam_type_id IS NOT NULL THEN 1 ELSE 0 END', 'isFinalized')
      .getRawMany<{ generationMethod: string; confidenceScore: string | number; isHumanEdited: number; isFinalized: number }>();
    return rows.map((row) => ({
      generationMethod: row.generationMethod,
      confidenceScore: Number(row.confidenceScore),
      isHumanEdited: Boolean(row.isHumanEdited),
      isFinalized: Boolean(row.isFinalized),
    }));
  }

  // ── Phase 8 (`server/practice`'s Lesson Practice, FR-CUR-6) ────────────────────────────────────

  /** Every already-finalized (`linked_exam_type_id IS NOT NULL`) question originating from ANY
   * `pdf_processing_session` targeting a given `curriculum_document` (a source PDF a session's own
   * `curriculum_document_id` FK-equivalent column names — see `PdfProcessingSessionEntity`'s own doc
   * comment; `FullBankAssessmentService.start` is this app's first real writer of that column),
   * ordered by `confidence_score DESC` — `LessonPracticeService`'s document-scoped branch truncates
   * this result to `count` directly (no free-text query to diversity-rank against, since every
   * candidate already comes from this one document). Joined through `pdf_processing_session` rather
   * than a direct `curriculum_document_id` column on `generated_question` (which has none). */
  async findPackagedForDocument(curriculumDocumentId: string): Promise<GeneratedQuestionEntity[]> {
    return this.questions
      .createQueryBuilder('q')
      .innerJoin('pdf_processing_session', 's', 's.id = q.processing_session_id')
      .where('s.curriculum_document_id = :curriculumDocumentId', { curriculumDocumentId })
      .andWhere('q.linked_exam_type_id IS NOT NULL')
      .orderBy('q.confidence_score', 'DESC')
      .getMany();
  }

  /** Every already-finalized question mapped to a given Subject (`subject_id`, set by
   * `SubjectClassificationService`), ordered by `confidence_score DESC` — the candidate pool
   * `LessonPracticeService`'s subject-scoped branch diversity-selects over via `selectDiverse`. */
  async findPackagedForSubject(subjectId: number): Promise<GeneratedQuestionEntity[]> {
    return this.questions
      .createQueryBuilder('q')
      .where('q.subject_id = :subjectId', { subjectId })
      .andWhere('q.linked_exam_type_id IS NOT NULL')
      .orderBy('q.confidence_score', 'DESC')
      .getMany();
  }

  /** Every already-finalized question originating from ANY `pdf_processing_session` whose
   * `curriculum_id` matches — the Curriculum-scoped multi-document-synthesis candidate pool
   * (FR-CUR-6's Curriculum-scoped branch), joined through `pdf_processing_session` rather than a
   * direct `curriculum_id` column on `generated_question` (which has none). Ordered by
   * `confidence_score DESC` so `selectDiverse`'s deterministic seed is always the most-confident
   * candidate across the whole Curriculum, not an arbitrary per-document one. */
  async findPackagedForCurriculum(curriculumId: string): Promise<GeneratedQuestionEntity[]> {
    return this.questions
      .createQueryBuilder('q')
      .innerJoin('pdf_processing_session', 's', 's.id = q.processing_session_id')
      .where('s.curriculum_id = :curriculumId', { curriculumId })
      .andWhere('q.linked_exam_type_id IS NOT NULL')
      .orderBy('q.confidence_score', 'DESC')
      .getMany();
  }

  async findEligibleForFinalize(sessionId: string, minConfidence: number, autoGeneratedOnly: boolean): Promise<GeneratedQuestionEntity[]> {
    let qb = this.questions
      .createQueryBuilder('q')
      .where('q.processing_session_id = :sessionId', { sessionId })
      .andWhere('q.linked_exam_type_id IS NULL')
      .andWhere('q.confidence_score >= :minConfidence', { minConfidence });
    if (autoGeneratedOnly) {
      qb = qb.andWhere('q.is_auto_generated = true');
    }
    return qb.getMany();
  }
}
