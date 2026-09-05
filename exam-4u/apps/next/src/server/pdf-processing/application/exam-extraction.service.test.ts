import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runWithRequestContext } from '@/server/context';
import { AiServiceUnavailableError, type AiServicePort, type RetrievalService } from '@/server/ai';
import { PdfProcessingSessionEntity } from '@/server/infrastructure/database';
import { ExamExtractionService } from './exam-extraction.service';
import type { PdfProcessingSessionRepository } from '../infrastructure/pdf-processing-session.repository';

function fakeSession(overrides: Partial<PdfProcessingSessionEntity> = {}): PdfProcessingSessionEntity {
  return Object.assign(new PdfProcessingSessionEntity(), {
    id: 'sess-1',
    initiatedByUserId: 'user-1',
    sourceFileName: 'exam.pdf',
    contentType: 'Exam',
    status: 'Processing',
    tokensUsed: 0,
    totalCost: 0,
    budgetExhausted: false,
    lastCompletedPage: 0,
    ...overrides,
  });
}

function draft(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    questionText: 'What is the capital of France?',
    options: [
      { key: 'A', text: 'Paris' },
      { key: 'B', text: 'Lyon' },
    ],
    correctAnswer: 'A',
    explanation: 'Paris is the capital.',
    bloomsLevel: 1,
    modelConfidence: 0.9,
    concept: 'geography',
    answerSource: 'provided',
    groundingStrength: 'none',
    ...overrides,
  };
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

function usage(overrides: Partial<Record<string, unknown>> = {}) {
  return { model: 'm', promptTokens: 10, completionTokens: 5, costUsd: 0.01, costUnavailable: false, latencyMs: 1, attempts: 1, ...overrides };
}

describe('ExamExtractionService (FR-PDF-5)', () => {
  it('one extractExamPage call per page, advancing lastCompletedPage by exactly one page per call', async () => {
    const extractExamPage = vi.fn().mockResolvedValue({ data: [draft()], usage: usage(), droppedItems: 0 });
    const aiService = { extractExamPage } as unknown as AiServicePort;
    const { sessions } = fakeSessionRepository();
    const service = new ExamExtractionService(aiService, sessions, fakeRetrieval());

    const pages = [
      { pageNumber: 1, text: 'a genuine exam question about topic '.repeat(10) },
      { pageNumber: 2, text: 'another genuine exam question '.repeat(10) },
    ];
    const session = fakeSession();
    await withTenant(() => service.generate(session, pages));

    expect(extractExamPage).toHaveBeenCalledTimes(2);
    expect(session.lastCompletedPage).toBe(2);
  });

  it('skips a page with < 20 chars of text without ever calling the engine (cost-control), but still advances the watermark durably', async () => {
    const extractExamPage = vi.fn().mockResolvedValue({ data: [draft()], usage: usage(), droppedItems: 0 });
    const aiService = { extractExamPage } as unknown as AiServicePort;
    const { sessions, persistBatchAndAdvanceWatermark } = fakeSessionRepository();
    const service = new ExamExtractionService(aiService, sessions, fakeRetrieval());

    const pages = [
      { pageNumber: 1, text: 'too short' }, // < 20 chars
      { pageNumber: 2, text: 'a genuine exam question about topic '.repeat(10) },
    ];
    const session = fakeSession();
    await withTenant(() => service.generate(session, pages));

    expect(extractExamPage).toHaveBeenCalledTimes(1);
    expect(extractExamPage).toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 2 }), expect.anything());
    expect(session.lastCompletedPage).toBe(2);
    expect(persistBatchAndAdvanceWatermark).toHaveBeenCalledTimes(2);
    expect(persistBatchAndAdvanceWatermark.mock.calls[0][0]).toEqual(expect.objectContaining({ endPage: 1, entities: [] }));
    expect(persistBatchAndAdvanceWatermark.mock.calls[1][0]).toEqual(expect.objectContaining({ endPage: 2 }));
  });

  it('persists provided vs inferred answerSource distinction as a real queryable column, not folded into one score', async () => {
    const extractExamPage = vi.fn().mockResolvedValue({
      data: [draft({ answerSource: 'provided', modelConfidence: 0.99 }), draft({ answerSource: 'inferred', groundingStrength: 'strong' })],
      usage: usage(),
      droppedItems: 0,
    });
    const aiService = { extractExamPage } as unknown as AiServicePort;
    const { sessions, persistBatchAndAdvanceWatermark } = fakeSessionRepository();
    const service = new ExamExtractionService(aiService, sessions, fakeRetrieval());

    const session = fakeSession();
    await withTenant(() => service.generate(session, [{ pageNumber: 1, text: 'a genuine exam page '.repeat(10) }]));

    const rows = persistBatchAndAdvanceWatermark.mock.calls[0][0].entities;
    expect(rows[0].answerSource).toBe('provided');
    expect(rows[0].confidenceScore).toBeGreaterThanOrEqual(0.95);
    expect(rows[0].generationMethod).toBe('exam_extraction_with_key');
    expect(rows[1].answerSource).toBe('inferred');
    expect(rows[1].confidenceScore).toBeLessThan(0.95);
    expect(rows[1].generationMethod).toBe('exam_extraction_inferred');
  });

  it('per-item parse-failure isolation: persists every surviving draft even when droppedItems > 0', async () => {
    const extractExamPage = vi.fn().mockResolvedValue({
      data: [draft({ concept: 'a' }), draft({ concept: 'b' })],
      usage: usage(),
      droppedItems: 1,
    });
    const aiService = { extractExamPage } as unknown as AiServicePort;
    const { sessions, persistBatchAndAdvanceWatermark } = fakeSessionRepository();
    const service = new ExamExtractionService(aiService, sessions, fakeRetrieval());

    const session = fakeSession();
    await withTenant(() => service.generate(session, [{ pageNumber: 1, text: 'a genuine exam page '.repeat(10) }]));

    expect(persistBatchAndAdvanceWatermark.mock.calls[0][0].entities).toHaveLength(2);
  });

  it('budget check runs BEFORE each page call: a session already exhausted before the first page never calls extractExamPage', async () => {
    const extractExamPage = vi.fn();
    const aiService = { extractExamPage } as unknown as AiServicePort;
    const { sessions } = fakeSessionRepository();
    const service = new ExamExtractionService(aiService, sessions, fakeRetrieval());

    // Default env PDF_MAX_TOKENS_PER_SESSION is 400000 — a huge tokensUsed guarantees exhaustion
    // without needing to mock env for this specific test.
    const session = fakeSession({ tokensUsed: 400_000 });
    await withTenant(() => service.generate(session, [{ pageNumber: 1, text: 'a genuine exam page '.repeat(10) }]));

    expect(extractExamPage).not.toHaveBeenCalled();
    expect(session.budgetExhausted).toBe(true);
  });

  it('resumes from lastCompletedPage: pages at or before the watermark are never re-sent', async () => {
    const extractExamPage = vi.fn().mockResolvedValue({ data: [draft()], usage: usage(), droppedItems: 0 });
    const aiService = { extractExamPage } as unknown as AiServicePort;
    const { sessions } = fakeSessionRepository();
    const service = new ExamExtractionService(aiService, sessions, fakeRetrieval());

    const pages = [
      { pageNumber: 1, text: 'a genuine exam page '.repeat(10) },
      { pageNumber: 2, text: 'a genuine exam page '.repeat(10) },
    ];
    const session = fakeSession({ lastCompletedPage: 1 });
    await withTenant(() => service.generate(session, pages));

    expect(extractExamPage).toHaveBeenCalledTimes(1);
    expect(extractExamPage).toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 2 }), expect.anything());
  });

  it("propagates AiServiceUnavailableError without persisting that page's watermark advance (resumable, not silently absorbed)", async () => {
    const extractExamPage = vi.fn().mockRejectedValue(new AiServiceUnavailableError());
    const aiService = { extractExamPage } as unknown as AiServicePort;
    const { sessions } = fakeSessionRepository();
    const service = new ExamExtractionService(aiService, sessions, fakeRetrieval());

    const session = fakeSession();
    await expect(
      withTenant(() => service.generate(session, [{ pageNumber: 1, text: 'a genuine exam page '.repeat(10) }])),
    ).rejects.toBeInstanceOf(AiServiceUnavailableError);
    expect(session.lastCompletedPage).toBe(0);
  });

  it('commits rows AND advances the watermark atomically via persistBatchAndAdvanceWatermark, once per page (never once at the end of the whole loop)', async () => {
    const extractExamPage = vi.fn().mockResolvedValue({ data: [draft()], usage: usage(), droppedItems: 0 });
    const aiService = { extractExamPage } as unknown as AiServicePort;
    const { sessions, persistBatchAndAdvanceWatermark } = fakeSessionRepository();
    const service = new ExamExtractionService(aiService, sessions, fakeRetrieval());

    const pages = Array.from({ length: 3 }, (_, i) => ({ pageNumber: i + 1, text: 'a genuine exam page '.repeat(10) }));
    const session = fakeSession();
    await withTenant(() => service.generate(session, pages));

    expect(persistBatchAndAdvanceWatermark).toHaveBeenCalledTimes(3);
    expect(persistBatchAndAdvanceWatermark.mock.calls.map((call) => call[0].endPage)).toEqual([1, 2, 3]);
  });

  it("resolves real grounding via RetrievalService (explicit TenantScope, topK 12, scoped to the session's own curriculumId) and forwards the retrieved chunks on the extractExamPage request", async () => {
    const extractExamPage = vi.fn().mockResolvedValue({ data: [draft()], usage: usage(), droppedItems: 0 });
    const aiService = { extractExamPage } as unknown as AiServicePort;
    const { sessions } = fakeSessionRepository();
    const chunks = [{ text: 'grounded excerpt', fileName: 'answer-key.pdf', pageNumber: 9, score: 0.77 }];
    const retrieve = vi.fn().mockResolvedValue(chunks);
    const retrieval = { retrieve } as unknown as RetrievalService;
    const service = new ExamExtractionService(aiService, sessions, retrieval);

    const session = fakeSession({ curriculumId: 'curr-9' });
    await withTenant(() => service.generate(session, [{ pageNumber: 1, text: 'a genuine exam page '.repeat(10) }]));

    expect(retrieve).toHaveBeenCalledWith({ tenantId: 'tenant-1' }, { curriculumId: 'curr-9' }, expect.any(String), 12);
    expect(extractExamPage).toHaveBeenCalledWith(expect.objectContaining({ grounding: chunks }), expect.anything());
  });
});
