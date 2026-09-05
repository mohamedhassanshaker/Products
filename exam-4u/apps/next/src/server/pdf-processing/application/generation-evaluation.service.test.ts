import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { AiServicePort } from '@/server/ai';
import { GenerationEvaluationService } from './generation-evaluation.service';
import type { ConfidenceCalibrationService } from './confidence-calibration.service';

function fakeAiService(overrides: Partial<AiServicePort> = {}): AiServicePort {
  return {
    generateLessonBatch: vi.fn(),
    extractExamPage: vi.fn(),
    ...overrides,
  } as unknown as AiServicePort;
}

function fakeCalibration(generationMethods: unknown[] = []): ConfidenceCalibrationService {
  return { getReport: vi.fn().mockResolvedValue({ currentThreshold: 0.75, generationMethods }) } as unknown as ConfidenceCalibrationService;
}

describe('GenerationEvaluationService', () => {
  beforeEach(() => {
    process.env.REVIEW_FLAG_CONFIDENCE_THRESHOLD = '0.75';
    process.env.PDF_MAX_TOKENS_PER_SESSION = '400000';
    process.env.PDF_MAX_COST_PER_SESSION_USD = '2.0';
    (globalThis as { __examlandEnv?: unknown }).__examlandEnv = undefined;
  });
  afterEach(() => {
    (globalThis as { __examlandEnv?: unknown }).__examlandEnv = undefined;
  });

  it('runs every golden-set item and returns a report joined against the historical calibration report', async () => {
    const aiService = fakeAiService({
      generateLessonBatch: vi.fn().mockResolvedValue({ data: [{ modelConfidence: 0.9 }], usage: {}, droppedItems: 0 }),
      extractExamPage: vi.fn().mockResolvedValue({ data: [{ answerSource: 'provided', modelConfidence: 0.96 }], usage: {}, droppedItems: 0 }),
    });
    const service = new GenerationEvaluationService(aiService, fakeCalibration());

    const report = await service.run('tenant-1');

    expect(report.totalGolden).toBe(4); // GOLDEN_SET has 4 items
    expect(report.totalFailed).toBe(0);
    expect(aiService.generateLessonBatch).toHaveBeenCalledTimes(2); // 2 Lesson items
    expect(aiService.extractExamPage).toHaveBeenCalledTimes(2); // 2 Exam items
  });

  it("one golden item's AI call failure is caught and recorded, never aborting the rest of the run", async () => {
    const aiService = fakeAiService({
      generateLessonBatch: vi.fn().mockRejectedValue(new Error('AI disabled')),
      extractExamPage: vi.fn().mockResolvedValue({ data: [], usage: {}, droppedItems: 1 }),
    });
    const service = new GenerationEvaluationService(aiService, fakeCalibration());

    const report = await service.run('tenant-1');

    expect(report.totalGolden).toBe(4);
    expect(report.totalFailed).toBe(2); // the two Lesson items both fail
    expect(report.items.filter((i) => i.failed)).toHaveLength(2);
    expect(report.items.filter((i) => i.failed)[0].errorMessage).toBe('AI disabled');
  });

  it("passes tenantId through to every AiServicePort call's invocation context", async () => {
    const aiService = fakeAiService({
      generateLessonBatch: vi.fn().mockResolvedValue({ data: [], usage: {}, droppedItems: 0 }),
      extractExamPage: vi.fn().mockResolvedValue({ data: [], usage: {}, droppedItems: 0 }),
    });
    const service = new GenerationEvaluationService(aiService, fakeCalibration());

    await service.run('tenant-xyz');

    const [, ctx] = (aiService.generateLessonBatch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(ctx.tenantId).toBe('tenant-xyz');
    expect(ctx.budget.tokensRemaining).toBe(400000);
  });

  it('classifies an exam item with no answer key as exam_extraction_inferred', async () => {
    const aiService = fakeAiService({
      generateLessonBatch: vi.fn().mockResolvedValue({ data: [], usage: {}, droppedItems: 0 }),
      extractExamPage: vi.fn().mockResolvedValue({ data: [{ answerSource: 'inferred', groundingStrength: 'weak' }], usage: {}, droppedItems: 0 }),
    });
    const service = new GenerationEvaluationService(aiService, fakeCalibration());

    const report = await service.run('tenant-1');
    const examItems = report.items.filter((i) => i.goldenItemId.startsWith('exam-'));
    expect(examItems.every((i) => i.generationMethod === 'exam_extraction_inferred')).toBe(true);
  });
});
