import { describe, expect, it } from 'vitest';
import { aggregateCalibrationStats, CONFIDENCE_BANDS, type CalibrationRawRow } from './confidence-calibration';

const THRESHOLD = 0.75;

function row(overrides: Partial<CalibrationRawRow> = {}): CalibrationRawRow {
  return {
    generationMethod: 'exam_extraction_inferred',
    confidenceScore: 0.5,
    isHumanEdited: false,
    isFinalized: false,
    ...overrides,
  };
}

describe('aggregateCalibrationStats', () => {
  it('returns one report per distinct generation method, sorted alphabetically', () => {
    const reports = aggregateCalibrationStats(
      [row({ generationMethod: 'reused_from_cache' }), row({ generationMethod: 'lesson_generation' })],
      THRESHOLD,
    );
    expect(reports.map((r) => r.generationMethod)).toEqual(['lesson_generation', 'reused_from_cache']);
  });

  it('every method report always has all 4 fixed bands, even with zero matching rows', () => {
    const [report] = aggregateCalibrationStats([row({ confidenceScore: 0.95 })], THRESHOLD);
    expect(report.bands).toHaveLength(CONFIDENCE_BANDS.length);
    expect(report.bands[0].count).toBe(0);
    expect(report.bands[3].count).toBe(1);
  });

  it('computes humanEditedRate/finalizedRate correctly within a band', () => {
    const rows = [
      row({ confidenceScore: 0.5, isHumanEdited: true, isFinalized: true }),
      row({ confidenceScore: 0.55, isHumanEdited: false, isFinalized: true }),
      row({ confidenceScore: 0.58, isHumanEdited: false, isFinalized: false }),
      row({ confidenceScore: 0.52, isHumanEdited: false, isFinalized: false }),
    ];
    const [report] = aggregateCalibrationStats(rows, THRESHOLD);
    const band = report.bands[0];
    expect(band.count).toBe(4);
    expect(band.humanEditedRate).toBeCloseTo(0.25);
    expect(band.finalizedRate).toBeCloseTo(0.5);
  });

  it('a band is belowThreshold only when its entire range sits under the live threshold', () => {
    const [report] = aggregateCalibrationStats([row({ confidenceScore: 0.95 })], 0.75);
    expect(report.bands[0].belowThreshold).toBe(true); // 0-0.6
    expect(report.bands[1].belowThreshold).toBe(true); // 0.6-0.75
    expect(report.bands[2].belowThreshold).toBe(false); // 0.75-0.9
    expect(report.bands[3].belowThreshold).toBe(false); // 0.9-1.0
  });

  it('advisory: insufficient data below MIN_SAMPLE_SIZE', () => {
    const [report] = aggregateCalibrationStats([row({ confidenceScore: 0.5 })], THRESHOLD);
    expect(report.bands[0].advisory).toMatch(/Insufficient data/);
  });

  it('advisory: over-flagged when belowThreshold, low edit rate, high accept rate, and enough samples', () => {
    const rows = Array.from({ length: 6 }, () => row({ confidenceScore: 0.5, isHumanEdited: false, isFinalized: true }));
    const [report] = aggregateCalibrationStats(rows, THRESHOLD);
    expect(report.bands[0].advisory).toMatch(/lowering the threshold/);
  });

  it('advisory: under-flagged when not belowThreshold and high edit rate', () => {
    const rows = Array.from({ length: 6 }, () => row({ confidenceScore: 0.95, isHumanEdited: true, isFinalized: false }));
    const [report] = aggregateCalibrationStats(rows, THRESHOLD);
    expect(report.bands[3].advisory).toMatch(/raising the threshold/);
  });

  it('advisory: no strong signal otherwise', () => {
    const rows = Array.from({ length: 6 }, (_, i) => row({ confidenceScore: 0.5, isHumanEdited: i % 2 === 0, isFinalized: i % 3 === 0 }));
    const [report] = aggregateCalibrationStats(rows, THRESHOLD);
    expect(report.bands[0].advisory).toBe('No strong recalibration signal.');
  });

  it('returns an empty array for no rows at all', () => {
    expect(aggregateCalibrationStats([], THRESHOLD)).toEqual([]);
  });

  it('a score of exactly 1.0 lands in the top band (inclusive upper edge)', () => {
    const [report] = aggregateCalibrationStats([row({ confidenceScore: 1.0 })], THRESHOLD);
    expect(report.bands[3].count).toBe(1);
  });
});
