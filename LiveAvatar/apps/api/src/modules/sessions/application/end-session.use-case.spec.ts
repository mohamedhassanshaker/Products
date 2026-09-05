import { EndSessionUseCase } from './end-session.use-case';
import { ApplySessionEventUseCase } from './apply-session-event.use-case';

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    roomName: 'acme_s1',
    status: 'active',
    summaryTokenHash: null,
    ...overrides,
  };
}

describe('EndSessionUseCase (FR-TRANSPORT-4 fast path)', () => {
  function make(opts: { session?: unknown; verified?: unknown }) {
    const sessions = {
      findById: jest.fn().mockResolvedValue(opts.session ?? null),
      setSummaryToken: jest.fn().mockResolvedValue(undefined),
    };
    const liveKit = {
      verifyToken: jest.fn().mockResolvedValue(opts.verified ?? null),
      deleteRoom: jest.fn().mockResolvedValue(undefined),
    };
    const applyEvent = new ApplySessionEventUseCase({ applyStatus: jest.fn().mockResolvedValue(undefined) } as never);
    const useCase = new EndSessionUseCase(sessions as never, liveKit as never, applyEvent);
    return { useCase, sessions, liveKit };
  }

  it('throws AUTH_UNAUTHORIZED (not a 404) for an unknown session id, so existence cannot be probed (QA Phase 3 D-4)', async () => {
    // Presenting a validly-signed token whose identity matches the given
    // (non-existent) session id still can't be told apart from a real
    // session by response shape — both collapse to AUTH_UNAUTHORIZED.
    const { useCase } = make({ session: null, verified: { identity: 'user_missing', roomName: 'acme_missing' } });
    await expect(useCase.execute('missing', 'tok')).rejects.toMatchObject({ code: 'AUTH_UNAUTHORIZED', httpStatus: 401 });
  });

  it('throws AUTH_UNAUTHORIZED when the token fails verification, before any session lookup', async () => {
    const { useCase, sessions } = make({ session: makeSession(), verified: null });
    await expect(useCase.execute('s1', 'bad')).rejects.toMatchObject({ code: 'AUTH_UNAUTHORIZED', httpStatus: 401 });
    // Enumeration-resistance (QA Phase 3 D-4): an invalid token is rejected
    // without ever touching the DB, so response timing/behavior can't leak
    // whether `sessionId` exists.
    expect(sessions.findById).not.toHaveBeenCalled();
  });

  it('throws AUTH_UNAUTHORIZED when the token identity does not match this session', async () => {
    const { useCase } = make({ session: makeSession(), verified: { identity: 'user_other', roomName: 'acme_s1' } });
    await expect(useCase.execute('s1', 'tok')).rejects.toMatchObject({ code: 'AUTH_UNAUTHORIZED' });
  });

  it('throws AUTH_UNAUTHORIZED when the token room does not match this session', async () => {
    const { useCase } = make({ session: makeSession(), verified: { identity: 'user_s1', roomName: 'other_room' } });
    await expect(useCase.execute('s1', 'tok')).rejects.toMatchObject({ code: 'AUTH_UNAUTHORIZED' });
  });

  it('ends the session, deletes the room, and mints a one-time summary token on first end', async () => {
    const { useCase, sessions, liveKit } = make({ session: makeSession(), verified: { identity: 'user_s1', roomName: 'acme_s1' } });
    const result = await useCase.execute('s1', 'tok');
    expect(result.status).toBe('ended');
    expect(result.summary_token).toBeDefined();
    expect(result.summary_token_expires_at).toBeDefined();
    expect(liveKit.deleteRoom).toHaveBeenCalledWith('acme_s1');
    expect(sessions.setSummaryToken).toHaveBeenCalledWith('s1', expect.any(String), expect.any(Date));
  });

  it('is idempotent on a duplicate end-call: no second summary token is minted', async () => {
    const { useCase, sessions } = make({
      session: makeSession({ status: 'ended' }),
      verified: { identity: 'user_s1', roomName: 'acme_s1' },
    });
    const result = await useCase.execute('s1', 'tok');
    expect(result).toEqual({ status: 'ended' });
    expect(sessions.setSummaryToken).not.toHaveBeenCalled();
  });

  it('does not re-mint a summary token when one already exists', async () => {
    const { useCase, sessions } = make({
      session: makeSession({ summaryTokenHash: 'already-set' }),
      verified: { identity: 'user_s1', roomName: 'acme_s1' },
    });
    const result = await useCase.execute('s1', 'tok');
    expect(result).toEqual({ status: 'ended' });
    expect(sessions.setSummaryToken).not.toHaveBeenCalled();
  });
});
