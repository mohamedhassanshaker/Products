import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runWithRequestContext } from '@/server/context';
import { AiServiceUnavailableError, type AiServicePort, type RetrievalService } from '@/server/ai';
import { PdfProcessingSessionEntity } from '@/server/infrastructure/database';
import { LessonGenerationService, LESSON_GROUNDING_TOP_K } from './lesson-generation.service';
import type { PdfProcessingSessionRepository } from '../infrastructure/pdf-processing-session.repository';

function fakeSession(overrides: Partial<PdfProcessingSessionEntity> = {}): PdfProcessingSessionEntity {
  return Object.assign(new PdfProcessingSessionEntity(), {
    id: 'sess-1',
    initiatedByUserId: 'user-1',
    sourceFileName: 'lesson.pdf',
    contentType: 'Lesson',
    status: 'Processing',
    curriculumId: null,
    estimatedQuestionsPerPage: 2,
    coveredConcepts: null,
    tokensUsed: 0,
    totalCost: 0,
    budgetExhausted: false,
    lastCompletedPage: 0,
    ...overrides,
  });
}

function draft(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    questionText: 'What is photosynthesis?',
    options: [
      { key: 'A', text: 'A process' },
      { key: 'B', text: 'A rock' },
    ],
    correctAnswer: 'A',
    explanation: 'It converts light to chemical energy.',
    bloomsLevel: 2,
    modelConfidence: 0.9,
    concept: 'photosynthesis',
    ...overrides,
  };
}

function usage(overrides: Partial<Record<string, unknown>> = {}) {
  return { model: 'm', promptTokens: 10, completionTokens: 5, costUsd: 0.01, costUnavailable: false, latencyMs: 1, attempts: 1, ...overrides };
}

function fakeRetrieval(chunks: { text: string; fileName: string; pageNumber: number; score: number }[] = []): RetrievalService {
  return { retrieve: vi.fn().mockResolvedValue(chunks) } as unknown as RetrievalService;
}

function fakeSessionRepository(): { sessions: PdfProcessingSessionRepository; persistBatchAndAdvanceWatermark: ReturnType<typeof vi.fn> } {
  const persistBatchAndAdvanceWatermark = vi.fn().mockResolvedValue(undefined);
  return { sessions: { persistBatchAndAdvanceWatermark } as unknown as PdfProcessingSessionRepository, persistBatchAndAdvanceWatermark };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ requestId: randomUUID(), tenantId: 'tenant-1' }, fn);
}

/** Long enough (3000-char excerpt target) that a multi-page document plans several real batches. */
function page(pageNumber: number) {
  return { pageNumber, text: `Real lesson prose about a topic on page ${pageNumber}. `.repeat(120) };
}

describe('LessonGenerationService (FR-PDF-4)', () => {
  it('issues one generateLessonBatch call per planned batch and advances the watermark durably per batch', async () => {
    const generateLessonBatch = vi.fn().mockResolvedValue({ data: [draft()], usage: usage(), droppedItems: 0 });
    const { sessions, persistBatchAndAdvanceWatermark } = fakeSessionRepository();
    const service = new LessonGenerationService({ generateLessonBatch } as unknown as AiServicePort, sessions, fakeRetrieval());

    const session = fakeSession();
    await withTenant(() => service.generate(session, [page(1), page(2), page(3)]));

    expect(generateLessonBatch).toHaveBeenCalled();
    expect(persistBatchAndAdvanceWatermark).toHaveBeenCalledTimes(generateLessonBatch.mock.calls.length);
    expect(session.lastCompletedPage).toBeGreaterThan(0);
  });

  it('checks the budget BEFORE the first call — an already-exhausted session never issues one billable call', async () => {
    const generateLessonBatch = vi.fn();
    const { sessions } = fakeSessionRepository();
    const service = new LessonGenerationService({ generateLessonBatch } as unknown as AiServicePort, sessions, fakeRetrieval());

    const session = fakeSession({ tokensUsed: Number.MAX_SAFE_INTEGER });
    await withTenant(() => service.generate(session, [page(1), page(2)]));

    expect(generateLessonBatch).not.toHaveBeenCalled();
    expect(session.budgetExhausted).toBe(true);
  });

  it('carries covered concepts forward into each subsequent batch (never repeating an earlier one)', async () => {
    const generateLessonBatch = vi
      .fn()
      .mockResolvedValueOnce({ data: [draft({ concept: 'mitosis' })], usage: usage(), droppedItems: 0 })
      .mockResolvedValue({ data: [draft({ concept: 'osmosis' })], usage: usage(), droppedItems: 0 });
    const { sessions } = fakeSessionRepository();
    const service = new LessonGenerationService({ generateLessonBatch } as unknown as AiServicePort, sessions, fakeRetrieval());

    // Density 10/page over 3 pages plans 30 questions => 3 batches of 10, so there is a genuine
    // second call whose `coveredConcepts` must carry the first batch's concept forward.
    const session = fakeSession({ estimatedQuestionsPerPage: 10 });
    await withTenant(() => service.generate(session, [page(1), page(2), page(3)]));

    expect(generateLessonBatch.mock.calls.length).toBeGreaterThan(1);
    expect(generateLessonBatch.mock.calls[0][0].coveredConcepts).toEqual([]);
    expect(generateLessonBatch.mock.calls[1][0].coveredConcepts).toEqual(['mitosis']);
    expect(session.coveredConcepts).toContain('mitosis');
  });

  it('persists every surviving draft in a batch regardless of how many siblings the port dropped (per-item isolation)', async () => {
    const generateLessonBatch = vi
      .fn()
      .mockResolvedValue({ data: [draft(), draft({ concept: 'diffusion' })], usage: usage(), droppedItems: 5 });
    const { sessions, persistBatchAndAdvanceWatermark } = fakeSessionRepository();
    const service = new LessonGenerationService({ generateLessonBatch } as unknown as AiServicePort, sessions, fakeRetrieval());

    await withTenant(() => service.generate(fakeSession(), [page(1)]));

    expect(persistBatchAndAdvanceWatermark.mock.calls[0][0].entities).toHaveLength(2);
  });

  it('resolves grounding at topK 5, scoped to the session curriculum when it has one (FR-CUR-4)', async () => {
    const generateLessonBatch = vi.fn().mockResolvedValue({ data: [draft()], usage: usage(), droppedItems: 0 });
    const retrieval = fakeRetrieval([{ text: 'grounding', fileName: 'src.pdf', pageNumber: 1, score: 0.9 }]);
    const { sessions } = fakeSessionRepository();
    const service = new LessonGenerationService({ generateLessonBatch } as unknown as AiServicePort, sessions, retrieval);

    await withTenant(() => service.generate(fakeSession({ curriculumId: 'cur-1' }), [page(1)]));

    expect(retrieval.retrieve).toHaveBeenCalledWith({ tenantId: 'tenant-1' }, { curriculumId: 'cur-1' }, expect.any(String), LESSON_GROUNDING_TOP_K);
    expect(generateLessonBatch.mock.calls[0][0].grounding).toHaveLength(1);
  });

  it('treats an empty retrieval result as a valid, unremarkable input (never special-cased)', async () => {
    const generateLessonBatch = vi.fn().mockResolvedValue({ data: [draft()], usage: usage(), droppedItems: 0 });
    const { sessions } = fakeSessionRepository();
    const service = new LessonGenerationService({ generateLessonBatch } as unknown as AiServicePort, sessions, fakeRetrieval([]));

    await withTenant(() => service.generate(fakeSession(), [page(1)]));

    expect(generateLessonBatch.mock.calls[0][0].grounding).toEqual([]);
  });

  it('propagates an AI outage uncaught, leaving the watermark exactly where the last durable batch left it', async () => {
    const generateLessonBatch = vi.fn().mockRejectedValue(new AiServiceUnavailableError('engine down'));
    const { sessions, persistBatchAndAdvanceWatermark } = fakeSessionRepository();
    const service = new LessonGenerationService({ generateLessonBatch } as unknown as AiServicePort, sessions, fakeRetrieval());

    const session = fakeSession();
    await expect(withTenant(() => service.generate(session, [page(1)]))).rejects.toThrow(AiServiceUnavailableError);
    expect(persistBatchAndAdvanceWatermark).not.toHaveBeenCalled();
    expect(session.lastCompletedPage).toBe(0);
  });

  it('generates nothing at all for a resumed session whose watermark already covers every page', async () => {
    const generateLessonBatch = vi.fn();
    const { sessions } = fakeSessionRepository();
    const service = new LessonGenerationService({ generateLessonBatch } as unknown as AiServicePort, sessions, fakeRetrieval());

    await withTenant(() => service.generate(fakeSession({ lastCompletedPage: 3 }), [page(1), page(2), page(3)]));

    expect(generateLessonBatch).not.toHaveBeenCalled();
  });

  it('accumulates tokens/cost across batches and tags every row lesson_generation with a calibrated score', async () => {
    const generateLessonBatch = vi.fn().mockResolvedValue({ data: [draft()], usage: usage(), droppedItems: 0 });
    const { sessions, persistBatchAndAdvanceWatermark } = fakeSessionRepository();
    const service = new LessonGenerationService({ generateLessonBatch } as unknown as AiServicePort, sessions, fakeRetrieval());

    const session = fakeSession();
    await withTenant(() => service.generate(session, [page(1), page(2)]));

    const calls = generateLessonBatch.mock.calls.length;
    expect(session.tokensUsed).toBe(15 * calls);
    expect(Number(session.totalCost)).toBeCloseTo(0.01 * calls, 6);
    const entity = persistBatchAndAdvanceWatermark.mock.calls[0][0].entities[0];
    expect(entity.generationMethod).toBe('lesson_generation');
    expect(entity.subjectId).toBeNull(); // FR-PDF-7 mapping happens afterward, never in this loop.
    expect(entity.confidenceScore).toBeGreaterThan(0);
  });
});
