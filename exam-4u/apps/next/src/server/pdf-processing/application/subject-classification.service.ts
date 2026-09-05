import { randomUUID } from 'node:crypto';
import type { SubjectCandidate, SubjectMapIn, SubjectMapItem } from '@examland/contracts';
import { requireTenantId } from '@/server/context';
import type { AiInvocationContext, AiServicePort } from '@/server/ai';
import { AiDisabledError, AiServiceUnavailableError } from '@/server/ai';
import type { SubjectRepository } from '@/server/taxonomy';
import { InternalDomainError } from '@/server/common/errors/domain-error';
import { logger } from '@/server/logging';
import type { GeneratedQuestionEntity } from '@/server/infrastructure/database';
import { GeneratedQuestionRepository } from '../infrastructure/generated-question.repository';

/** What one classification pass looked at and changed. `examined === 0` is the ordinary "nothing left
 * to do" idempotent no-op; `mapped < examined` means some rows remain undetermined ("cannot determine",
 * LLD §7.11) and are left `null` for a still-later re-run, never a guessed fallback. */
export interface SubjectClassificationResult {
  examined: number;
  mapped: number;
}

/**
 * FR-PDF-7's subject-classification mechanism (migration plan Phase 6, sub-slice "6b") — ported logic
 * from `legacy/api/src/modules/pdf-processing/application/subject-classification.service.ts`:
 * "Generated or extracted questions are mapped to a real taxonomy subject rather than left tagged only
 * by page location; this mapping can be retroactively re-run against already-imported content without
 * disturbing already-correct mappings (shared mechanism with FR-AUTH-6)."
 *
 * **One mechanism, two entry points**: {@link classifyUnmappedForSession} (the automatic pass,
 * invoked once by `PdfGenerationOrchestrator` immediately after generation) and
 * {@link classifyUnmappedForExamType} (FR-AUTH-6's reviewer-triggered
 * `POST /api/exam-types/:id/fix-subject-mapping`, reached via `ExamAuthoringService.fixSubjectMapping`)
 * share the same private {@link classify} core, which only ever targets rows where `subject_id IS
 * NULL`. An already-mapped question is never re-classified or overwritten by a later call — exactly
 * what "without disturbing already-correct mappings" requires, and what makes calling either public
 * method again always safe (running the reviewer-triggered action twice in a row makes no further
 * changes on the second run, FR-AUTH-6's own idempotency requirement).
 *
 * **Never fails the whole session (documented judgment call, ported verbatim)**: unlike the generation
 * loops, an `AiDisabledError`/`AiServiceUnavailableError` here is caught and logged, not propagated — a
 * transient engine outage during this best-effort, already-generated-content pass should not prevent an
 * otherwise-successful session from reaching `Completed`. The affected questions simply remain unmapped
 * until the next retroactive re-run, which this same method supports by construction.
 */
export class SubjectClassificationService {
  constructor(
    private readonly aiService: AiServicePort,
    private readonly subjects: SubjectRepository,
    private readonly generatedQuestions: GeneratedQuestionRepository,
  ) {}

  /** FR-PDF-7's automatic pass, scoped to one processing session's own freshly-generated questions.
   * @returns the number of questions actually mapped — mainly so the effect is observable without a
   *   second DB read. */
  async classifyUnmappedForSession(sessionId: string, userId?: string): Promise<number> {
    const unmapped = await this.generatedQuestions.findUnmappedForSession(sessionId);
    const result = await this.classify(unmapped, sessionId, userId);
    return result.mapped;
  }

  /**
   * FR-AUTH-6's standalone, reviewer-triggered entry point: re-runs classification over every
   * currently-unmapped question linked to `examTypeId`. Scoped by Exam Type rather than by processing
   * session because an Exam Type can accumulate questions from multiple sessions (the append flow) —
   * scoping by a single session would silently miss appended content.
   */
  async classifyUnmappedForExamType(examTypeId: string, userId?: string): Promise<SubjectClassificationResult> {
    const unmapped = await this.generatedQuestions.findUnmappedForExamType(examTypeId);
    return this.classify(unmapped, examTypeId, userId);
  }

  /**
   * Shared core: given an already-fetched batch of unmapped rows, asks the AI service to classify them
   * and writes back every mapping it could confidently determine. Never called with rows the caller
   * hasn't already filtered to `subject_id IS NULL` (see both call sites' repository queries) — so a
   * mapped row is never revisited/overwritten, the invariant this whole feature's idempotency rests on.
   *
   * @param correlationScopeId a session or Exam Type id, used only for `AiInvocationContext`'s
   *   `processingSessionId` field and log messages — the AI port itself has no concept of which of the
   *   two callers invoked it.
   */
  private async classify(
    unmapped: GeneratedQuestionEntity[],
    correlationScopeId: string,
    userId?: string,
  ): Promise<SubjectClassificationResult> {
    if (unmapped.length === 0) return { examined: 0, mapped: 0 };

    const candidateSubjects = await this.subjects.findAll();
    // Nothing to map against — leave every row unmapped. Not an error, and no billable AI call made.
    if (candidateSubjects.length === 0) return { examined: unmapped.length, mapped: 0 };

    const candidates: SubjectCandidate[] = candidateSubjects.map((subject) => ({ subjectId: subject.id, name: subject.name }));
    const items: SubjectMapItem[] = unmapped.map((question) => ({ ref: question.id, questionText: question.questionText }));
    const input: SubjectMapIn = { candidates, items };

    const ctx: AiInvocationContext = {
      tenantId: requireTenantIdOrInternal(),
      userId,
      processingSessionId: correlationScopeId,
      correlationId: randomUUID(),
      // Advisory-only at the port boundary (same rationale as `PdfProcessingService.classify`'s
      // identical comment) — subject classification is not part of FR-PDF-12's chunked,
      // budget-bounded generation loop.
      budget: { tokensRemaining: Number.MAX_SAFE_INTEGER, costRemainingUsd: Number.MAX_SAFE_INTEGER },
    };

    // Only ids the caller's own query returned are writable — a mapping naming any other `ref` (a
    // hallucinated or stale id) is discarded rather than trusted, so a model response can never reach
    // a row outside the batch it was asked about.
    const writableRefs = new Set(unmapped.map((question) => question.id));

    let mappedCount = 0;
    try {
      const result = await this.aiService.classifySubject(input, ctx);
      for (const mapping of result.data.mappings) {
        // `subjectId: null` = "cannot determine" (LLD §7.11: "NEVER a guessed fallback subject") —
        // left unmapped, never written.
        if (mapping.subjectId === null) continue;
        if (!writableRefs.has(mapping.ref)) continue;
        await this.generatedQuestions.updateSubject(mapping.ref, mapping.subjectId);
        mappedCount += 1;
      }
    } catch (err) {
      if (err instanceof AiDisabledError || err instanceof AiServiceUnavailableError) {
        logger.warn(
          { errCode: err.code, correlationScopeId },
          'pdf_subject_classification_skipped_questions_remain_unmapped_for_later_rerun',
        );
        return { examined: unmapped.length, mapped: mappedCount };
      }
      throw err;
    }
    return { examined: unmapped.length, mapped: mappedCount };
  }
}

/** Programmer-error guard, matching `PdfProcessingService`'s identical framing — every call site runs
 * inside either a real `withTenantContext`-wrapped request or the background pipeline's own fresh
 * tenant scope. */
function requireTenantIdOrInternal(): string {
  try {
    return requireTenantId();
  } catch {
    throw new InternalDomainError(new Error('SubjectClassificationService called outside any resolved tenant scope.'));
  }
}
