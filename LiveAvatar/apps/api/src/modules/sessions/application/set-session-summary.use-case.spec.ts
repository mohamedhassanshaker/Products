import { SetSessionSummaryUseCase } from './set-session-summary.use-case';

describe('SetSessionSummaryUseCase', () => {
  function make(session: unknown) {
    const sessions = { findById: jest.fn().mockResolvedValue(session), setSummary: jest.fn().mockResolvedValue(undefined) };
    const useCase = new SetSessionSummaryUseCase(sessions as never);
    return { useCase, sessions };
  }

  it('throws SESSION_NOT_FOUND for an unknown session id', async () => {
    const { useCase } = make(null);
    await expect(useCase.execute('s1', { summary_status: 'ready', summary_text: 'hi' })).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
  });

  it('writes a ready summary with its text', async () => {
    const { useCase, sessions } = make({ id: 's1' });
    await useCase.execute('s1', { summary_status: 'ready', summary_text: 'A short summary.' });
    expect(sessions.setSummary).toHaveBeenCalledWith('s1', 'ready', 'A short summary.');
  });

  it('writes an unavailable summary with a null text when none was sent (FR-CALL-4)', async () => {
    const { useCase, sessions } = make({ id: 's1' });
    await useCase.execute('s1', { summary_status: 'unavailable' });
    expect(sessions.setSummary).toHaveBeenCalledWith('s1', 'unavailable', null);
  });
});
