import { describe, expect, it } from 'vitest';
import { buildEvaluationReport, type GoldenItemOutcome } from './generation-evaluation';
import type { CalibrationMethodReport } from './confidence-calibration';

describe('buildEvaluationReport', () => {
  it('aggregates totals across a mix of succeeded/failed outcomes', () => {
    const outcomes: GoldenItemOutcome[] = [
      { goldenItemId: 'a', generationMethod: 'lesson_generation', failed: false, confidenceScores: [0.9, 0.8], droppedItems: 1 },
      { goldenItemId: 'b', generationMethod: 'exam_extraction_inferred', failed: true, errorMessage: 'AI disabled' },
    ];
    const report = buildEvaluationReport(outcomes, []);
    expect(report.totalGolden).toBe(2);
    expect(report.totalFailed).toBe(1);
    expect(report.totalGenerated).toBe(2);
    expect(report.totalDropped).toBe(1);
    expect(report.overallDropRate).toBeCloseTo(1 / 3);
    expect(report.overallAvgConfidence).toBeCloseTo(0.85);
  });

  it('a failed item contributes 0 to generated/dropped and null avgConfidence', () => {
    const outcomes: GoldenItemOutcome[] = [{ goldenItemId: 'a', generationMethod: 'lesson_generation', failed: true, errorMessage: 'boom' }];
    const report = buildEvaluationReport(outcomes, []);
    const [item] = report.items;
    expect(item.generatedCount).toBe(0);
    expect(item.droppedItems).toBe(0);
    expect(item.dropRate).toBe(0);
    expect(item.avgConfidence).toBeNull();
    expect(report.overallAvgConfidence).toBeNull();
  });

  it('overallDropRate is 0 for an entirely empty golden set (no divide-by-zero)', () => {
    const report = buildEvaluationReport([], []);
    expect(report.overallDropRate).toBe(0);
    expect(report.totalGolden).toBe(0);
  });

  it('buckets fresh confidence scores into the same 4 fixed bands, per generation method', () => {
    const outcomes: GoldenItemOutcome[] = [
      { goldenItemId: 'a', generationMethod: 'lesson_generation', failed: false, confidenceScores: [0.95, 0.5], droppedItems: 0 },
    ];
    const report = buildEvaluationReport(outcomes, []);
    const [method] = report.methods;
    expect(method.generationMethod).toBe('lesson_generation');
    expect(method.bands).toHaveLength(4);
    expect(method.bands[0].freshCount).toBe(1); // 0.5 -> band 0
    expect(method.bands[3].freshCount).toBe(1); // 0.95 -> band 3
  });

  it('joins fresh bands against historical rates by generation method, defaulting to null when absent', () => {
    const historical: CalibrationMethodReport[] = [
      {
        generationMethod: 'lesson_generation',
        bands: [
          { bandLabel: '0.00 – 0.60', bandMin: 0, bandMax: 0.6, count: 10, humanEditedRate: 0.2, finalizedRate: 0.8, belowThreshold: true, advisory: 'x' },
          { bandLabel: '0.60 – 0.75', bandMin: 0.6, bandMax: 0.75, count: 0, humanEditedRate: 0, finalizedRate: 0, belowThreshold: true, advisory: 'x' },
          { bandLabel: '0.75 – 0.90', bandMin: 0.75, bandMax: 0.9, count: 0, humanEditedRate: 0, finalizedRate: 0, belowThreshold: false, advisory: 'x' },
          { bandLabel: '0.90 – 1.00', bandMin: 0.9, bandMax: 1.0001, count: 0, humanEditedRate: 0, finalizedRate: 0, belowThreshold: false, advisory: 'x' },
        ],
      },
    ];
    const outcomes: GoldenItemOutcome[] = [
      { goldenItemId: 'a', generationMethod: 'lesson_generation', failed: false, confidenceScores: [0.5], droppedItems: 0 },
      { goldenItemId: 'b', generationMethod: 'exam_extraction_inferred', failed: false, confidenceScores: [0.65], droppedItems: 0 },
    ];
    const report = buildEvaluationReport(outcomes, historical);
    const lesson = report.methods.find((m) => m.generationMethod === 'lesson_generation')!;
    expect(lesson.bands[0].historicalHumanEditedRate).toBe(0.2);
    expect(lesson.bands[0].historicalFinalizedRate).toBe(0.8);

    const exam = report.methods.find((m) => m.generationMethod === 'exam_extraction_inferred')!;
    expect(exam.bands[1].historicalHumanEditedRate).toBeNull();
    expect(exam.bands[1].historicalFinalizedRate).toBeNull();
  });

  it('a failed outcome contributes no scores to its method\'s band distribution', () => {
    const outcomes: GoldenItemOutcome[] = [{ goldenItemId: 'a', generationMethod: 'lesson_generation', failed: true, errorMessage: 'x' }];
    const report = buildEvaluationReport(outcomes, []);
    expect(report.methods).toEqual([]);
  });
});
