import { PublicController } from './public.controller';

describe('PublicController (unauthenticated end-user surface)', () => {
  function make() {
    const getPreflight = { execute: jest.fn().mockResolvedValue({ ok: true }) };
    const issueToken = { execute: jest.fn().mockResolvedValue({ session_id: 's1' }) };
    const endSession = { execute: jest.fn().mockResolvedValue({ status: 'ended' }) };
    const getSummary = { execute: jest.fn().mockResolvedValue({ status: 'ended', summary_status: 'ready', feedback_submitted: false }) };
    const submitFeedback = { execute: jest.fn().mockResolvedValue(undefined) };
    const controller = new PublicController(
      getPreflight as never,
      issueToken as never,
      endSession as never,
      getSummary as never,
      submitFeedback as never,
    );
    return { controller, getPreflight, issueToken, endSession, getSummary, submitFeedback };
  }

  it('GET preflight delegates to GetPreflightUseCase with the slug', async () => {
    const { controller, getPreflight } = make();
    const result = await controller.preflight('acme');
    expect(getPreflight.execute).toHaveBeenCalledWith('acme');
    expect(result).toEqual({ ok: true });
  });

  it('POST sessions delegates to IssueConversationTokenUseCase with the body', async () => {
    const { controller, issueToken } = make();
    const body = { slug: 'acme', display_name: 'Alice' };
    const result = await controller.createSession(body as never);
    expect(issueToken.execute).toHaveBeenCalledWith(body);
    expect(result).toEqual({ session_id: 's1' });
  });

  it('POST sessions/:id/end delegates to EndSessionUseCase with id + token', async () => {
    const { controller, endSession } = make();
    const result = await controller.end('s1', { token: 'tok' } as never);
    expect(endSession.execute).toHaveBeenCalledWith('s1', 'tok');
    expect(result).toEqual({ status: 'ended' });
  });

  it('GET sessions/:id/summary delegates to GetSessionSummaryUseCase with id + token header', async () => {
    const { controller, getSummary } = make();
    const result = await controller.summary('s1', 'tok');
    expect(getSummary.execute).toHaveBeenCalledWith('s1', 'tok');
    expect(result).toEqual({ status: 'ended', summary_status: 'ready', feedback_submitted: false });
  });

  it('GET sessions/:id/summary works with no token header at all (use case rejects it)', async () => {
    const { controller, getSummary } = make();
    await controller.summary('s1', undefined);
    expect(getSummary.execute).toHaveBeenCalledWith('s1', undefined);
  });

  it('POST sessions/:id/feedback delegates to SubmitFeedbackUseCase with id + token + body', async () => {
    const { controller, submitFeedback } = make();
    const body = { rating: 5, comment: 'Great!' };
    await controller.feedback('s1', 'tok', body as never);
    expect(submitFeedback.execute).toHaveBeenCalledWith('s1', 'tok', body);
  });
});
