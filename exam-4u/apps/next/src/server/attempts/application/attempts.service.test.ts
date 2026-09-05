import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryFailedError } from 'typeorm';
import { runWithRequestContext } from '@/server/context';
import { AttemptsService } from './attempts.service';
import {
  AttemptAlreadyInProgressError,
  AttemptExamTypeNotFoundError,
  AttemptNotFoundError,
  AttemptNotInProgressError,
  AttemptQuestionNotFoundError,
  InsufficientQuestionBankError,
  NotAttemptOwnerError,
} from '../domain/errors';
import type { AttemptEntity, AttemptQuestionEntity, ExamTypeEntity, ExamModuleEntity, ExamTypeQuestionEntity } from '@/server/infrastructure/database';

const TENANT_ID = 't-1';
const USER_ID = 'u-1';
const OTHER_USER_ID = 'u-2';

function withUserScope<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ requestId: randomUUID(), tenantId: TENANT_ID, userId }, fn);
}

function examType(overrides: Partial<ExamTypeEntity> = {}): ExamTypeEntity {
  return {
    id: 'exam-1',
    name: 'Grade 10 Math',
    description: null,
    totalQuestions: 2,
    totalMinutes: 30,
    storagePath: null,
    stageId: null,
    storageMode: 'LocalDisk',
    kind: 'Standard',
    origin: 'ZipImport',
    createdByUserId: null,
    pendingDeleteAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  } as ExamTypeEntity;
}

function examModule(overrides: Partial<ExamModuleEntity> = {}): ExamModuleEntity {
  return { id: 'm-1', examTypeId: 'exam-1', moduleName: 'Algebra', questionCount: 2, ...overrides } as ExamModuleEntity;
}

function examTypeQuestion(overrides: Partial<ExamTypeQuestionEntity> = {}): ExamTypeQuestionEntity {
  return {
    id: randomUUID(),
    examTypeId: 'exam-1',
    moduleName: 'Algebra',
    questionKey: randomUUID(),
    questionText: 'What is 2+2?',
    optionsJson: { A: '3', B: '4' },
    correctAnswer: 'B',
    explanation: null,
    sourceGeneratedQuestionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ExamTypeQuestionEntity;
}

function attemptEntity(overrides: Partial<AttemptEntity> = {}): AttemptEntity {
  return {
    id: 'attempt-1',
    userId: USER_ID,
    examTypeId: 'exam-1',
    startTime: new Date(),
    deadlineAt: new Date(Date.now() + 60_000),
    endTime: null,
    status: 'InProgress',
    totalQuestions: 2,
    answeredCount: 0,
    correctCount: 0,
    wrongCount: 0,
    scorePercent: null,
    createdAt: new Date(),
    ...overrides,
  } as AttemptEntity;
}

function attemptQuestion(overrides: Partial<AttemptQuestionEntity> = {}): AttemptQuestionEntity {
  return {
    id: randomUUID(),
    attemptId: 'attempt-1',
    questionIndex: 0,
    subjectName: null,
    questionKey: 'k-1',
    sourceGeneratedQuestionId: null,
    questionText: 'Q?',
    optionsJson: { A: 'x', B: 'y' },
    correctAnswer: 'A',
    selectedOption: null,
    isCorrect: null,
    explanation: null,
    answeredAt: null,
    ...overrides,
  } as AttemptQuestionEntity;
}

function buildRepo(overrides: Record<string, unknown> = {}) {
  return {
    findAllExamTypes: vi.fn().mockResolvedValue([]),
    findExamTypeById: vi.fn().mockResolvedValue(examType()),
    findModules: vi.fn().mockResolvedValue([examModule()]),
    findQuestionsByModule: vi.fn().mockResolvedValue([examTypeQuestion(), examTypeQuestion()]),
    findAnswerHistory: vi.fn().mockResolvedValue(new Map()),
    findActiveAttempt: vi.fn().mockResolvedValue(null),
    insertAttempt: vi.fn().mockResolvedValue(undefined),
    findAttemptById: vi.fn().mockResolvedValue(attemptEntity()),
    findQuestionByIndex: vi.fn().mockResolvedValue(attemptQuestion()),
    saveAnswer: vi.fn().mockResolvedValue(undefined),
    closeAndScore: vi.fn().mockResolvedValue({ status: 'Submitted', answeredCount: 1, correctCount: 1, wrongCount: 0, scorePercent: 100 }),
    findQuestionsForAttempt: vi.fn().mockResolvedValue([attemptQuestion()]),
    findHistory: vi.fn().mockResolvedValue([]),
    findTimedOutCandidateIds: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function buildPermissions(hasOversight = false) {
  return { hasPermission: vi.fn().mockResolvedValue(hasOversight) };
}

function buildImageAssociation() {
  return { listImagesForQuestions: vi.fn().mockResolvedValue(new Map()) };
}

describe('AttemptsService.startAttempt', () => {
  it('generates a fresh attempt with the correct deadline and returns the first question', async () => {
    const repo = buildRepo();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);

    const result = await withUserScope(USER_ID, () => service.startAttempt('exam-1'));

    expect(result.examTypeId).toBe('exam-1');
    expect(result.totalQuestions).toBe(2);
    expect(result.deadlineAt.getTime() - result.startTime.getTime()).toBe(30 * 60_000);
    expect(repo.insertAttempt).toHaveBeenCalledOnce();
  });

  it('throws AttemptExamTypeNotFoundError for an unknown Exam Type', async () => {
    const repo = buildRepo({ findExamTypeById: vi.fn().mockResolvedValue(null) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    await expect(withUserScope(USER_ID, () => service.startAttempt('missing'))).rejects.toThrow(AttemptExamTypeNotFoundError);
  });

  it('throws AttemptAlreadyInProgressError when an InProgress attempt already exists and has not expired', async () => {
    const existing = attemptEntity({ deadlineAt: new Date(Date.now() + 60_000) });
    const repo = buildRepo({ findActiveAttempt: vi.fn().mockResolvedValue(existing) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    await expect(withUserScope(USER_ID, () => service.startAttempt('exam-1'))).rejects.toThrow(AttemptAlreadyInProgressError);
    expect(repo.insertAttempt).not.toHaveBeenCalled();
  });

  it('falls through to generate a new attempt when the existing one has already expired (lazy timeout)', async () => {
    const expired = attemptEntity({ deadlineAt: new Date(Date.now() - 1000) });
    const repo = buildRepo({
      findActiveAttempt: vi.fn().mockResolvedValue(expired),
      findAttemptById: vi.fn().mockResolvedValue(attemptEntity({ status: 'TimedOut' })),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    const result = await withUserScope(USER_ID, () => service.startAttempt('exam-1'));
    expect(result.examTypeId).toBe('exam-1');
    expect(repo.closeAndScore).toHaveBeenCalledWith(expired.id, 'TimedOut');
    expect(repo.insertAttempt).toHaveBeenCalledOnce();
  });

  it('throws InsufficientQuestionBankError naming the module when a module bank is too small', async () => {
    const repo = buildRepo({
      findModules: vi.fn().mockResolvedValue([examModule({ moduleName: 'Geometry', questionCount: 5 })]),
      findQuestionsByModule: vi.fn().mockResolvedValue([examTypeQuestion()]),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    await expect(withUserScope(USER_ID, () => service.startAttempt('exam-1'))).rejects.toThrow(InsufficientQuestionBankError);
  });

  it('translates a duplicate-key insert race into AttemptAlreadyInProgressError with the winner id', async () => {
    const dupError = new QueryFailedError('INSERT', [], new Error('dup') as Error);
    (dupError as unknown as { code: string }).code = 'ER_DUP_ENTRY';
    const winner = attemptEntity({ id: 'winner-attempt' });
    const repo = buildRepo({
      insertAttempt: vi.fn().mockRejectedValue(dupError),
      findActiveAttempt: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(winner),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    try {
      await withUserScope(USER_ID, () => service.startAttempt('exam-1'));
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AttemptAlreadyInProgressError);
      expect((err as AttemptAlreadyInProgressError).existingAttemptId).toBe('winner-attempt');
    }
  });
});

describe('AttemptsService lazy-timeout path', () => {
  it('getQuestion closes an expired attempt and then reports AttemptNotInProgressError', async () => {
    const expired = attemptEntity({ deadlineAt: new Date(Date.now() - 1000) });
    const closed = attemptEntity({ status: 'TimedOut' });
    const repo = buildRepo({
      findAttemptById: vi.fn().mockResolvedValueOnce(expired).mockResolvedValueOnce(closed),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    await expect(withUserScope(USER_ID, () => service.getQuestion('attempt-1', 0))).rejects.toThrow(AttemptNotInProgressError);
    expect(repo.closeAndScore).toHaveBeenCalledWith(expired.id, 'TimedOut');
  });

  it('does not touch an attempt whose deadline has not yet passed', async () => {
    const repo = buildRepo();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    await withUserScope(USER_ID, () => service.getQuestion('attempt-1', 0));
    expect(repo.closeAndScore).not.toHaveBeenCalled();
  });

  it('AttemptNotFoundError when no such attempt exists', async () => {
    const repo = buildRepo({ findAttemptById: vi.fn().mockResolvedValue(null) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    await expect(withUserScope(USER_ID, () => service.getHeader('missing'))).rejects.toThrow(AttemptNotFoundError);
  });
});

describe('AttemptsService ownership', () => {
  it('rejects a non-owner with NotAttemptOwnerError on getHeader/answer/submit', async () => {
    const repo = buildRepo();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    await expect(withUserScope(OTHER_USER_ID, () => service.getHeader('attempt-1'))).rejects.toThrow(NotAttemptOwnerError);
    await expect(withUserScope(OTHER_USER_ID, () => service.answer('attempt-1', 0, 'A'))).rejects.toThrow(NotAttemptOwnerError);
    await expect(withUserScope(OTHER_USER_ID, () => service.submit('attempt-1'))).rejects.toThrow(NotAttemptOwnerError);
  });

  it('review() allows a non-owner who holds attempts.read_all', async () => {
    const repo = buildRepo();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions(true) as any, buildImageAssociation() as any);
    const result = await withUserScope(OTHER_USER_ID, () => service.review('attempt-1', 'all'));
    expect(result.attemptId).toBe('attempt-1');
  });

  it('review() rejects a non-owner without attempts.read_all', async () => {
    const repo = buildRepo();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions(false) as any, buildImageAssociation() as any);
    await expect(withUserScope(OTHER_USER_ID, () => service.review('attempt-1', 'all'))).rejects.toThrow(NotAttemptOwnerError);
  });
});

describe('AttemptsService.answer/getQuestion', () => {
  it('rejects when the attempt is not InProgress', async () => {
    const repo = buildRepo({ findAttemptById: vi.fn().mockResolvedValue(attemptEntity({ status: 'Submitted' })) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    await expect(withUserScope(USER_ID, () => service.answer('attempt-1', 0, 'A'))).rejects.toThrow(AttemptNotInProgressError);
  });

  it('404s for a question index outside the attempt (never clamped)', async () => {
    const repo = buildRepo({ findQuestionByIndex: vi.fn().mockResolvedValue(null) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    await expect(withUserScope(USER_ID, () => service.getQuestion('attempt-1', 99))).rejects.toThrow(AttemptQuestionNotFoundError);
  });

  it('persists the selected option and answeredAt', async () => {
    const question = attemptQuestion();
    const repo = buildRepo({ findQuestionByIndex: vi.fn().mockResolvedValue(question) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    const result = await withUserScope(USER_ID, () => service.answer('attempt-1', 0, 'B'));
    expect(result).toEqual({ questionIndex: 0, selectedOption: 'B' });
    expect(repo.saveAnswer).toHaveBeenCalledWith(expect.objectContaining({ selectedOption: 'B' }));
  });
});

describe('AttemptsService.submit', () => {
  it('scores and closes the attempt', async () => {
    const repo = buildRepo();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    const result = await withUserScope(USER_ID, () => service.submit('attempt-1'));
    expect(result.status).toBe('Submitted');
    expect(repo.closeAndScore).toHaveBeenCalledWith('attempt-1', 'Submitted');
  });

  it('treats a raced double-submit (closeAndScore returns null) as AttemptNotInProgressError', async () => {
    const repo = buildRepo({ closeAndScore: vi.fn().mockResolvedValue(null) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    await expect(withUserScope(USER_ID, () => service.submit('attempt-1'))).rejects.toThrow(AttemptNotInProgressError);
  });
});

describe('AttemptsService.review', () => {
  it('filters to wrong-only when filter=wrong', async () => {
    const questions = [
      attemptQuestion({ questionIndex: 0, isCorrect: true }),
      attemptQuestion({ questionIndex: 1, isCorrect: false }),
    ];
    const repo = buildRepo({ findQuestionsForAttempt: vi.fn().mockResolvedValue(questions) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    const result = await withUserScope(USER_ID, () => service.review('attempt-1', 'wrong'));
    expect(result.items).toHaveLength(1);
    expect(result.items[0].questionIndex).toBe(1);
  });

  it('reports a still-InProgress attempt as Submitted in the review response', async () => {
    const repo = buildRepo({ findAttemptById: vi.fn().mockResolvedValue(attemptEntity({ status: 'InProgress' })) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    const result = await withUserScope(USER_ID, () => service.review('attempt-1', 'all'));
    expect(result.status).toBe('Submitted');
  });
});

describe('AttemptsService.listOwnHistory/listAllHistory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists only the caller-scoped history and resolves exam type names', async () => {
    const repo = buildRepo({ findHistory: vi.fn().mockResolvedValue([attemptEntity()]) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    const result = await withUserScope(USER_ID, () => service.listOwnHistory());
    expect(result).toHaveLength(1);
    expect(result[0].examTypeName).toBe('Grade 10 Math');
    expect(repo.findHistory).toHaveBeenCalledWith({ userId: USER_ID, examTypeId: undefined });
  });

  it('listAllHistory does not scope by userId unless explicitly filtered', async () => {
    const repo = buildRepo({ findHistory: vi.fn().mockResolvedValue([]) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    await withUserScope(USER_ID, () => service.listAllHistory({ examTypeId: 'exam-1' }));
    expect(repo.findHistory).toHaveBeenCalledWith({ examTypeId: 'exam-1' });
  });
});

describe('AttemptsService image resolution', () => {
  it('resolves associated images for a question with a known sourceGeneratedQuestionId', async () => {
    const question = attemptQuestion({ sourceGeneratedQuestionId: 'gq-1' });
    const repo = buildRepo({ findQuestionByIndex: vi.fn().mockResolvedValue(question) });
    const imageAssociation = {
      listImagesForQuestions: vi.fn().mockResolvedValue(
        new Map([
          [
            'gq-1',
            [
              {
                id: 'img-1',
                storageKey: 'tenants/t/img-1.png',
                altText: 'alt',
                caption: 'cap',
                position: 'question_text' as const,
                optionKey: null,
                width: 100,
                height: 50,
              },
            ],
          ],
        ]),
      ),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, imageAssociation as any);
    const result = await withUserScope(USER_ID, () => service.getQuestion('attempt-1', 0));
    expect(result.images).toEqual([
      { id: 'img-1', storageKey: 'tenants/t/img-1.png', altText: 'alt', caption: 'cap', position: 'question_text', optionKey: null, width: 100, height: 50 },
    ]);
  });

  it('resolves to an empty image array when sourceGeneratedQuestionId is null', async () => {
    const question = attemptQuestion({ sourceGeneratedQuestionId: null });
    const repo = buildRepo({ findQuestionByIndex: vi.fn().mockResolvedValue(question) });
    const imageAssociation = buildImageAssociation();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, imageAssociation as any);
    const result = await withUserScope(USER_ID, () => service.getQuestion('attempt-1', 0));
    expect(result.images).toEqual([]);
    expect(imageAssociation.listImagesForQuestions).not.toHaveBeenCalled();
  });

  it('throws InternalDomainError (cause carries the diagnostic message) when called with no authenticated user in context', async () => {
    const repo = buildRepo();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    try {
      await service.getHeader('attempt-1');
      expect.fail('expected throw');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('INTERNAL_ERROR');
      expect((err as { cause?: Error }).cause?.message).toBe('AttemptsService called outside any authenticated request.');
    }
  });
});

describe('AttemptsService.listAvailableExams/getInstructions', () => {
  it('lists exams with module counts', async () => {
    const repo = buildRepo({ findAllExamTypes: vi.fn().mockResolvedValue([examType()]) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    const result = await service.listAvailableExams();
    expect(result).toEqual([
      { id: 'exam-1', name: 'Grade 10 Math', description: null, totalQuestions: 2, totalMinutes: 30, moduleCount: 1 },
    ]);
  });

  it('getInstructions throws AttemptExamTypeNotFoundError for a missing Exam Type', async () => {
    const repo = buildRepo({ findExamTypeById: vi.fn().mockResolvedValue(null) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AttemptsService(repo as any, buildPermissions() as any, buildImageAssociation() as any);
    await expect(service.getInstructions('missing')).rejects.toThrow(AttemptExamTypeNotFoundError);
  });
});
