import { getEnv } from '@/server/config';
import { GeneratedQuestionRepository } from '../infrastructure/generated-question.repository';
import { aggregateCalibrationStats, type CalibrationMethodReport } from '../domain/confidence-calibration';
import type { GenerationMethod } from '../domain/pdf-processing.types';

/** The full response shape for `GET /api/pdf-processing/analytics/confidence-calibration`. */
export interface CalibrationReport {
  /** The *live* `env.REVIEW_FLAG_CONFIDENCE_THRESHOLD` value at the moment this report was
   * generated — shown to the operator as plain read-only context, never as an editable value (see
   * `docs/design/UX_GUIDELINES.md` §16's own UX decision). */
  currentThreshold: number;
  generationMethods: CalibrationMethodReport[];
}

/**
 * Confidence-threshold recalibration analytics (migration plan Phase 6, sub-slice "6d") — ported from
 * `legacy/api/src/modules/pdf-processing/application/confidence-calibration.service.ts`. Deliberately
 * thin: reads the raw tenant-wide reviewer-feedback projection and the live threshold config, then
 * defers all actual aggregation/heuristic logic to the pure {@link aggregateCalibrationStats} domain
 * function (LLD §1.2: "controllers/services stay thin, business rules live in `domain/`").
 *
 * **Read-only, no side effects whatsoever** — this service never writes to
 * `REVIEW_FLAG_CONFIDENCE_THRESHOLD` or any other row; it exists purely to answer "what does the
 * accumulated review-edit/accept data suggest?", leaving the actual recalibration decision (and the
 * out-of-band deploy/env-var change it would require) to a human operator.
 */
export class ConfidenceCalibrationService {
  constructor(private readonly generatedQuestions: GeneratedQuestionRepository) {}

  async getReport(): Promise<CalibrationReport> {
    const currentThreshold = getEnv().REVIEW_FLAG_CONFIDENCE_THRESHOLD;
    const rawRows = await this.generatedQuestions.findAllForCalibration();
    const rows = rawRows.map((row) => ({ ...row, generationMethod: row.generationMethod as GenerationMethod }));
    return {
      currentThreshold,
      generationMethods: aggregateCalibrationStats(rows, currentThreshold),
    };
  }
}
