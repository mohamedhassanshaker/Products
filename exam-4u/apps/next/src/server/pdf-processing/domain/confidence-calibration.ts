import type { GenerationMethod } from './pdf-processing.types';

/**
 * Confidence-threshold recalibration analytics (migration plan Phase 6, sub-slice "6d") — ported
 * verbatim (fields/thresholds/heuristics) from
 * `legacy/api/src/modules/pdf-processing/domain/confidence-calibration.ts`. One pure function, no I/O,
 * matching `confidence.ts`'s own established "pure calibration function" convention in this module.
 * Turns raw per-question reviewer-feedback signal (accumulated across every session a tenant has ever
 * run) into per-generation-method, per-confidence-band statistics plus a plain-language advisory
 * suggestion.
 *
 * **Deliberately read-only/advisory, never auto-applied** — `REVIEW_FLAG_CONFIDENCE_THRESHOLD` is a
 * global, env-backed config value with no runtime-write mechanism anywhere in this codebase, and
 * silently auto-adjusting a threshold that gates human review of AI-generated exam content is a
 * materially larger, riskier surface than anything the spec/LLD actually asks for (matches
 * `docs/NEXUS_STATE.md`'s Dev-33 decision-log precedent this dispatch was told not to relitigate).
 * This function only ever *describes* the data; its caller (`ConfidenceCalibrationService`) never
 * writes anything back.
 */

/** One raw `generated_question` row's reviewer-feedback-relevant fields — the minimal projection
 * `GeneratedQuestionRepository.findAllForCalibration` selects, never the full entity (this feature has
 * no need for question text/options/ids — a documented "no over-exposure" security note). */
export interface CalibrationRawRow {
  generationMethod: GenerationMethod;
  confidenceScore: number;
  isHumanEdited: boolean;
  /** `linked_exam_type_id IS NOT NULL` — the question was actually accepted into a live Exam Type via
   * finalize (FR-PDF-9) or append (FR-PDF-10). */
  isFinalized: boolean;
}

/** One confidence band's aggregated statistics for one generation method. */
export interface CalibrationBandStats {
  bandLabel: string;
  bandMin: number;
  bandMax: number;
  count: number;
  humanEditedRate: number;
  finalizedRate: number;
  /** Whether this band's entire range sits below the *live* `reviewFlagThreshold` passed into
   * {@link aggregateCalibrationStats} — i.e. whether questions in this band are currently
   * review-flagged at generation time. Computed per band, not per question, so the label is stable
   * even though individual questions within a band may have been generated under a since-changed
   * threshold (a documented "no time-series" gap, matching legacy's own). */
  belowThreshold: boolean;
  advisory: string;
}

export interface CalibrationMethodReport {
  generationMethod: GenerationMethod;
  bands: CalibrationBandStats[];
}

/** Fixed bands (LLD/spec silent on an exact scheme — a documented judgment call, ported verbatim):
 * threshold-independent so an operator can evaluate a *prospective* threshold change, not just the
 * live one.
 *
 * **Exported**: `generation-evaluation.ts`'s golden-set evaluation harness buckets freshly generated
 * confidence scores into these exact same four bands so it can correlate a fresh run against this
 * module's own historical per-band `humanEditedRate`/`finalizedRate` — an additive export, no behavior
 * change to this file's own aggregation. */
export const CONFIDENCE_BANDS: ReadonlyArray<{ label: string; min: number; max: number }> = [
  { label: '0.00 – 0.60', min: 0, max: 0.6 },
  { label: '0.60 – 0.75', min: 0.6, max: 0.75 },
  { label: '0.75 – 0.90', min: 0.75, max: 0.9 },
  { label: '0.90 – 1.00', min: 0.9, max: 1.0001 }, // inclusive of a raw 1.0 score
];

/** Below this many sampled questions in a band, any rate computed from it is treated as noise, not
 * signal — a documented, tunable constant. */
export const MIN_SAMPLE_SIZE = 5;
/** A band already below the live threshold (flagged) with an edit rate under this and an acceptance
 * rate at/above {@link HIGH_ACCEPT_RATE} is "over-flagged" — advisory suggests lowering the threshold. */
export const LOW_EDIT_RATE = 0.1;
export const HIGH_ACCEPT_RATE = 0.7;
/** A band at/above the live threshold (not flagged) with an edit rate at/above this is
 * "under-flagged" — advisory suggests raising the threshold to cover it. */
export const HIGH_EDIT_RATE = 0.4;

/**
 * Aggregates {@link CalibrationRawRow}s into one {@link CalibrationMethodReport} per distinct
 * `generationMethod` present in `rows`, each containing all four fixed bands (even bands with zero
 * matching rows — see {@link buildBandStats}'s own "always all four bands" note, so the UI can render
 * a stable table shape regardless of what data happens to exist).
 *
 * @param rows every `generated_question` row's feedback-relevant projection, tenant-wide and
 *   session-unscoped (session-scoping would starve this feature of its own signal).
 * @param reviewFlagThreshold the *live* `env.REVIEW_FLAG_CONFIDENCE_THRESHOLD` value, used only to
 *   label which bands are currently flagged and to pick the correct advisory direction — never
 *   mutated by this function.
 */
export function aggregateCalibrationStats(rows: CalibrationRawRow[], reviewFlagThreshold: number): CalibrationMethodReport[] {
  const byMethod = groupByMethod(rows);
  return Array.from(byMethod.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([generationMethod, methodRows]) => ({
      generationMethod,
      bands: CONFIDENCE_BANDS.map((band) => buildBandStats(band, methodRows, reviewFlagThreshold)),
    }));
}

function groupByMethod(rows: CalibrationRawRow[]): Map<GenerationMethod, CalibrationRawRow[]> {
  const map = new Map<GenerationMethod, CalibrationRawRow[]>();
  for (const row of rows) {
    const existing = map.get(row.generationMethod);
    if (existing) {
      existing.push(row);
    } else {
      map.set(row.generationMethod, [row]);
    }
  }
  return map;
}

/** Builds one band's stats for one generation method — always returned even when `count === 0` (rates
 * default to `0`, advisory becomes "insufficient data"), so every generation method's report has an
 * identical, stable 4-band shape regardless of how sparse the underlying data is. */
function buildBandStats(
  band: { label: string; min: number; max: number },
  methodRows: CalibrationRawRow[],
  reviewFlagThreshold: number,
): CalibrationBandStats {
  const inBand = methodRows.filter((row) => row.confidenceScore >= band.min && row.confidenceScore < band.max);
  const count = inBand.length;
  const humanEditedRate = count === 0 ? 0 : inBand.filter((row) => row.isHumanEdited).length / count;
  const finalizedRate = count === 0 ? 0 : inBand.filter((row) => row.isFinalized).length / count;
  // "Below threshold" is evaluated against the band's own upper edge: a band is currently
  // review-flagged in full only once its entire range sits under the live threshold — matching
  // `calibrateConfidence`'s own `score < reviewFlagThreshold` comparison exactly (LLD §9.3).
  const belowThreshold = band.max <= reviewFlagThreshold;

  return {
    bandLabel: band.label,
    bandMin: band.min,
    bandMax: band.max,
    count,
    humanEditedRate,
    finalizedRate,
    belowThreshold,
    advisory: buildAdvisory(count, humanEditedRate, finalizedRate, belowThreshold),
  };
}

function buildAdvisory(count: number, humanEditedRate: number, finalizedRate: number, belowThreshold: boolean): string {
  if (count < MIN_SAMPLE_SIZE) {
    return 'Insufficient data for a recalibration signal.';
  }
  if (belowThreshold && humanEditedRate < LOW_EDIT_RATE && finalizedRate >= HIGH_ACCEPT_RATE) {
    return 'Rarely edited and often accepted despite being flagged for review — consider lowering the threshold to stop over-flagging this band.';
  }
  if (!belowThreshold && humanEditedRate >= HIGH_EDIT_RATE) {
    return 'High edit rate despite not being flagged for review — consider raising the threshold to include this band.';
  }
  return 'No strong recalibration signal.';
}
