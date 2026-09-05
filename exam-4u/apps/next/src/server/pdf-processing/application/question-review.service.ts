import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { ExtractedQuestionDraft, GeneratedQuestionDraft, LessonBatchIn, ExtractPageIn } from '@examland/contracts';
import { getEnv } from '@/server/config';
import { requireTenantId } from '@/server/context';
import type { AiInvocationContext, AiServicePort } from '@/server/ai';
import type { StoragePort } from '@/server/common/ports/storage.port';
import { extractPdfPages } from '@/server/infrastructure/text-extraction';
import type { ImageAssociationService, QuestionImageView } from '@/server/media';
import { isBudgetExhausted } from '../domain/budget';
import { calibrateConfidence } from '../domain/confidence';
import { GeneratedQuestionRepository } from '../infrastructure/generated-question.repository';
import { PdfProcessingSessionRepository } from '../infrastructure/pdf-processing-session.repository';
import { GeneratedQuestionEntity, PdfProcessingSessionEntity } from '@/server/infrastructure/database';
import { GeneratedQuestionNotFoundError, PdfProcessingSessionNotFoundError } from '../domain/errors';
import type {
  EditGeneratedQuestionInput,
  GeneratedQuestionImage,
  GeneratedQuestionSummary,
  PaginatedGeneratedQuestions,
} from '../domain/pdf-processing.types';

/** Smallest allowed page size — a page size of 0 would make `findPage`'s `take` meaningless. */
const MIN_PAGE_SIZE = 1;
/** Largest allowed page size, so a caller cannot force an unbounded-scan review page. */
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

/**
 * FR-PDF-8's review/edit/bulk-action business logic (migration plan Phase 6, sub-slice "6c"). Ported
 * logic from `legacy/api/src/modules/pdf-processing/application/question-review.service.ts`, adapted
 * to this app's plain-class composition convention (no NestJS DI) and `getEnv()`-inline config, matching
 * `ExamExtractionService`'s identical established pattern. Kept separate from `PdfProcessingService`
 * (already near this codebase's ~4-5-collaborator convention) rather than growing it further.
 *
 * **The human-touched flag vs. the review flag — two independent booleans, never conflated (FR-PDF-8)**:
 * {@link editQuestion} only ever sets `isHumanEdited = true` and never touches `isReviewFlagged`;
 * {@link flagQuestion}/{@link unflagQuestion} only ever call `setReviewFlag` and never touch
 * `isHumanEdited`. A reviewer can therefore flag an untouched AI question for closer look, edit a
 * question without flagging it, or any combination — downstream reporting can distinguish "AI output,
 * unedited" from "AI output, human-corrected" exactly as FR-PDF-8 requires.
 *
 * **Empty-list no-ops (FR-PDF-8)**: {@link bulkDelete}/{@link bulkRegenerate} both short-circuit to a
 * zero-count result *before* touching the repository or the AI port at all when `ids` is empty — never
 * a validation error, so batch UI actions never need to special-case "nothing selected".
 *
 * **Targeted regeneration (FR-PDF-8: "replacing selected questions with freshly generated ones from the
 * same source, preserving the original count")**: {@link bulkRegenerate} re-extracts the exact source
 * page each targeted question was originally generated from (from the session's stored source PDF) and
 * re-invokes the *same* generation call the session's own content type originally used
 * (`generateLessonBatch` for a `Lesson` session, `extractExamPage` for an `Exam` session), requesting
 * exactly as many replacement drafts as were targeted from that page. This is a best-effort "preserve
 * the original count" — if the engine returns fewer usable drafts than requested for a page, only that
 * many old rows are replaced; any leftover targeted questions for that page are left untouched rather
 * than deleted without a replacement (documented judgment call, ported verbatim from legacy).
 *
 * `ImageAssociationService` is this class's fifth constructor collaborator (already near this
 * codebase's ~4-5-collaborator guideline) — `listForSession`/`editQuestion` both attach each question's
 * `images` (FR-PDF-11/FR-FILE-3 UI) via a read-only batched lookup; this class never calls
 * `associateWithQuestion`/`removeAssociation` (no manual add/remove endpoint exists this sub-slice).
 */
export class QuestionReviewService {
  constructor(
    private readonly generatedQuestions: GeneratedQuestionRepository,
    private readonly sessions: PdfProcessingSessionRepository,
    private readonly storage: StoragePort,
    private readonly aiService: AiServicePort,
    private readonly imageAssociation: ImageAssociationService,
  ) {}

  /** FR-PDF-8's paginated review list. `page`/`pageSize` are clamped defensively. Attaches each
   * returned question's associated images (FR-PDF-11/FR-FILE-3 UI) via one batched lookup covering the
   * whole page, never one lookup per question.
   * @throws {PdfProcessingSessionNotFoundError} if no such session exists. */
  async listForSession(sessionId: string, page?: number, pageSize?: number): Promise<PaginatedGeneratedQuestions> {
    await this.requireSession(sessionId);
    const safePage = Math.max(1, Math.floor(page ?? 1));
    const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.floor(pageSize ?? DEFAULT_PAGE_SIZE)));

    const { items, total } = await this.generatedQuestions.findPage(sessionId, safePage, safePageSize);
    const imagesByQuestion = await this.imageAssociation.listImagesForQuestions(items.map((q) => q.id));
    return {
      items: items.map((item) => toSummary(item, imagesByQuestion.get(item.id) ?? [])),
      total,
      page: safePage,
      pageSize: safePageSize,
    };
  }

  /**
   * FR-PDF-8: "full text/option/answer/explanation editing... marks it as no longer purely
   * auto-generated." Sets `isHumanEdited = true` unconditionally on any successful edit (even an edit
   * that happens to restore the original text byte-for-byte) — this sub-slice does not attempt to
   * detect a no-op edit, matching FR-PDF-8's plain wording ("editing... marks it").
   * @throws {GeneratedQuestionNotFoundError} if no such question exists.
   */
  async editQuestion(id: string, patch: EditGeneratedQuestionInput): Promise<GeneratedQuestionSummary> {
    const existing = await this.requireQuestion(id);

    const update: Partial<GeneratedQuestionEntity> = { isHumanEdited: true };
    if (patch.questionText !== undefined) update.questionText = patch.questionText;
    if (patch.options !== undefined) update.optionsJson = patch.options;
    if (patch.correctAnswer !== undefined) update.correctAnswer = patch.correctAnswer;
    if (patch.explanation !== undefined) update.explanation = patch.explanation;
    if (patch.bloomsLevel !== undefined) update.bloomsLevel = patch.bloomsLevel;
    if (patch.notes !== undefined) update.notes = patch.notes;

    await this.generatedQuestions.update(id, update);
    const images = (await this.imageAssociation.listImagesForQuestions([id])).get(id) ?? [];
    return toSummary({ ...existing, ...update }, images);
  }

  /** FR-PDF-8's review-flag toggle. @throws {GeneratedQuestionNotFoundError} if no such question exists. */
  async flagQuestion(id: string): Promise<void> {
    await this.requireQuestion(id);
    await this.generatedQuestions.setReviewFlag(id, true);
  }

  /** @throws {GeneratedQuestionNotFoundError} if no such question exists. */
  async unflagQuestion(id: string): Promise<void> {
    await this.requireQuestion(id);
    await this.generatedQuestions.setReviewFlag(id, false);
  }

  /** FR-PDF-8: "Bulk delete... accept a list of question ids and are no-ops (200, not errors) on an
   * empty list." Any id not actually belonging to `sessionId` is silently ignored (see
   * `GeneratedQuestionRepository.findManyInSession`'s own doc comment). */
  async bulkDelete(sessionId: string, ids: string[]): Promise<{ deletedCount: number }> {
    if (ids.length === 0) return { deletedCount: 0 };
    await this.requireSession(sessionId);

    const matched = await this.generatedQuestions.findManyInSession(sessionId, ids);
    await this.generatedQuestions.deleteMany(matched.map((q) => q.id));
    return { deletedCount: matched.length };
  }

  /** FR-PDF-8's targeted regeneration — see class doc comment for the full algorithm and its documented
   * "best-effort count preservation" limitation.
   * @throws {PdfProcessingSessionNotFoundError} if no such session exists. */
  async bulkRegenerate(sessionId: string, ids: string[]): Promise<{ regeneratedCount: number; requestedCount: number }> {
    if (ids.length === 0) return { regeneratedCount: 0, requestedCount: 0 };

    const session = await this.requireSession(sessionId);
    const targeted = await this.generatedQuestions.findManyInSession(sessionId, ids);
    if (targeted.length === 0) return { regeneratedCount: 0, requestedCount: ids.length };

    // Grouped by source page — see class doc comment for why re-reading exactly that page (rather than
    // the original multi-page excerpt) is this sub-slice's own documented approximation.
    const byPage = new Map<number, GeneratedQuestionEntity[]>();
    for (const question of targeted) {
      // `Number(null)` is `0` (a deceptively "finite" value) — explicitly treat a null
      // `sourcePageRange` as unresolvable rather than misreading it as "page 0".
      const pageNumber = question.sourcePageRange == null ? NaN : Number(question.sourcePageRange);
      if (!Number.isFinite(pageNumber)) continue; // no recoverable source page — left untouched.
      const group = byPage.get(pageNumber) ?? [];
      group.push(question);
      byPage.set(pageNumber, group);
    }
    if (byPage.size === 0) return { regeneratedCount: 0, requestedCount: ids.length };

    const buffer = await this.readSourcePdf(session);
    const pages = await extractPdfPages(buffer);
    const pageTextByNumber = new Map(pages.map((p) => [p.pageNumber, p.text]));
    const env = getEnv();
    const limits = { maxTokensPerSession: env.PDF_MAX_TOKENS_PER_SESSION, maxCostPerSessionUsd: env.PDF_MAX_COST_PER_SESSION_USD };

    let regeneratedCount = 0;
    const toDelete: string[] = [];
    const toInsert: GeneratedQuestionEntity[] = [];

    for (const [pageNumber, group] of byPage) {
      const pageText = pageTextByNumber.get(pageNumber);
      if (!pageText) continue; // source page no longer resolvable — group left untouched.

      if (isBudgetExhausted({ tokensUsed: session.tokensUsed, totalCost: Number(session.totalCost) }, limits)) {
        session.budgetExhausted = true;
        break; // FR-PDF-12: never issue a regeneration call once the session's budget is spent.
      }

      const ctx = buildInvocationContext(session, limits);
      const drafts = await this.regeneratePage(session, pageText, pageNumber, group.length, ctx);
      const usedCount = Math.min(drafts.length, group.length);

      for (let i = 0; i < usedCount; i += 1) {
        toDelete.push(group[i].id);
        toInsert.push(toRegeneratedEntity(session, pageNumber, drafts[i], env.REVIEW_FLAG_CONFIDENCE_THRESHOLD));
      }
      regeneratedCount += usedCount;
    }

    if (toInsert.length > 0) {
      await this.generatedQuestions.insertMany(toInsert);
      await this.generatedQuestions.deleteMany(toDelete);
    }
    await this.sessions.save(session);

    return { regeneratedCount, requestedCount: ids.length };
  }

  /** Dispatches to the same AI port method the session's own content type originally used —
   * `Reference` sessions never reach here (they have no `generated_question` rows to target). */
  private async regeneratePage(
    session: PdfProcessingSessionEntity,
    pageText: string,
    pageNumber: number,
    targetCount: number,
    ctx: AiInvocationContext,
  ): Promise<GeneratedQuestionDraft[]> {
    if (session.contentType === 'Exam') {
      const input: ExtractPageIn = { pageNumber, pageText, grounding: [] };
      const result = await this.aiService.extractExamPage(input, ctx);
      session.tokensUsed += result.usage.promptTokens + result.usage.completionTokens;
      session.totalCost = Number(session.totalCost) + (result.usage.costUsd ?? 0);
      return result.data;
    }

    // 'Lesson' (the only other content type with generated_question rows targetable for regeneration).
    const input: LessonBatchIn = {
      excerpt: pageText,
      pageRange: String(pageNumber),
      targetQuestionCount: Math.min(targetCount, 10), // LLD §7.11: "<= 10, enforced both sides".
      coveredConcepts: [],
      grounding: [],
    };
    const result = await this.aiService.generateLessonBatch(input, ctx);
    session.tokensUsed += result.usage.promptTokens + result.usage.completionTokens;
    session.totalCost = Number(session.totalCost) + (result.usage.costUsd ?? 0);
    return result.data;
  }

  private async readSourcePdf(session: PdfProcessingSessionEntity): Promise<Buffer> {
    const { stream } = await this.storage.getStream(session.sourceStorageKey);
    return streamToBuffer(stream);
  }

  private async requireSession(id: string): Promise<PdfProcessingSessionEntity> {
    const session = await this.sessions.findById(id);
    if (!session) throw new PdfProcessingSessionNotFoundError();
    return session;
  }

  private async requireQuestion(id: string): Promise<GeneratedQuestionEntity> {
    const question = await this.generatedQuestions.findById(id);
    if (!question) throw new GeneratedQuestionNotFoundError();
    return question;
  }
}

function buildInvocationContext(
  session: PdfProcessingSessionEntity,
  limits: { maxTokensPerSession: number; maxCostPerSessionUsd: number },
): AiInvocationContext {
  return {
    tenantId: requireTenantId(),
    userId: session.initiatedByUserId ?? undefined,
    processingSessionId: session.id,
    correlationId: randomUUID(),
    budget: {
      tokensRemaining: Math.max(0, limits.maxTokensPerSession - session.tokensUsed),
      costRemainingUsd: Math.max(0, limits.maxCostPerSessionUsd - Number(session.totalCost)),
    },
  };
}

/** `generated_question.generation_method = 'regenerated'` regardless of which underlying AI call
 * produced the draft — the distinguishing `answerSource`/confidence-band information for an
 * `Exam`-session draft is still preserved on the row, only the `generation_method` label itself is
 * normalized so a reviewer can tell a regenerated row apart from the session's original generation
 * pass. */
function toRegeneratedEntity(
  session: PdfProcessingSessionEntity,
  pageNumber: number,
  draft: GeneratedQuestionDraft,
  reviewFlagThreshold: number,
): GeneratedQuestionEntity {
  const extracted = draft as Partial<ExtractedQuestionDraft>;
  const isExtracted = session.contentType === 'Exam' && typeof extracted.answerSource === 'string';

  const { score, reviewFlagged } = isExtracted
    ? extracted.answerSource === 'provided'
      ? calibrateConfidence({ kind: 'exam_extraction_provided', modelConfidence: draft.modelConfidence }, reviewFlagThreshold)
      : calibrateConfidence({ kind: 'exam_extraction_inferred', groundingStrength: extracted.groundingStrength ?? 'none' }, reviewFlagThreshold)
    : calibrateConfidence({ kind: 'lesson_generation', modelConfidence: draft.modelConfidence }, reviewFlagThreshold);

  const entity = new GeneratedQuestionEntity();
  entity.id = randomUUID();
  entity.processingSessionId = session.id;
  entity.subjectId = null; // re-classified independently, same as every fresh generation call site.
  entity.questionText = draft.questionText;
  entity.optionsJson = Object.fromEntries(draft.options.map((option) => [option.key, option.text]));
  entity.correctAnswer = draft.correctAnswer;
  entity.explanation = draft.explanation;
  entity.questionType = 'multiple_choice';
  entity.bloomsLevel = draft.bloomsLevel;
  entity.sourcePageRange = draft.sourcePageRange ?? String(pageNumber);
  entity.sourceSection = draft.sourceSection ?? null;
  entity.answerSource = isExtracted ? (extracted.answerSource as 'provided' | 'inferred') : null;
  entity.confidenceScore = score;
  entity.generationMethod = 'regenerated';
  entity.isAutoGenerated = true;
  entity.isHumanEdited = false;
  entity.isReviewFlagged = reviewFlagged;
  entity.notes = null;
  entity.linkedExamTypeId = null;
  entity.batchIndex = null;
  return entity;
}

/** Collects a `Readable` fully into a `Buffer` — `extractPdfPages` requires a complete `Buffer` up
 * front, unlike every other reader in this module that streams straight to an HTTP response. */
function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/** `images` is passed in explicitly (never re-derived here) since resolving it requires an async,
 * batched cross-module lookup (`ImageAssociationService.listImagesForQuestions`) this synchronous
 * mapper cannot itself perform. */
function toSummary(entity: GeneratedQuestionEntity, images: QuestionImageView[] = []): GeneratedQuestionSummary {
  return {
    id: entity.id,
    processingSessionId: entity.processingSessionId,
    subjectId: entity.subjectId,
    questionText: entity.questionText,
    options: entity.optionsJson,
    correctAnswer: entity.correctAnswer,
    explanation: entity.explanation,
    questionType: entity.questionType,
    bloomsLevel: entity.bloomsLevel,
    sourcePageRange: entity.sourcePageRange,
    sourceSection: entity.sourceSection,
    answerSource: entity.answerSource,
    confidenceScore: Number(entity.confidenceScore),
    generationMethod: entity.generationMethod as GeneratedQuestionSummary['generationMethod'],
    // The `mysql2` driver returns a raw `tinyint` as a JS number (0/1), never a real boolean — coerced
    // to a genuine boolean here, at the API boundary, rather than leaking the storage representation.
    isAutoGenerated: Boolean(entity.isAutoGenerated),
    isHumanEdited: Boolean(entity.isHumanEdited),
    isReviewFlagged: Boolean(entity.isReviewFlagged),
    notes: entity.notes,
    linkedExamTypeId: entity.linkedExamTypeId,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    images: images.map((img): GeneratedQuestionImage => ({
      id: img.id,
      storageKey: img.storageKey,
      altText: img.altText,
      caption: img.caption,
      position: img.position,
      optionKey: img.optionKey,
      width: img.width,
      height: img.height,
    })),
  };
}
