import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { runWithRequestContext } from '@/server/context';
import { PdfProcessingSessionNotFoundError } from '@/server/pdf-processing';
import { DocumentNotFoundError } from '@/server/curricula';
import { AiDisabledError } from '@/server/ai';

vi.mock('@/server/infrastructure/text-extraction', () => ({
  extractPdfPages: vi.fn().mockResolvedValue([{ pageNumber: 1, text: 'Some real page text content for planning.' }]),
}));
vi.mock('@/server/files', () => ({
  getStoragePortSingleton: () => ({ getStream: vi.fn().mockResolvedValue({ stream: Readable.from([Buffer.from('pdf-bytes')]) }) }),
}));

import { FullBankAssessmentService } from './full-bank-assessment.service';

const TENANT_ID = 't-1';
const USER_ID = 'u-1';

function withScope<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ requestId: randomUUID(), tenantId: TENANT_ID, userId: USER_ID }, fn);
}

function makeService(overrides: { document?: unknown; session?: unknown } = {}) {
  const sessions = {
    insert: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue(overrides.session),
    save: vi.fn(),
  };
  const generatedQuestions = {
    findAllForSession: vi.fn().mockResolvedValue([{ bloomsLevel: 1 }, { bloomsLevel: 4 }, { bloomsLevel: 6 }]),
    countForSession: vi.fn().mockResolvedValue(0),
  };
  const curricula = {
    findDocumentById: vi.fn().mockResolvedValue(
      overrides.document === undefined
        ? { id: 'doc-1', curriculumId: 'c-1', fileName: 'a.pdf', storageKey: 'k', fileHash: 'h', pageCount: 5 }
        : overrides.document,
    ),
    findById: vi.fn().mockResolvedValue({ id: 'c-1', subjectId: 1 }),
  };
  const aiService = { available: false };
  const retrieval = { retrieve: vi.fn() };
  const service = new FullBankAssessmentService(sessions as never, generatedQuestions as never, curricula as never, aiService as never, retrieval as never);
  return { service, sessions, generatedQuestions, curricula };
}

describe('FullBankAssessmentService (FR-PDF-13)', () => {
  it('start throws DocumentNotFoundError for a document that does not belong to the named curriculum', async () => {
    const { service } = makeService({ document: { id: 'doc-1', curriculumId: 'other-curriculum' } });
    await withScope(() => expect(service.start('c-1', 'doc-1', {})).rejects.toThrow(DocumentNotFoundError));
  });

  it('start throws DocumentNotFoundError when the document does not exist at all', async () => {
    const { service } = makeService({ document: null });
    await withScope(() => expect(service.start('c-1', 'doc-1', {})).rejects.toThrow(DocumentNotFoundError));
  });

  it('start inserts a session with the configured default target shape when the request omits both fields', async () => {
    const { service, sessions } = makeService();
    const result = await withScope(() => service.start('c-1', 'doc-1', {}));
    expect(result.status).toBe('Processing');
    const inserted = sessions.insert.mock.calls[0][0];
    expect(inserted.sessionKind).toBe('full_bank_assessment');
    expect(inserted.targetQuestionCount).toBeGreaterThan(0);
    expect(inserted.targetTotalMinutes).toBeGreaterThan(0);
    expect(inserted.curriculumDocumentId).toBe('doc-1');
  });

  it('start honors an explicit targetQuestionCount/targetTotalMinutes override', async () => {
    const { service, sessions } = makeService();
    await withScope(() => service.start('c-1', 'doc-1', { targetQuestionCount: 15, targetTotalMinutes: 20 }));
    const inserted = sessions.insert.mock.calls[0][0];
    expect(inserted.targetQuestionCount).toBe(15);
    expect(inserted.targetTotalMinutes).toBe(20);
  });

  it('getSummary throws PdfProcessingSessionNotFoundError for an unknown session id', async () => {
    const { service } = makeService({ session: null });
    await withScope(() => expect(service.getSummary('missing')).rejects.toThrow(PdfProcessingSessionNotFoundError));
  });

  it('getSummary derives the difficulty breakdown from each question\'s own blooms level', async () => {
    const { service } = makeService({
      session: {
        id: 's-1',
        status: 'Completed',
        curriculumId: 'c-1',
        curriculumDocumentId: 'doc-1',
        targetQuestionCount: 3,
        targetTotalMinutes: 30,
        lastCompletedPage: 5,
        pageCount: 5,
        tokensUsed: 100,
        totalCost: 0.5,
        budgetExhausted: false,
        errorCode: null,
        errorMessage: null,
        createdAt: new Date(),
        completedAt: new Date(),
      },
    });
    const summary = await withScope(() => service.getSummary('s-1'));
    expect(summary.difficultyBreakdown).toEqual({ Easy: 1, Medium: 1, Hard: 1 });
    expect(summary.isComplete).toBe(true);
  });

  it('processSession is a no-op for an already-terminal session', async () => {
    const { service, sessions } = makeService({ session: { id: 's-1', status: 'Completed' } });
    await service.processSession('s-1');
    expect(sessions.save).not.toHaveBeenCalled();
  });

  it('processSession is a no-op (returns silently) when the session id does not exist', async () => {
    const { service, sessions } = makeService({ session: null });
    await expect(service.processSession('missing')).resolves.toBeUndefined();
    expect(sessions.save).not.toHaveBeenCalled();
  });

  it('processSession completes a fixed-shape run: extracts the source PDF, plans+persists batches, and marks the session Completed', async () => {
    const inProgress = {
      id: 's-1',
      status: 'Processing',
      sourceStorageKey: 'k',
      pageCount: null,
      lastCompletedPage: 0,
      tokensUsed: 0,
      totalCost: 0,
      coveredConcepts: null,
      curriculumId: 'c-1',
      targetQuestionCount: 5,
      initiatedByUserId: null,
    };
    const sessions = {
      insert: vi.fn(),
      findById: vi.fn().mockResolvedValue(inProgress),
      save: vi.fn(),
      persistBatchAndAdvanceWatermark: vi.fn().mockResolvedValue(undefined),
    };
    const generatedQuestions = { findAllForSession: vi.fn(), countForSession: vi.fn().mockResolvedValue(0) };
    const curricula = { findDocumentById: vi.fn(), findById: vi.fn() };
    const draft = { questionText: 'gen', options: [{ key: 'A', text: 'a' }], correctAnswer: 'A', explanation: 'e', bloomsLevel: 3, concept: 'x' };
    const aiService = {
      available: true,
      generateLessonBatch: vi.fn().mockResolvedValue({
        data: [draft],
        usage: { model: 'm', promptTokens: 10, completionTokens: 5, costUsd: 0.01, costUnavailable: false, latencyMs: 1, attempts: 1 },
        droppedItems: 0,
      }),
    };
    const retrieval = { retrieve: vi.fn().mockResolvedValue([]) };
    const service = new FullBankAssessmentService(sessions as never, generatedQuestions as never, curricula as never, aiService as never, retrieval as never);

    generatedQuestions.countForSession.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    await withScope(() => service.processSession('s-1'));

    expect(aiService.generateLessonBatch).toHaveBeenCalled();
    expect(sessions.persistBatchAndAdvanceWatermark).toHaveBeenCalled();
    const finalSave = sessions.save.mock.calls.at(-1)![0];
    expect(finalSave.status).toBe('Completed');
  });

  it('processSession leaves the session in Processing (not Failed) and records the error code when the AI service is disabled', async () => {
    const inProgress = {
      id: 's-1',
      status: 'Processing',
      sourceStorageKey: 'k',
      pageCount: null,
      lastCompletedPage: 0,
      tokensUsed: 0,
      totalCost: 0,
      coveredConcepts: null,
      curriculumId: 'c-1',
      targetQuestionCount: 5,
      initiatedByUserId: null,
    };
    const sessions = { insert: vi.fn(), findById: vi.fn().mockResolvedValue(inProgress), save: vi.fn().mockResolvedValue(undefined), persistBatchAndAdvanceWatermark: vi.fn() };
    const generatedQuestions = { findAllForSession: vi.fn(), countForSession: vi.fn().mockResolvedValue(0) };
    const curricula = { findDocumentById: vi.fn(), findById: vi.fn() };
    const aiService = {
      available: false,
      generateLessonBatch: vi.fn().mockRejectedValue(new AiDisabledError()),
    };
    const retrieval = { retrieve: vi.fn().mockResolvedValue([]) };
    const service = new FullBankAssessmentService(sessions as never, generatedQuestions as never, curricula as never, aiService as never, retrieval as never);

    await withScope(() => service.processSession('s-1'));

    const finalSave = sessions.save.mock.calls.at(-1)![0];
    expect(finalSave.status).toBe('Processing');
    expect(finalSave.errorCode).toBe('AI_DISABLED');
  });
});
