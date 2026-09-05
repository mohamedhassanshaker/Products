import { describe, expect, it } from 'vitest';
import { calibrateConfidence } from './confidence';

const THRESHOLD = 0.75;

describe('calibrateConfidence (LLD §9.3)', () => {
  it('lesson_generation: uses the model value when present', () => {
    const result = calibrateConfidence({ kind: 'lesson_generation', modelConfidence: 0.9 }, THRESHOLD);
    expect(result.score).toBe(0.9);
    expect(result.reviewFlagged).toBe(false);
  });

  it('lesson_generation: falls back to 0.85 when the model omits confidence', () => {
    const result = calibrateConfidence({ kind: 'lesson_generation', modelConfidence: undefined }, THRESHOLD);
    expect(result.score).toBe(0.85);
  });

  it('lesson_generation: treats an explicit 0 as a real (low) value, not "missing"', () => {
    const result = calibrateConfidence({ kind: 'lesson_generation', modelConfidence: 0 }, THRESHOLD);
    expect(result.score).toBe(0);
    expect(result.reviewFlagged).toBe(true);
  });

  it('exam_extraction_provided: never scores below the 0.95 floor even if the model reports lower', () => {
    const result = calibrateConfidence({ kind: 'exam_extraction_provided', modelConfidence: 0.6 }, THRESHOLD);
    expect(result.score).toBeGreaterThanOrEqual(0.95);
  });

  it('exam_extraction_inferred: strong grounding lands in the 0.75-0.90 band', () => {
    const result = calibrateConfidence({ kind: 'exam_extraction_inferred', groundingStrength: 'strong' }, THRESHOLD);
    expect(result.score).toBeGreaterThanOrEqual(0.75);
    expect(result.score).toBeLessThanOrEqual(0.9);
  });

  it('exam_extraction_inferred: weak/none grounding lands in the 0.60-0.75 band and is always review-flagged', () => {
    const weak = calibrateConfidence({ kind: 'exam_extraction_inferred', groundingStrength: 'weak' }, THRESHOLD);
    const none = calibrateConfidence({ kind: 'exam_extraction_inferred', groundingStrength: 'none' }, THRESHOLD);
    for (const result of [weak, none]) {
      expect(result.score).toBeGreaterThanOrEqual(0.6);
      expect(result.score).toBeLessThanOrEqual(0.75);
      expect(result.reviewFlagged).toBe(true);
    }
  });

  it('reused_from_cache: inherits the score verbatim, no recalculation', () => {
    const result = calibrateConfidence({ kind: 'reused_from_cache', inheritedScore: 0.42 }, THRESHOLD);
    expect(result.score).toBe(0.42);
    expect(result.reviewFlagged).toBe(true); // below the 0.75 threshold
  });

  it('is_review_flagged is true exactly when the score falls below the configured threshold', () => {
    const justAbove = calibrateConfidence({ kind: 'reused_from_cache', inheritedScore: 0.76 }, THRESHOLD);
    const justBelow = calibrateConfidence({ kind: 'reused_from_cache', inheritedScore: 0.74 }, THRESHOLD);
    expect(justAbove.reviewFlagged).toBe(false);
    expect(justBelow.reviewFlagged).toBe(true);
  });

  it('clamps an out-of-range score into [0,1]', () => {
    const result = calibrateConfidence({ kind: 'reused_from_cache', inheritedScore: 1.5 }, THRESHOLD);
    expect(result.score).toBe(1);
  });

  describe('prompt_practice (FR-CUR-5: "confidence calibrated by grounding-context volume") — dormant this sub-slice, exercised for completeness', () => {
    it('zero chunks found lands in the 0.50-0.75 "no grounding" band', () => {
      const result = calibrateConfidence({ kind: 'prompt_practice', chunkCount: 0, topK: 12 }, THRESHOLD);
      expect(result.score).toBeGreaterThanOrEqual(0.5);
      expect(result.score).toBeLessThanOrEqual(0.75);
    });

    it('any grounding found (even 1 of 12) lands in the higher 0.80-0.95 "grounded" band, strictly above the no-grounding band', () => {
      const zero = calibrateConfidence({ kind: 'prompt_practice', chunkCount: 0, topK: 12, bestChunkScore: 0.9 }, THRESHOLD);
      const one = calibrateConfidence({ kind: 'prompt_practice', chunkCount: 1, topK: 12, bestChunkScore: 0.9 }, THRESHOLD);
      expect(one.score).toBeGreaterThan(zero.score);
      expect(one.score).toBeGreaterThanOrEqual(0.8);
      expect(one.score).toBeLessThanOrEqual(0.95);
    });

    it('MONOTONIC: holding chunk quality (bestChunkScore) fixed, MORE chunks found never lowers confidence, and strictly raises it across a wide range', () => {
      const few = calibrateConfidence({ kind: 'prompt_practice', chunkCount: 1, topK: 12, bestChunkScore: 0.85 }, THRESHOLD);
      const some = calibrateConfidence({ kind: 'prompt_practice', chunkCount: 6, topK: 12, bestChunkScore: 0.85 }, THRESHOLD);
      const many = calibrateConfidence({ kind: 'prompt_practice', chunkCount: 12, topK: 12, bestChunkScore: 0.85 }, THRESHOLD);

      expect(some.score).toBeGreaterThan(few.score);
      expect(many.score).toBeGreaterThan(some.score);
    });

    it('a higher best-chunk-score raises confidence within the grounded band, holding chunk count fixed', () => {
      const weakMatch = calibrateConfidence({ kind: 'prompt_practice', chunkCount: 6, topK: 12, bestChunkScore: 0.3 }, THRESHOLD);
      const strongMatch = calibrateConfidence({ kind: 'prompt_practice', chunkCount: 6, topK: 12, bestChunkScore: 0.95 }, THRESHOLD);
      expect(strongMatch.score).toBeGreaterThan(weakMatch.score);
    });

    it('an omitted bestChunkScore defaults to a perfect match (1.0), never silently scoring as if ungrounded', () => {
      const result = calibrateConfidence({ kind: 'prompt_practice', chunkCount: 12, topK: 12 }, THRESHOLD);
      expect(result.score).toBeCloseTo(0.95, 5);
    });
  });
});
