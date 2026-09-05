import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { runWithRequestContext } from '@/server/context';
import { NotCurriculumOwnerError, SubjectNotFoundError } from '@/server/curricula';
import { LessonPracticeService } from './lesson-practice.service';
import { EmptyQuestionBankError, InvalidQuestionCountError } from '../domain/errors';

const TENANT_ID = 't-1';
const USER_ID = 'u-1';

function withScope<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ requestId: randomUUID(), tenantId: TENANT_ID, userId: USER_ID }, fn);
}

function bankQuestion(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    questionText: 'Q',
    optionsJson: { A: 'a', B: 'b' },
    correctAnswer: 'A',
    explanation: null,
    confidenceScore: 0.9,
    ...overrides,
  };
}

function makeService(overrides: {
  bank?: unknown[];
  subject?: unknown;
  document?: unknown;
  curriculum?: unknown;
  hasOversight?: boolean;
  aiAvailable?: boolean;
  aiDraft?: unknown;
} = {}) {
  const aiService = {
    available: overrides.aiAvailable ?? false,
    promptPractice: vi.fn().mockResolvedValue({
      data: overrides.aiDraft !== undefined ? overrides.aiDraft : [],
      usage: { model: 'm', promptTokens: 1, completionTokens: 1, costUsd: 0, costUnavailable: false, latencyMs: 1, attempts: 1 },
      droppedItems: 0,
    }),
  };
  const retrieval = { retrieve: vi.fn().mockResolvedValue([]) };
  const embeddings = { embed: vi.fn().mockResolvedValue([[1, 0]]) };
  const generatedQuestions = {
    findPackagedForDocument: vi.fn().mockResolvedValue(overrides.bank ?? [bankQuestion()]),
    findPackagedForSubject: vi.fn().mockResolvedValue(overrides.bank ?? [bankQuestion()]),
    findPackagedForCurriculum: vi.fn().mockResolvedValue(overrides.bank ?? [bankQuestion()]),
  };
  const curricula = {
    findDocumentById: vi.fn().mockResolvedValue(overrides.document === undefined ? { id: 'doc-1', curriculumId: 'c-1' } : overrides.document),
    findById: vi.fn().mockResolvedValue(overrides.curriculum === undefined ? { id: 'c-1', ownerUserId: USER_ID, subjectId: 1 } : overrides.curriculum),
  };
  const subjects = {
    findById: vi.fn().mockResolvedValue(overrides.subject === undefined ? { id: 1, stageId: 1, name: 'Math' } : overrides.subject),
  };
  const practiceSessions = {
    createSession: vi.fn().mockResolvedValue({ id: 'session-1' }),
    findQuestionsForSession: vi.fn().mockResolvedValue([]),
    findById: vi.fn(),
    findQuestionByPosition: vi.fn(),
    recordAnswer: vi.fn(),
  };
  const permissions = { hasPermission: vi.fn().mockResolvedValue(overrides.hasOversight ?? false) };

  const service = new LessonPracticeService(
    aiService as never,
    retrieval as never,
    embeddings as never,
    generatedQuestions as never,
    curricula as never,
    subjects as never,
    practiceSessions as never,
    permissions as never,
  );
  return { service, aiService, retrieval, embeddings, generatedQuestions, curricula, subjects, practiceSessions, permissions };
}

describe('LessonPracticeService.generate (FR-CUR-6)', () => {
  it('throws InvalidQuestionCountError outside [1,30]', async () => {
    const { service } = makeService();
    await withScope(() => expect(service.generate({ stageId: 1, subjectId: 1, count: 0 })).rejects.toThrow(InvalidQuestionCountError));
  });

  it('throws SubjectNotFoundError when the subject belongs to a different stage', async () => {
    const { service } = makeService({ subject: { id: 1, stageId: 99, name: 'Math' } });
    await withScope(() => expect(service.generate({ stageId: 1, subjectId: 1, count: 5 })).rejects.toThrow(SubjectNotFoundError));
  });

  it('throws EmptyQuestionBankError before any embedding/AI call when the resolved bank is empty', async () => {
    const { service, embeddings, aiService } = makeService({ bank: [] });
    await withScope(() => expect(service.generate({ stageId: 1, subjectId: 1, count: 5 })).rejects.toThrow(EmptyQuestionBankError));
    expect(embeddings.embed).not.toHaveBeenCalled();
    expect(aiService.promptPractice).not.toHaveBeenCalled();
  });

  it('throws NotCurriculumOwnerError for a document-scoped request against a Curriculum owned by another user, unless the caller holds the oversight permission', async () => {
    const { service } = makeService({ curriculum: { id: 'c-1', ownerUserId: 'someone-else', subjectId: 1 } });
    await withScope(() =>
      expect(service.generate({ stageId: 1, subjectId: 1, documentId: 'doc-1', count: 1 })).rejects.toThrow(NotCurriculumOwnerError),
    );
  });

  it('allows a document-scoped request against another user\'s Curriculum when the caller holds curricula.read_all', async () => {
    const { service } = makeService({ curriculum: { id: 'c-1', ownerUserId: 'someone-else', subjectId: 1 }, hasOversight: true });
    const result = await withScope(() => service.generate({ stageId: 1, subjectId: 1, documentId: 'doc-1', count: 1 }));
    expect(result.status).toBe('completed');
  });

  it('document scope takes precedence over curriculumId when both are sent', async () => {
    const { service, generatedQuestions } = makeService();
    await withScope(() => service.generate({ stageId: 1, subjectId: 1, documentId: 'doc-1', curriculumId: 'c-2', count: 1 }));
    expect(generatedQuestions.findPackagedForDocument).toHaveBeenCalledWith('doc-1');
    expect(generatedQuestions.findPackagedForCurriculum).not.toHaveBeenCalled();
  });

  it('document-scoped selection truncates the confidence-ordered bank by count rather than diversity-selecting', async () => {
    const { service, embeddings, practiceSessions } = makeService({ bank: [bankQuestion(), bankQuestion()] });
    await withScope(() => service.generate({ stageId: 1, subjectId: 1, documentId: 'doc-1', count: 1 }));
    expect(embeddings.embed).not.toHaveBeenCalled();
    const [, questions] = practiceSessions.createSession.mock.calls[0];
    expect(questions).toHaveLength(1);
  });

  it('subject-scoped selection diversity-selects via the embeddings port', async () => {
    const { service, embeddings } = makeService({ bank: [bankQuestion(), bankQuestion()] });
    await withScope(() => service.generate({ stageId: 1, subjectId: 1, count: 1 }));
    expect(embeddings.embed).toHaveBeenCalled();
  });

  it('curriculum-scoped multi-document-synthesis queries findPackagedForCurriculum, not findPackagedForDocument/Subject', async () => {
    const { service, generatedQuestions } = makeService({ bank: [bankQuestion()] });
    await withScope(() => service.generate({ stageId: 1, subjectId: 1, curriculumId: 'c-1', count: 1 }));
    expect(generatedQuestions.findPackagedForCurriculum).toHaveBeenCalledWith('c-1');
    expect(generatedQuestions.findPackagedForDocument).not.toHaveBeenCalled();
    expect(generatedQuestions.findPackagedForSubject).not.toHaveBeenCalled();
  });

  it('throws CurriculumNotFoundError for a curriculum-scoped request whose curriculum does not match the request subject', async () => {
    const { service } = makeService({ curriculum: { id: 'c-1', ownerUserId: USER_ID, subjectId: 999 } });
    await withScope(async () => {
      try {
        await service.generate({ stageId: 1, subjectId: 1, curriculumId: 'c-1', count: 1 });
        throw new Error('expected to throw');
      } catch (err) {
        expect((err as { code: string }).code).toBe('CURRICULUM_NOT_FOUND');
      }
    });
  });

  it('fills a bank shortfall via AiServicePort.promptPractice when the AI service is available, persisting Generated-source questions alongside Bank ones', async () => {
    const draft = { questionText: 'gen', options: [{ key: 'A', text: 'a' }], correctAnswer: 'A', explanation: 'e', bloomsLevel: 2, concept: 'x' };
    const { service, aiService, practiceSessions } = makeService({ bank: [bankQuestion()], aiAvailable: true, aiDraft: [draft] });
    await withScope(() => service.generate({ stageId: 1, subjectId: 1, count: 2 }));
    expect(aiService.promptPractice).toHaveBeenCalled();
    const [sessionInput, questions] = practiceSessions.createSession.mock.calls[0];
    expect(sessionInput.generatedNew).toBe(1);
    expect(questions.some((q: { source: string }) => q.source === 'Generated')).toBe(true);
  });

  it('does not attempt shortfall-fill generation when the AI service is unavailable, even with a shortfall', async () => {
    const { service, aiService, practiceSessions } = makeService({ bank: [bankQuestion()], aiAvailable: false });
    await withScope(() => service.generate({ stageId: 1, subjectId: 1, count: 5 }));
    expect(aiService.promptPractice).not.toHaveBeenCalled();
    const [sessionInput] = practiceSessions.createSession.mock.calls[0];
    expect(sessionInput.generatedNew).toBe(0);
  });

  it('getSession returns the persisted question set for the owning user', async () => {
    const { service, practiceSessions } = makeService();
    practiceSessions.findById.mockResolvedValue({ id: 's-1', userId: USER_ID });
    practiceSessions.findQuestionsForSession.mockResolvedValue([
      { position: 0, questionText: 'Q', optionsJson: { A: 'a' }, correctAnswer: 'A', explanation: null, selectedOption: null, isCorrect: null },
    ]);
    const result = await withScope(() => service.getSession('s-1'));
    expect(result.questions).toHaveLength(1);
  });

  it('getSession throws NotPracticeSessionOwnerError for a session owned by a different user', async () => {
    const { service, practiceSessions } = makeService();
    practiceSessions.findById.mockResolvedValue({ id: 's-1', userId: 'someone-else' });
    await withScope(async () => {
      try {
        await service.getSession('s-1');
        throw new Error('expected to throw');
      } catch (err) {
        expect((err as { code: string }).code).toBe('NOT_SESSION_OWNER');
      }
    });
  });

  it('getSession throws PracticeSessionNotFoundError for an unknown session id', async () => {
    const { service, practiceSessions } = makeService();
    practiceSessions.findById.mockResolvedValue(null);
    await withScope(async () => {
      try {
        await service.getSession('missing');
        throw new Error('expected to throw');
      } catch (err) {
        expect((err as { code: string }).code).toBe('SESSION_NOT_FOUND');
      }
    });
  });

  it('answer records the answer and returns the updated question, correctly evaluating isCorrect', async () => {
    const { service, practiceSessions } = makeService();
    practiceSessions.findById.mockResolvedValue({ id: 's-1', userId: USER_ID });
    practiceSessions.findQuestionByPosition.mockResolvedValue({
      id: 'q-1',
      position: 0,
      questionText: 'Q',
      optionsJson: { A: 'a', B: 'b' },
      correctAnswer: 'A',
      explanation: null,
      selectedOption: null,
      isCorrect: null,
    });
    const result = await withScope(() => service.answer('s-1', 0, 'B'));
    expect(practiceSessions.recordAnswer).toHaveBeenCalledWith('q-1', 'B', false);
    expect(result.isCorrect).toBe(false);
  });

  it('answer throws PracticeQuestionNotFoundError for an unknown position', async () => {
    const { service, practiceSessions } = makeService();
    practiceSessions.findById.mockResolvedValue({ id: 's-1', userId: USER_ID });
    practiceSessions.findQuestionByPosition.mockResolvedValue(null);
    await withScope(async () => {
      try {
        await service.answer('s-1', 99, 'A');
        throw new Error('expected to throw');
      } catch (err) {
        expect((err as { code: string }).code).toBe('QUESTION_NOT_FOUND');
      }
    });
  });
});
