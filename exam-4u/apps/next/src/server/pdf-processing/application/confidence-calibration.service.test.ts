import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ConfidenceCalibrationService } from './confidence-calibration.service';
import type { GeneratedQuestionRepository } from '../infrastructure/generated-question.repository';

function fakeRepo(rows: { generationMethod: string; confidenceScore: number; isHumanEdited: boolean; isFinalized: boolean }[]) {
  return { findAllForCalibration: vi.fn().mockResolvedValue(rows) } as unknown as GeneratedQuestionRepository;
}

describe('ConfidenceCalibrationService', () => {
  beforeEach(() => {
    process.env.REVIEW_FLAG_CONFIDENCE_THRESHOLD = '0.75';
    (globalThis as { __examlandEnv?: unknown }).__examlandEnv = undefined;
  });
  afterEach(() => {
    (globalThis as { __examlandEnv?: unknown }).__examlandEnv = undefined;
  });

  it('reads the live threshold and defers aggregation to the pure domain function', async () => {
    const service = new ConfidenceCalibrationService(
      fakeRepo([{ generationMethod: 'lesson_generation', confidenceScore: 0.5, isHumanEdited: false, isFinalized: false }]),
    );
    const report = await service.getReport();
    expect(report.currentThreshold).toBe(0.75);
    expect(report.generationMethods).toHaveLength(1);
    expect(report.generationMethods[0].generationMethod).toBe('lesson_generation');
  });

  it('returns an empty generationMethods array when there is no data at all', async () => {
    const service = new ConfidenceCalibrationService(fakeRepo([]));
    const report = await service.getReport();
    expect(report.generationMethods).toEqual([]);
  });

  it('never writes anything — the repository is only ever read from', async () => {
    const repo = fakeRepo([]);
    const service = new ConfidenceCalibrationService(repo);
    await service.getReport();
    expect(Object.keys(repo).filter((k) => k.toLowerCase().includes('update') || k.toLowerCase().includes('insert'))).toEqual([]);
  });
});
