import { Inject, Injectable } from '@nestjs/common';
import { SESSION_REPOSITORY, type SessionRepositoryPort } from '../domain/ports';
import { nextStatus, type SessionEvent } from '../domain/session-status';
import type { SessionRecord } from '../domain/session';

/**
 * Single writer of `Session.status` (LLD §8.1). Both the LiveKit webhook
 * (`internal` module) and the public end-call fast path funnel through this
 * use case so an illegal transition (duplicate end-call, a late event after
 * a terminal status) is always a no-op, never an error.
 */
@Injectable()
export class ApplySessionEventUseCase {
  constructor(@Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort) {}

  /**
   * @param session - Session row loaded by the caller (avoids a second lookup)
   * @param event - Lifecycle event to apply
   * @param errorCode - Set alongside a `failed` transition
   * @returns Updated record, or the original record when the transition was
   *   an illegal no-op (never `null` unless the row genuinely vanished)
   */
  async execute(session: SessionRecord, event: SessionEvent, errorCode?: string): Promise<SessionRecord> {
    const next = nextStatus(session.status, event);
    if (!next) {
      return session;
    }

    const now = new Date();
    const patch: Parameters<SessionRepositoryPort['applyStatus']>[1] = { status: next };
    if (next === 'active' && !session.joinedAt) {
      patch.joinedAt = now;
    }
    if (next === 'ended' || next === 'failed' || next === 'abandoned') {
      patch.endedAt = now;
    }
    if (next === 'failed' && errorCode) {
      patch.errorCode = errorCode;
    }

    const updated = await this.sessions.applyStatus(session.id, patch);
    return updated ?? session;
  }
}
