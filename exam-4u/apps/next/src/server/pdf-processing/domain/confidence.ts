/**
 * Confidence calibration (LLD §9.3) — ported verbatim from
 * `legacy/api/src/modules/pdf-processing/domain/confidence.ts`. Every generation/extraction path in
 * this module calls this to turn a raw model confidence value into the stored `confidence_score` plus
 * the derived `is_review_flagged` bit — never persisting a raw model value directly.
 *
 * Built as the single function the LLD names (rather than one function per generation kind), matching
 * legacy's own reasoning: splitting it would duplicate the shared `reviewFlagThreshold` comparison and
 * the banding math across call sites. **This sub-slice ("6a") only exercises the
 * `exam_extraction_provided`/`exam_extraction_inferred` bands** (`ExamExtractionService`'s own writer);
 * `lesson_generation`/`prompt_practice`/`reused_from_cache` are dormant until their respective owning
 * sub-slice/phase adds a real call site — ported whole anyway (not trimmed) since the LLD describes
 * this as one pure function up front, and every band is equally cheap, equally tested pure logic with
 * zero I/O to defer.
 */

/** Discriminated input — one variant per LLD §9.3 table row. */
export type ConfidenceInput =
  | { kind: 'lesson_generation'; modelConfidence: number | null | undefined }
  | { kind: 'prompt_practice'; chunkCount: number; topK: number; bestChunkScore?: number }
  | { kind: 'exam_extraction_provided'; modelConfidence: number | null | undefined }
  | { kind: 'exam_extraction_inferred'; groundingStrength: 'strong' | 'weak' | 'none' }
  | { kind: 'reused_from_cache'; inheritedScore: number };

/** LLD §9.3: `is_review_flagged = confidence < REVIEW_FLAG_CONFIDENCE_THRESHOLD` — configurable
 * (`env.REVIEW_FLAG_CONFIDENCE_THRESHOLD`, default 0.75), passed in rather than hard-coded so a
 * tenant-wide config change never requires touching this pure function. */
export interface CalibrateConfidenceResult {
  score: number;
  reviewFlagged: boolean;
}

const LESSON_GENERATION_DEFAULT = 0.85;
const EXAM_PROVIDED_FLOOR = 0.95;
const PROMPT_PRACTICE_GROUNDED_MIN = 0.8;
const PROMPT_PRACTICE_GROUNDED_MAX = 0.95;
const PROMPT_PRACTICE_UNGROUNDED_MIN = 0.5;
const PROMPT_PRACTICE_UNGROUNDED_MAX = 0.75;
const EXAM_INFERRED_STRONG_MIN = 0.75;
const EXAM_INFERRED_STRONG_MAX = 0.9;
const EXAM_INFERRED_WEAK_MIN = 0.6;
const EXAM_INFERRED_WEAK_MAX = 0.75;

/** Clamps `value` into `[0, 1]` — a defensive guard against a model returning a confidence outside the
 * documented 0-1 range (the `chk_conf` DB constraint would otherwise reject the whole insert). */
function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Linearly scales `fraction` (expected `[0,1]`, itself clamped) into `[min, max]`. */
function scale(fraction: number, min: number, max: number): number {
  return min + clamp01(fraction) * (max - min);
}

export function calibrateConfidence(input: ConfidenceInput, reviewFlagThreshold: number): CalibrateConfidenceResult {
  const score = clamp01(computeScore(input));
  return { score, reviewFlagged: score < reviewFlagThreshold };
}

function computeScore(input: ConfidenceInput): number {
  switch (input.kind) {
    case 'lesson_generation':
      return input.modelConfidence ?? LESSON_GENERATION_DEFAULT;

    case 'prompt_practice': {
      if (input.chunkCount <= 0) {
        return scale(0.5, PROMPT_PRACTICE_UNGROUNDED_MIN, PROMPT_PRACTICE_UNGROUNDED_MAX);
      }
      const volumeFraction = clamp01(input.chunkCount / Math.max(1, input.topK));
      const qualityFraction = clamp01(input.bestChunkScore ?? 1);
      const fraction = (volumeFraction + qualityFraction) / 2;
      return scale(fraction, PROMPT_PRACTICE_GROUNDED_MIN, PROMPT_PRACTICE_GROUNDED_MAX);
    }

    case 'exam_extraction_provided':
      // "max(0.95, model value)" — an explicitly-answered question is never scored below the provided
      // floor even if the raw model confidence came back lower.
      return Math.max(EXAM_PROVIDED_FLOOR, input.modelConfidence ?? EXAM_PROVIDED_FLOOR);

    case 'exam_extraction_inferred':
      // Deterministic midpoint of the documented band per grounding strength — "always review-flagged"
      // for weak/none is guaranteed structurally since both bands' entire range sits below the default
      // 0.75 threshold, not by a separate flag here.
      return input.groundingStrength === 'strong'
        ? scale(0.5, EXAM_INFERRED_STRONG_MIN, EXAM_INFERRED_STRONG_MAX)
        : scale(0.5, EXAM_INFERRED_WEAK_MIN, EXAM_INFERRED_WEAK_MAX);

    case 'reused_from_cache':
      return input.inheritedScore;
  }
}
