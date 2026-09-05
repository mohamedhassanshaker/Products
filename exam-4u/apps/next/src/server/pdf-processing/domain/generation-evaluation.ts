import { CONFIDENCE_BANDS, type CalibrationMethodReport } from './confidence-calibration';
import type { GenerationMethod } from './pdf-processing.types';

/**
 * Generation-quality evaluation harness aggregator (migration plan Phase 6, sub-slice "6d") — ported
 * verbatim from `legacy/api/src/modules/pdf-processing/domain/generation-evaluation.ts`. One pure
 * function, no I/O, matching this module's own established "pure aggregator" convention
 * (`confidence.ts`, `confidence-calibration.ts`). Turns one harness run's raw per-golden-item outcomes
 * into a stable report: overall drop-rate/confidence summary, a per-generation-method confidence-band
 * distribution (reusing `confidence-calibration.ts`'s own `CONFIDENCE_BANDS`), and a band-by-band
 * correlation against the tenant's existing historical reviewer-feedback aggregator — see
 * `GenerationEvaluationService`'s own doc comment for why this joins against that data rather than
 * requiring fresh human review on every harness run.
 *
 * **CLI/script-only, no HTTP route** — legacy never wired this to a route either (an
 * `evaluate-generation.ts` CLI script is its only real caller); ported the same way here
 * (`scripts/evaluate-generation.ts`).
 */

/** One golden-set item's outcome from a single harness run — either a genuine call result (however
 * many drafts it produced, however many were dropped) or an outright failure (the AI call itself
 * threw, e.g. `AiDisabledError`). */
export type GoldenItemOutcome =
  | {
      goldenItemId: string;
      generationMethod: GenerationMethod;
      failed: false;
      /** One calibrated `confidence_score` per surviving generated draft (already run through the same
       * `calibrateConfidence` pure function the real pipelines use — this harness reuses it verbatim
       * rather than inventing a second confidence formula). */
      confidenceScores: number[];
      droppedItems: number;
    }
  | {
      goldenItemId: string;
      generationMethod: GenerationMethod;
      failed: true;
      errorMessage: string;
    };

/** One golden item's own stats row in the report. */
export interface GoldenItemReport {
  goldenItemId: string;
  generationMethod: GenerationMethod;
  failed: boolean;
  errorMessage?: string;
  generatedCount: number;
  droppedItems: number;
  /** `droppedItems / (generatedCount + droppedItems)`; `0` when nothing was attempted (a failed item
   * never divides by zero). */
  dropRate: number;
  avgConfidence: number | null;
}

/** One confidence band's fresh-run distribution for one generation method, plus (when available) the
 * matching historical band's reviewer-feedback rates from the calibration aggregator. */
export interface EvaluationBandStats {
  bandLabel: string;
  /** Count of this run's freshly generated questions (across every golden item of this
   * `generationMethod`) landing in this band. */
  freshCount: number;
  /** `null` when the historical report has no data at all for this exact `generationMethod` (e.g. a
   * brand-new tenant, or a method this golden set doesn't happen to exercise yet) — never fabricated
   * as `0`, since "no data" and "0% edit rate" are materially different signals to an operator. */
  historicalHumanEditedRate: number | null;
  historicalFinalizedRate: number | null;
}

export interface EvaluationMethodReport {
  generationMethod: GenerationMethod;
  bands: EvaluationBandStats[];
}

export interface EvaluationReport {
  items: GoldenItemReport[];
  totalGolden: number;
  totalFailed: number;
  totalGenerated: number;
  totalDropped: number;
  /** `totalDropped / (totalGenerated + totalDropped)`; `0` for an empty golden set. */
  overallDropRate: number;
  overallAvgConfidence: number | null;
  methods: EvaluationMethodReport[];
}

/**
 * Aggregates one harness run's {@link GoldenItemOutcome}s (plus, optionally, the tenant's own
 * historical `CalibrationMethodReport[]`) into one {@link EvaluationReport}.
 *
 * @param outcomes every golden-set item's outcome from this run, in any order.
 * @param historical `ConfidenceCalibrationService.getReport().generationMethods` — the live tenant's
 *   accumulated reviewer-feedback data, used only to label each fresh band with its matching
 *   historical rates (never mutated, never required — an empty array is a valid input, e.g. a fresh
 *   tenant with no reviewed questions yet).
 */
export function buildEvaluationReport(outcomes: GoldenItemOutcome[], historical: CalibrationMethodReport[]): EvaluationReport {
  const items = outcomes.map(toItemReport);

  const totalGenerated = items.reduce((sum, item) => sum + item.generatedCount, 0);
  const totalDropped = items.reduce((sum, item) => sum + item.droppedItems, 0);
  const overallDropRate = totalGenerated + totalDropped === 0 ? 0 : totalDropped / (totalGenerated + totalDropped);

  const allScores = outcomes.flatMap((outcome) => (outcome.failed ? [] : outcome.confidenceScores));
  const overallAvgConfidence = allScores.length === 0 ? null : average(allScores);

  const historicalByMethod = new Map(historical.map((report) => [report.generationMethod, report]));
  const methods = buildMethodReports(outcomes, historicalByMethod);

  return {
    items,
    totalGolden: outcomes.length,
    totalFailed: outcomes.filter((o) => o.failed).length,
    totalGenerated,
    totalDropped,
    overallDropRate,
    overallAvgConfidence,
    methods,
  };
}

function toItemReport(outcome: GoldenItemOutcome): GoldenItemReport {
  if (outcome.failed) {
    return {
      goldenItemId: outcome.goldenItemId,
      generationMethod: outcome.generationMethod,
      failed: true,
      errorMessage: outcome.errorMessage,
      generatedCount: 0,
      droppedItems: 0,
      dropRate: 0,
      avgConfidence: null,
    };
  }
  const generatedCount = outcome.confidenceScores.length;
  const total = generatedCount + outcome.droppedItems;
  return {
    goldenItemId: outcome.goldenItemId,
    generationMethod: outcome.generationMethod,
    failed: false,
    generatedCount,
    droppedItems: outcome.droppedItems,
    dropRate: total === 0 ? 0 : outcome.droppedItems / total,
    avgConfidence: generatedCount === 0 ? null : average(outcome.confidenceScores),
  };
}

function buildMethodReports(
  outcomes: GoldenItemOutcome[],
  historicalByMethod: Map<GenerationMethod, CalibrationMethodReport>,
): EvaluationMethodReport[] {
  const scoresByMethod = new Map<GenerationMethod, number[]>();
  for (const outcome of outcomes) {
    if (outcome.failed) continue;
    const existing = scoresByMethod.get(outcome.generationMethod) ?? [];
    scoresByMethod.set(outcome.generationMethod, [...existing, ...outcome.confidenceScores]);
  }

  return Array.from(scoresByMethod.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([generationMethod, scores]) => {
      const historicalReport = historicalByMethod.get(generationMethod);
      return {
        generationMethod,
        bands: CONFIDENCE_BANDS.map((band, index) => {
          const freshCount = scores.filter((score) => score >= band.min && score < band.max).length;
          const historicalBand = historicalReport?.bands[index];
          return {
            bandLabel: band.label,
            freshCount,
            historicalHumanEditedRate: historicalBand?.humanEditedRate ?? null,
            historicalFinalizedRate: historicalBand?.finalizedRate ?? null,
          };
        }),
      };
    });
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
