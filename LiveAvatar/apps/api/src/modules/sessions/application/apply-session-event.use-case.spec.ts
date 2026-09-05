import { ApplySessionEventUseCase } from './apply-session-event.use-case';

function makeSession(overrides: Record<string, unknown> = {}) {
  return { id: 's1', status: 'pending', joinedAt: null, ...overrides };
}

describe('ApplySessionEventUseCase (LLD §8.1, single writer of Session.status)', () => {
  function make() {
    const sessions = { applyStatus: jest.fn() };
    return { useCase: new ApplySessionEventUseCase(sessions as never), sessions };
  }

  it('sets joinedAt on the first active transition (FR-TRANSPORT-4)', async () => {
    const { useCase, sessions } = make();
    const session = makeSession();
    sessions.applyStatus.mockResolvedValue({ ...session, status: 'active', joinedAt: new Date() });
    await useCase.execute(session as never, 'active');
    expect(sessions.applyStatus).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ status: 'active', joinedAt: expect.any(Date) }),
    );
  });

  it('does not overwrite joinedAt on a repeated active event', async () => {
    const { useCase, sessions } = make();
    const session = makeSession({ status: 'active', joinedAt: new Date('2026-01-01') });
    sessions.applyStatus.mockResolvedValue(session);
    await useCase.execute(session as never, 'active');
    const patch = sessions.applyStatus.mock.calls[0][1];
    expect(patch.joinedAt).toBeUndefined();
  });

  it('sets endedAt on an ended transition', async () => {
    const { useCase, sessions } = make();
    const session = makeSession();
    sessions.applyStatus.mockResolvedValue({ ...session, status: 'ended' });
    await useCase.execute(session as never, 'ended');
    expect(sessions.applyStatus).toHaveBeenCalledWith('s1', expect.objectContaining({ status: 'ended', endedAt: expect.any(Date) }));
  });

  it('sets errorCode on a failed transition when provided', async () => {
    const { useCase, sessions } = make();
    const session = makeSession();
    sessions.applyStatus.mockResolvedValue({ ...session, status: 'failed' });
    await useCase.execute(session as never, 'failed', 'TRANSPORT_MIC_MISSING');
    expect(sessions.applyStatus).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ status: 'failed', errorCode: 'TRANSPORT_MIC_MISSING' }),
    );
  });

  it('is a no-op (does not call the repository) for an illegal transition', async () => {
    const { useCase, sessions } = make();
    const session = makeSession({ status: 'ended' });
    const result = await useCase.execute(session as never, 'failed');
    expect(sessions.applyStatus).not.toHaveBeenCalled();
    expect(result).toBe(session);
  });

  it('falls back to the original record when the row has vanished mid-update', async () => {
    const { useCase, sessions } = make();
    const session = makeSession();
    sessions.applyStatus.mockResolvedValue(null);
    const result = await useCase.execute(session as never, 'ended');
    expect(result).toBe(session);
  });
});
