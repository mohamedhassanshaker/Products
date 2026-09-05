import { createHash } from 'node:crypto';
import { GetSessionSummaryUseCase } from './get-session-summary.use-case';

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    tenantId: 't1',
    status: 'ended',
    summaryTokenHash: hash('good-token'),
    summaryTokenExpiresAt: new Date(Date.now() + 60_000),
    summaryText: 'A short summary.',
    summaryStatus: 'ready',
    transcriptPurged: false,
    ...overrides,
  };
}

describe('GetSessionSummaryUseCase', () => {
  function make(session: unknown = makeSession()) {
    const sessions = { findById: jest.fn().mockResolvedValue(session) };
    const utterances = { listBySession: jest.fn().mockResolvedValue([{ seq: 0, role: 'user', text: 'hi', startedAt: new Date(), endedAt: null }]) };
    const feedback = { existsForSession: jest.fn().mockResolvedValue(false) };
    const useCase = new GetSessionSummaryUseCase(sessions as never, utterances as never, feedback as never);
    return { useCase, sessions, utterances, feedback };
  }

  it('404s for an unknown session id (FR-CALL-5)', async () => {
    const { useCase } = make(null);
    await expect(useCase.execute('missing', 'good-token')).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND', httpStatus: 404 });
  });

  it('401s CALL_SUMMARY_EXPIRED when no token is presented', async () => {
    const { useCase } = make();
    await expect(useCase.execute('s1', undefined)).rejects.toMatchObject({ code: 'CALL_SUMMARY_EXPIRED', httpStatus: 401 });
  });

  it('401s CALL_SUMMARY_EXPIRED when the token does not match the stored hash', async () => {
    const { useCase } = make();
    await expect(useCase.execute('s1', 'wrong-token')).rejects.toMatchObject({ code: 'CALL_SUMMARY_EXPIRED' });
  });

  it('401s CALL_SUMMARY_EXPIRED once the token has expired', async () => {
    const { useCase } = make(makeSession({ summaryTokenExpiresAt: new Date(Date.now() - 1_000) }));
    await expect(useCase.execute('s1', 'good-token')).rejects.toMatchObject({ code: 'CALL_SUMMARY_EXPIRED' });
  });

  it('410s TRANSCRIPT_PURGED for a purged session, after the token check', async () => {
    const { useCase, utterances } = make(makeSession({ transcriptPurged: true }));
    await expect(useCase.execute('s1', 'good-token')).rejects.toMatchObject({ code: 'TRANSCRIPT_PURGED', httpStatus: 410 });
    expect(utterances.listBySession).not.toHaveBeenCalled();
  });

  it('returns transcript, summary, and feedback_submitted for a valid token', async () => {
    const { useCase } = make();
    const result = await useCase.execute('s1', 'good-token');
    expect(result).toEqual({
      status: 'ended',
      summary_text: 'A short summary.',
      summary_status: 'ready',
      transcript: [{ role: 'user', text: 'hi' }],
      feedback_submitted: false,
    });
  });

  it('omits summary_text when the agent never produced one', async () => {
    const { useCase } = make(makeSession({ summaryText: null, summaryStatus: 'unavailable' }));
    const result = await useCase.execute('s1', 'good-token');
    expect(result.summary_text).toBeUndefined();
    expect(result.summary_status).toBe('unavailable');
  });
});
