import { Inject, Injectable, Logger } from '@nestjs/common';
import { LIVEKIT_CLIENT, type LiveKitClientPort } from '../../transport';
import { ApplySessionEventUseCase } from './apply-session-event.use-case';
import { SESSION_REPOSITORY, type SessionRepositoryPort } from '../domain/ports';

/** Abandonment window (FR-AUTH-4): unjoined `pending` sessions older than this are abandoned. */
export const ABANDON_AFTER_MS = 15 * 60 * 1000;

/**
 * `session-sweeper` scheduled job body (LLD §8.8, wired by the `jobs`
 * module). Implements both halves of the sweep:
 *  1. Unjoined `pending` sessions older than `ABANDON_AFTER_MS` → `abandoned`
 *     + best-effort LiveKit room deletion (a pre-call flow that never
 *     actually joined: mic denied, tab closed, network drop before token
 *     use).
 *  2. `active` sessions that have run past their own `maxDurationSeconds`
 *     (measured from `joinedAt`, when the call actually started, not
 *     `startedAt`, when the token was minted) → `ended`. This is the
 *     server-side safety net for a session whose browser never calls
 *     `/public/sessions/{id}/end` and whose LiveKit room never fires (or
 *     whose `room_finished` webhook is never delivered) — the only other
 *     path to a terminal state (QA Phase 3 D-2: this half was previously
 *     entirely unimplemented).
 */
@Injectable()
export class SweepAbandonedSessionsUseCase {
  private readonly logger = new Logger(SweepAbandonedSessionsUseCase.name);

  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
    @Inject(LIVEKIT_CLIENT) private readonly liveKit: LiveKitClientPort,
    private readonly applyEvent: ApplySessionEventUseCase,
  ) {}

  /** @returns Number of sessions abandoned + force-ended in this sweep */
  async execute(): Promise<number> {
    const abandoned = await this.sweepAbandonedPending();
    const expired = await this.sweepExpiredActive();

    const total = abandoned + expired;
    if (total > 0) {
      this.logger.log(
        { abandoned, expired },
        'session-sweeper: abandoned unjoined pending sessions / ended sessions past max_duration',
      );
    }
    return total;
  }

  /** Half 1 of LLD §8.8: unjoined `pending` sessions older than 15 min → `abandoned`. */
  private async sweepAbandonedPending(): Promise<number> {
    const cutoff = new Date(Date.now() - ABANDON_AFTER_MS);
    const candidates = await this.sessions.listAbandonable(cutoff);

    let count = 0;
    for (const session of candidates) {
      const updated = await this.sessions.applyStatus(session.id, {
        status: 'abandoned',
        endedAt: new Date(),
      });
      if (updated) {
        await this.liveKit.deleteRoom(session.roomName);
        count += 1;
      }
    }
    return count;
  }

  /** Half 2 of LLD §8.8: `active` sessions past their own `maxDurationSeconds` → `ended`. */
  private async sweepExpiredActive(): Promise<number> {
    const candidates = await this.sessions.listActiveJoined();
    const now = Date.now();

    let count = 0;
    for (const session of candidates) {
      // `joinedAt` is guaranteed non-null by `listActiveJoined()`'s contract,
      // but the domain type is nullable, so guard defensively rather than
      // asserting.
      if (!session.joinedAt) {
        continue;
      }
      const expiresAt = session.joinedAt.getTime() + session.maxDurationSeconds * 1000;
      if (expiresAt > now) {
        continue;
      }
      // Routed through the single writer of `Session.status` (LLD §8.1) so
      // this stays consistent with the webhook/end-call paths and a
      // concurrent transition (e.g. a race with the end-call fast path) is
      // safely a no-op rather than a double-write. `wasAlreadyEnded` guards
      // against double-deleting the room: `ApplySessionEventUseCase`'s
      // illegal-transition no-op returns the *original* record unchanged, so
      // checking only `updated.status === 'ended'` would also fire (and
      // re-delete) a room that reached `ended` through some other path a
      // moment earlier.
      const wasAlreadyEnded = session.status === 'ended';
      const updated = await this.applyEvent.execute(session, 'ended');
      if (!wasAlreadyEnded && updated.status === 'ended') {
        await this.liveKit.deleteRoom(session.roomName);
        count += 1;
      }
    }
    return count;
  }
}
