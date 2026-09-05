import { describe, expect, it } from 'vitest';
import {
  ExamTypeHasActiveAttemptsError,
  ExamTypeNameExistsError,
  ExamTypeNotFoundError,
  FileTooLargeError,
  QuestionCountMismatchError,
} from './errors';

describe('exam-authoring domain errors', () => {
  it('FileTooLargeError carries FILE_TOO_LARGE and names the configured max size', () => {
    const err = new FileTooLargeError(104_857_600);
    expect(err.code).toBe('FILE_TOO_LARGE');
    expect(err.message).toContain('104857600');
  });

  it('ExamTypeNameExistsError carries EXAM_TYPE_NAME_EXISTS', () => {
    expect(new ExamTypeNameExistsError().code).toBe('EXAM_TYPE_NAME_EXISTS');
  });

  it('ExamTypeNotFoundError carries EXAM_TYPE_NOT_FOUND', () => {
    expect(new ExamTypeNotFoundError().code).toBe('EXAM_TYPE_NOT_FOUND');
  });

  it('ExamTypeHasActiveAttemptsError carries EXAM_TYPE_HAS_ACTIVE_ATTEMPTS', () => {
    expect(new ExamTypeHasActiveAttemptsError().code).toBe('EXAM_TYPE_HAS_ACTIVE_ATTEMPTS');
  });

  describe('QuestionCountMismatchError', () => {
    it('the plain constructor reports the declared-total-vs-sum-of-modules shape', () => {
      const err = new QuestionCountMismatchError(5, 3);
      expect(err.code).toBe('QUESTION_COUNT_MISMATCH');
      expect(err.details).toEqual({ declaredTotal: 5, sumOfModules: 3 });
    });

    it('.forModule() reports the per-module declared-vs-actual shape and is still instanceof the base class', () => {
      const err = QuestionCountMismatchError.forModule('Algebra', 2, 1);
      expect(err).toBeInstanceOf(QuestionCountMismatchError);
      expect(err.code).toBe('QUESTION_COUNT_MISMATCH');
      expect(err.details).toEqual({ module: 'Algebra', declaredCount: 2, actualCount: 1 });
      expect(err.message).toContain('Algebra');
    });
  });
});
