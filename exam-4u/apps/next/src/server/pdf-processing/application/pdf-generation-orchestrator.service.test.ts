import { describe, expect, it, vi } from 'vitest';
import { PdfProcessingSessionEntity } from '@/server/infrastructure/database';
import { PdfGenerationOrchestrator } from './pdf-generation-orchestrator.service';
import type { PdfContentStrategy } from '../domain/content-type-strategy';
import type { GeneratedQuestionRepository } from '../infrastructure/generated-question.repository';
import type { PdfProcessingSessionRepository } from '../infrastructure/pdf-processing-session.repository';

function fakeSession(overrides: Partial<PdfProcessingSessionEntity> = {}): PdfProcessingSessionEntity {
  return Object.assign(new PdfProcessingSessionEntity(), { id: 'sess-1', initiatedByUserId: 'user-1', status: 'Processing', ...overrides });
}

describe('PdfGenerationOrchestrator (sub-slice "6a" dispatch)', () => {
  it('Exam: runs the registered Exam strategy and marks the session Completed with the real question count', async () => {
    const examRun = vi.fn().mockResolvedValue(undefined);
    const save = vi.fn().mockResolvedValue(undefined);
    const strategies: PdfContentStrategy[] = [{ contentType: 'Exam', run: examRun }];
    const orchestrator = new PdfGenerationOrchestrator(
      strategies,
      { countForSession: vi.fn().mockResolvedValue(5) } as unknown as GeneratedQuestionRepository,
      { save } as unknown as PdfProcessingSessionRepository,
    );

    const session = fakeSession({ contentType: 'Exam' });
    await orchestrator.process(session, []);

    expect(examRun).toHaveBeenCalledTimes(1);
    expect(session.status).toBe('Completed');
    expect(session.totalQuestions).toBe(5);
    expect(session.successfulQuestions).toBe(5);
    expect(session.completedAt).toBeInstanceOf(Date);
    expect(save).toHaveBeenCalledWith(session);
  });

  it('a content type with no registered strategy (Lesson/Reference, sub-slice 6b) still reaches Completed with zero questions — a valid, documented outcome, not an error', async () => {
    const strategies: PdfContentStrategy[] = [{ contentType: 'Exam', run: vi.fn() }];
    const orchestrator = new PdfGenerationOrchestrator(
      strategies,
      { countForSession: vi.fn().mockResolvedValue(0) } as unknown as GeneratedQuestionRepository,
      { save: vi.fn().mockResolvedValue(undefined) } as unknown as PdfProcessingSessionRepository,
    );

    const session = fakeSession({ contentType: 'Lesson' });
    await expect(orchestrator.process(session, [])).resolves.toBeUndefined();
    expect(session.status).toBe('Completed');
    expect(session.successfulQuestions).toBe(0);
  });

  it('a budget-exhausted Exam session still completes gracefully (never Failed) with the partial output already generated', async () => {
    const examRun = vi.fn().mockImplementation(async (s: PdfProcessingSessionEntity) => {
      s.budgetExhausted = true; // simulates ExamExtractionService breaking out of its loop early
    });
    const strategies: PdfContentStrategy[] = [{ contentType: 'Exam', run: examRun }];
    const orchestrator = new PdfGenerationOrchestrator(
      strategies,
      { countForSession: vi.fn().mockResolvedValue(2) } as unknown as GeneratedQuestionRepository,
      { save: vi.fn().mockResolvedValue(undefined) } as unknown as PdfProcessingSessionRepository,
    );

    const session = fakeSession({ contentType: 'Exam' });
    await orchestrator.process(session, []);

    expect(session.status).toBe('Completed');
    expect(session.status).not.toBe('Failed');
    expect(session.budgetExhausted).toBe(true);
    expect(session.successfulQuestions).toBe(2);
  });

  it('propagates an AiDisabledError/AiServiceUnavailableError thrown by a strategy uncaught, for the caller (PdfProcessingService) to handle gracefully', async () => {
    class FakeAiUnavailable extends Error {}
    const examRun = vi.fn().mockRejectedValue(new FakeAiUnavailable('engine down'));
    const strategies: PdfContentStrategy[] = [{ contentType: 'Exam', run: examRun }];
    const save = vi.fn().mockResolvedValue(undefined);
    const orchestrator = new PdfGenerationOrchestrator(
      strategies,
      { countForSession: vi.fn() } as unknown as GeneratedQuestionRepository,
      { save } as unknown as PdfProcessingSessionRepository,
    );

    const session = fakeSession({ contentType: 'Exam' });
    await expect(orchestrator.process(session, [])).rejects.toThrow(FakeAiUnavailable);
    // Never reached the terminal-status save — the outer catch in PdfProcessingService owns recording
    // the outage, not this orchestrator.
    expect(save).not.toHaveBeenCalled();
  });
});
