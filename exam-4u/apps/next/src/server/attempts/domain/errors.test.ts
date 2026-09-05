import { describe, expect, it } from 'vitest';
import {
  AttemptAlreadyInProgressError,
  AttemptExamTypeNotFoundError,
  AttemptNotFoundError,
  AttemptNotInProgressError,
  AttemptQuestionNotFoundError,
  InsufficientQuestionBankError,
  NotAttemptOwnerError,
} from './errors';

describe('attempts domain errors', () => {
  it('AttemptExamTypeNotFoundError carries EXAM_TYPE_NOT_FOUND', () => {
    expect(new AttemptExamTypeNotFoundError().code).toBe('EXAM_TYPE_NOT_FOUND');
  });

  it('AttemptAlreadyInProgressError carries ATTEMPT_ALREADY_IN_PROGRESS and the existing attempt id', () => {
    const err = new AttemptAlreadyInProgressError('a-1');
    expect(err.code).toBe('ATTEMPT_ALREADY_IN_PROGRESS');
    expect(err.existingAttemptId).toBe('a-1');
    expect(err.details).toEqual({ attemptId: 'a-1' });
  });

  it('InsufficientQuestionBankError carries INSUFFICIENT_QUESTION_BANK with module/available/required', () => {
    const err = new InsufficientQuestionBankError('Algebra', 2, 5);
    expect(err.code).toBe('INSUFFICIENT_QUESTION_BANK');
    expect(err.details).toEqual({ moduleName: 'Algebra', available: 2, required: 5 });
  });

  it('AttemptNotFoundError carries ATTEMPT_NOT_FOUND', () => {
    expect(new AttemptNotFoundError().code).toBe('ATTEMPT_NOT_FOUND');
  });

  it('NotAttemptOwnerError carries NOT_ATTEMPT_OWNER', () => {
    expect(new NotAttemptOwnerError().code).toBe('NOT_ATTEMPT_OWNER');
  });

  it('AttemptNotInProgressError carries ATTEMPT_NOT_IN_PROGRESS', () => {
    expect(new AttemptNotInProgressError().code).toBe('ATTEMPT_NOT_IN_PROGRESS');
  });

  it('AttemptQuestionNotFoundError carries QUESTION_NOT_FOUND', () => {
    expect(new AttemptQuestionNotFoundError().code).toBe('QUESTION_NOT_FOUND');
  });
});
