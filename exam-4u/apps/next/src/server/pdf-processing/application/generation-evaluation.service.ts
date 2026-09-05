import { randomUUID } from 'node:crypto';
import type { ExtractedQuestionDraft, GeneratedQuestionDraft } from '@examland/contracts';
import type { AiInvocationContext, AiServicePort } from '@/server/ai';
import { getEnv } from '@/server/config';
import { calibrateConfidence } from '../domain/confidence';
import { buildEvaluationReport, type EvaluationReport, type GoldenItemOutcome } from '../domain/generation-evaluation';
import { GOLDEN_SET, type GoldenSetItem } from '../evaluation/golden-set';
import type { GenerationMethod } from '../domain/pdf-processing.types';
import { ConfidenceCalibrationService } from './confidence-calibration.service';

/**
 * Internal generation-quality evaluation harness (migration plan Phase 6, sub-slice "6d") — ported
 * from `legacy/api/src/modules/pdf-processing/application/generation-evaluation.service.ts`.
 * **CLI/script-only, no HTTP Route Handler and no UI** — legacy never wired this to a route either
 * (`scripts/evaluate-generation.ts`, this app's port of legacy's identical CLI tool, is its only real
 * caller).
 *
 * **Calls the real `AiServicePort` directly, bypassing `LessonGenerationService`/
 * `ExamExtractionService` entirely** — those two classes are both built around a durable
 * `PdfProcessingSessionEntity` (watermark/budget-checkpoint persistence, per-batch transactional
 * commits) this harness deliberately never creates: it is a stateless, one-shot evaluation run, not a
 * real processing session (no new DB table for this feature). This service instead reuses only the
 * two genuinely shared pure primitives those classes depend on: {@link calibrateConfidence} (LLD
 * §9.3 — the exact same confidence formula every real generation path uses, so a golden-set
 * confidence score means the same thing a real one does) and {@link buildEvaluationReport} (this
 * module's own aggregator).
 *
 * **One item's failure never aborts the run** — an `AiDisabledError`/`AiServiceUnavailableError` (or
 * any other thrown error) for one golden item is caught and recorded as a `failed: true` outcome; the
 * remaining golden items still run. A harness whose whole report disappears because one item's model
 * call happened to fail would defeat the point of a repeatable regression tool.
 */
export class GenerationEvaluationService {
  constructor(
    private readonly aiService: AiServicePort,
    private readonly calibration: ConfidenceCalibrationService,
  ) {}

  /**
   * Runs the full {@link GOLDEN_SET} against the real `AiServicePort` under `tenantId`'s own model
   * assignment (FR-AI-3 — there is no tenant-less call path anywhere in this codebase), then
   * cross-references the fresh output against `tenantId`'s existing calibration report.
   *
   * @param tenantId the tenant whose assigned AI model this run calls, and whose accumulated
   *   reviewer-feedback data this run's confidence bands are correlated against. The caller
   *   (`scripts/evaluate-generation.ts`) is responsible for having already entered this tenant's
   *   scope (`runWithRequestContext`/`withTenantContext`-equivalent) before invoking this method —
   *   `ConfidenceCalibrationService`'s own repository call requires the tenant-scoped `DataSource`
   *   that binds.
   */
  async run(tenantId: string): Promise<EvaluationReport> {
    const outcomes: GoldenItemOutcome[] = [];
    for (const item of GOLDEN_SET) {
      outcomes.push(await this.runOne(item, tenantId));
    }

    const historicalReport = await this.calibration.getReport();
    return buildEvaluationReport(outcomes, historicalReport.generationMethods);
  }

  private async runOne(item: GoldenSetItem, tenantId: string): Promise<GoldenItemOutcome> {
    const generationMethod: GenerationMethod = item.contentType === 'Lesson' ? 'lesson_generation' : 'exam_extraction_inferred';
    try {
      if (item.contentType === 'Lesson') {
        const result = await this.aiService.generateLessonBatch(
          {
            excerpt: item.excerpt,
            pageRange: item.pageRange,
            targetQuestionCount: item.targetQuestionCount,
            coveredConcepts: [],
            // Deliberately always empty — see this module's own doc comment and the golden-set
            // fixture's doc comment (isolates generation quality from retrieval quality).
            grounding: [],
          },
          this.buildInvocationContext(tenantId),
        );
        return {
          goldenItemId: item.id,
          generationMethod: 'lesson_generation',
          failed: false,
          confidenceScores: result.data.map((draft) => this.scoreLesson(draft)),
          droppedItems: result.droppedItems,
        };
      }

      const result = await this.aiService.extractExamPage(
        {
          pageNumber: item.pageNumber,
          pageText: item.pageText,
          grounding: [],
          answerKeyHints: item.answerKeyHints,
        },
        this.buildInvocationContext(tenantId),
      );
      return {
        goldenItemId: item.id,
        // A single golden Exam item's page may produce a mix of `provided`/`inferred` answers; this
        // harness reports each item under the answer-source of its *first* surviving draft (more
        // granularity than a golden-item-level report needs) — a documented simplification.
        generationMethod: result.data[0]?.answerSource === 'provided' ? 'exam_extraction_with_key' : 'exam_extraction_inferred',
        failed: false,
        confidenceScores: result.data.map((draft) => this.scoreExam(draft)),
        droppedItems: result.droppedItems,
      };
    } catch (err) {
      return {
        goldenItemId: item.id,
        generationMethod,
        failed: true,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private scoreLesson(draft: GeneratedQuestionDraft): number {
    return calibrateConfidence({ kind: 'lesson_generation', modelConfidence: draft.modelConfidence }, getEnv().REVIEW_FLAG_CONFIDENCE_THRESHOLD).score;
  }

  private scoreExam(draft: ExtractedQuestionDraft): number {
    const input =
      draft.answerSource === 'provided'
        ? ({ kind: 'exam_extraction_provided', modelConfidence: draft.modelConfidence } as const)
        : ({ kind: 'exam_extraction_inferred', groundingStrength: draft.groundingStrength } as const);
    return calibrateConfidence(input, getEnv().REVIEW_FLAG_CONFIDENCE_THRESHOLD).score;
  }

  /** A generous, fixed budget hint — this harness has no `pdf_processing_session` row to check
   * remaining budget against (see class doc comment), and a golden-set run's own fixed, small item
   * count is never at real risk of tripping a per-session budget the way an unbounded real upload
   * could, so a large constant hint is a safe, documented simplification rather than plumbing a real
   * session's watermark through a tool that never persists one. */
  private buildInvocationContext(tenantId: string): AiInvocationContext {
    const env = getEnv();
    return {
      tenantId,
      correlationId: randomUUID(),
      budget: {
        tokensRemaining: env.PDF_MAX_TOKENS_PER_SESSION,
        costRemainingUsd: env.PDF_MAX_COST_PER_SESSION_USD,
      },
    };
  }
}
