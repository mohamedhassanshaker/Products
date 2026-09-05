import { SweepAbandonedSessionsUseCase } from './sweep-abandoned-sessions.use-case';

describe('SweepAbandonedSessionsUseCase (FR-AUTH-4 pre-call abandonment + LLD §8.8 max_duration sweep)', () => {
  function make(opts: {
    abandonCandidates?: unknown[];
    applyStatusResult?: unknown;
    activeCandidates?: unknown[];
    applyEventResult?: (session: unknown) => unknown;
  }) {
    // `?? { id: 'ok' }` would wrongly override an explicit `null`
    // (nullish-coalescing treats `null` as absent) — the race-lost test below
    // depends on `applyStatus` actually resolving to `null`, so check
    // presence in `opts` instead of using `??`.
    const applyStatusResult = 'applyStatusResult' in opts ? opts.applyStatusResult : { id: 'ok' };
    const sessions = {
      listAbandonable: jest.fn().mockResolvedValue(opts.abandonCandidates ?? []),
      applyStatus: jest.fn().mockResolvedValue(applyStatusResult),
      listActiveJoined: jest.fn().mockResolvedValue(opts.activeCandidates ?? []),
    };
    const liveKit = { deleteRoom: jest.fn().mockResolvedValue(undefined) };
    const applyEvent = {
      execute: jest
        .fn()
        .mockImplementation(async (session: { status: string }) =>
          opts.applyEventResult ? opts.applyEventResult(session) : { ...session, status: 'ended' },
        ),
    };
    return {
      useCase: new SweepAbandonedSessionsUseCase(sessions as never, liveKit as never, applyEvent as never),
      sessions,
      liveKit,
      applyEvent,
    };
  }

  describe('half 1: pending -> abandoned', () => {
    it('abandons every pending session older than the cutoff and deletes its room', async () => {
      const { useCase, sessions, liveKit } = make({
        abandonCandidates: [
          { id: 's1', roomName: 'acme_s1' },
          { id: 's2', roomName: 'acme_s2' },
        ],
      });
      const count = await useCase.execute();
      expect(count).toBe(2);
      expect(sessions.applyStatus).toHaveBeenCalledTimes(2);
      expect(liveKit.deleteRoom).toHaveBeenCalledWith('acme_s1');
      expect(liveKit.deleteRoom).toHaveBeenCalledWith('acme_s2');
    });

    it('returns 0 and touches nothing when there are no candidates', async () => {
      const { useCase, liveKit } = make({});
      expect(await useCase.execute()).toBe(0);
      expect(liveKit.deleteRoom).not.toHaveBeenCalled();
    });

    it('does not delete the room for a candidate whose status update lost a race', async () => {
      const { useCase, liveKit } = make({
        abandonCandidates: [{ id: 's1', roomName: 'acme_s1' }],
        applyStatusResult: null,
      });
      const count = await useCase.execute();
      expect(count).toBe(0);
      expect(liveKit.deleteRoom).not.toHaveBeenCalled();
    });
  });

  describe('half 2: active past max_duration -> ended (QA Phase 3 D-2)', () => {
    it('ends an active session whose joinedAt + maxDurationSeconds has elapsed and deletes its room', async () => {
      const joinedAt = new Date(Date.now() - 3 * 60 * 60 * 1000); // joined 3h ago
      const session = { id: 's1', roomName: 'acme_s1', status: 'active', joinedAt, maxDurationSeconds: 7200 }; // 2h max
      const { useCase, applyEvent, liveKit } = make({ activeCandidates: [session] });

      const count = await useCase.execute();

      expect(count).toBe(1);
      expect(applyEvent.execute).toHaveBeenCalledWith(session, 'ended');
      expect(liveKit.deleteRoom).toHaveBeenCalledWith('acme_s1');
    });

    it('leaves an active session alone when it has not yet reached max_duration', async () => {
      const joinedAt = new Date(Date.now() - 10 * 60 * 1000); // joined 10m ago
      const session = { id: 's1', roomName: 'acme_s1', status: 'active', joinedAt, maxDurationSeconds: 7200 };
      const { useCase, applyEvent, liveKit } = make({ activeCandidates: [session] });

      const count = await useCase.execute();

      expect(count).toBe(0);
      expect(applyEvent.execute).not.toHaveBeenCalled();
      expect(liveKit.deleteRoom).not.toHaveBeenCalled();
    });

    it('skips a candidate with no joinedAt defensively (should never happen per the port contract)', async () => {
      const session = { id: 's1', roomName: 'acme_s1', status: 'active', joinedAt: null, maxDurationSeconds: 7200 };
      const { useCase, applyEvent } = make({ activeCandidates: [session] });

      const count = await useCase.execute();

      expect(count).toBe(0);
      expect(applyEvent.execute).not.toHaveBeenCalled();
    });

    it('does not delete the room when applyStatus lost a concurrent race (illegal-transition no-op)', async () => {
      // `listActiveJoined()` only ever returns `active` rows, so the
      // candidate itself is `active` — but `ApplySessionEventUseCase`'s
      // no-op contract returns the *original*, unchanged record whenever the
      // underlying `applyStatus` write loses a race (row vanished/changed
      // concurrently), so `updated.status` stays `active`, never `ended`.
      const joinedAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const session = { id: 's1', roomName: 'acme_s1', status: 'active', joinedAt, maxDurationSeconds: 7200 };
      const { useCase, liveKit } = make({
        activeCandidates: [session],
        applyEventResult: (s) => s, // unchanged record: status stays 'active'
      });

      const count = await useCase.execute();

      expect(count).toBe(0);
      expect(liveKit.deleteRoom).not.toHaveBeenCalled();
    });

    it('does not double-delete the room for a candidate that was already ended before this sweep ran', async () => {
      // Defensive case: if `session.status` were ever already `ended` at
      // input (shouldn't happen given `listActiveJoined()`'s filter, but
      // guarded rather than assumed), `wasAlreadyEnded` must still prevent a
      // second room deletion even if the mock double-echoes `ended` back.
      const joinedAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const session = { id: 's1', roomName: 'acme_s1', status: 'ended', joinedAt, maxDurationSeconds: 7200 };
      const { useCase, liveKit } = make({
        activeCandidates: [session],
        applyEventResult: (s) => s,
      });

      const count = await useCase.execute();

      expect(count).toBe(0);
      expect(liveKit.deleteRoom).not.toHaveBeenCalled();
    });

    it('combines both halves in the returned total count', async () => {
      const joinedAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const { useCase } = make({
        abandonCandidates: [{ id: 'p1', roomName: 'acme_p1' }],
        activeCandidates: [{ id: 'a1', roomName: 'acme_a1', status: 'active', joinedAt, maxDurationSeconds: 7200 }],
      });

      expect(await useCase.execute()).toBe(2);
    });
  });
});
