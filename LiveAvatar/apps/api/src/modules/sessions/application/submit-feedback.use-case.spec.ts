import { createHash } from 'node:crypto';
import { SubmitFeedbackUseCase } from './submit-feedback.use-case';

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    tenantId: 't1',
    summaryTokenHash: hash('good-token'),
    summaryTokenExpiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

describe('SubmitFeedbackUseCase', () => {
  function make(session: unknown = makeSession(), exists = false) {
    const sessions = { findById: jest.fn().mockResolvedValue(session) };
    const feedback = {
      existsForSession: jest.fn().mockResolvedValue(exists),
      create: jest.fn().mockResolvedValue('created'),
    };
    const useCase = new SubmitFeedbackUseCase(sessions as never, feedback as never);
    return { useCase, sessions, feedback };
  }

  it('404s for an unknown session id', async () => {
    const { useCase } = make(null);
    await expect(useCase.execute('missing', 'good-token', { rating: 5 })).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('401s CALL_SUMMARY_EXPIRED for a bad token', async () => {
    const { useCase } = make();
    await expect(useCase.execute('s1', 'wrong', { rating: 5 })).rejects.toMatchObject({ code: 'CALL_SUMMARY_EXPIRED' });
  });

  it('409s FEEDBACK_ALREADY_SUBMITTED when the pre-check finds an existing row', async () => {
    const { useCase, feedback } = make(makeSession(), true);
    await expect(useCase.execute('s1', 'good-token', { rating: 4 })).rejects.toMatchObject({ code: 'FEEDBACK_ALREADY_SUBMITTED', httpStatus: 409 });
    expect(feedback.create).not.toHaveBeenCalled();
  });

  it('409s FEEDBACK_ALREADY_SUBMITTED on a create-time race (unique constraint)', async () => {
    const { useCase, feedback } = make();
    feedback.create.mockResolvedValue('duplicate');
    await expect(useCase.execute('s1', 'good-token', { rating: 4, comment: 'Great!' })).rejects.toMatchObject({ code: 'FEEDBACK_ALREADY_SUBMITTED' });
  });

  it('creates feedback for a valid token and rating', async () => {
    const { useCase, feedback } = make();
    await useCase.execute('s1', 'good-token', { rating: 5, comment: 'Loved it' });
    expect(feedback.create).toHaveBeenCalledWith({ sessionId: 's1', tenantId: 't1', rating: 5, comment: 'Loved it' });
  });

  it('defaults comment to null when omitted', async () => {
    const { useCase, feedback } = make();
    await useCase.execute('s1', 'good-token', { rating: 3 });
    expect(feedback.create).toHaveBeenCalledWith({ sessionId: 's1', tenantId: 't1', rating: 3, comment: null });
  });
});
