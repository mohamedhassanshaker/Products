import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PublicSessionEndResponse } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import { LIVEKIT_CLIENT, userIdentity, type LiveKitClientPort } from '../../transport';
import { SESSION_REPOSITORY, type SessionRepositoryPort } from '../domain/ports';
import { ApplySessionEventUseCase } from './apply-session-event.use-case';

/** Post-call summary token TTL (FR-CALL-4) — 30 minutes. */
const SUMMARY_TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * `POST /public/sessions/{id}/end` (FR-TRANSPORT-4). The LiveKit
 * `room_finished` webhook (`internal` module) is authoritative; this is the
 * fast path so the browser doesn't wait on the webhook round trip before
 * navigating to Screen 11. Auth is the LiveKit token itself — no admin JWT,
 * no session-scoped cookie, since end users have no accounts.
 */
@Injectable()
export class EndSessionUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
    @Inject(LIVEKIT_CLIENT) private readonly liveKit: LiveKitClientPort,
    private readonly applyEvent: ApplySessionEventUseCase,
  ) {}

  /**
   * @param sessionId - Path `:id`
   * @param token - Body `{token}` — the LiveKit user token presented at join
   */
  async execute(sessionId: string, token: string): Promise<PublicSessionEndResponse> {
    // Verify the token's identity claim before ever touching the DB (QA
    // Phase 3 D-4): `userIdentity(sessionId)` is derived purely from the
    // path param, so a caller presenting a token for the wrong identity is
    // rejected with the exact same `AUTH_UNAUTHORIZED` outcome regardless of
    // whether `sessionId` happens to exist — a caller can no longer probe
    // for a live session id by comparing a 404 vs. 401 response.
    const claims = await this.liveKit.verifyToken(token);
    if (!claims || claims.identity !== userIdentity(sessionId)) {
      throw AppError.unauthorized('AUTH_UNAUTHORIZED');
    }

    const session = await this.sessions.findById(sessionId);
    if (!session || claims.roomName !== session.roomName) {
      // Non-existent session and a room mismatch both collapse to the same
      // generic auth failure, for the same enumeration-resistance reason.
      throw AppError.unauthorized('AUTH_UNAUTHORIZED');
    }

    const wasAlreadyEnded = session.status === 'ended';
    await this.applyEvent.execute(session, 'ended');
    await this.liveKit.deleteRoom(session.roomName);

    // Mint the post-call summary token only the first time this session
    // reaches `ended` (FR-CALL-4). A duplicate end-call still returns
    // `{status:"ended"}` (FR-TRANSPORT-4 idempotency) but cannot re-hand out
    // the raw token — only its one-way hash is ever persisted.
    if (wasAlreadyEnded || session.summaryTokenHash) {
      return { status: 'ended' };
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + SUMMARY_TOKEN_TTL_MS);
    await this.sessions.setSummaryToken(sessionId, tokenHash, expiresAt);

    return {
      status: 'ended',
      summary_token: rawToken,
      summary_token_expires_at: expiresAt.toISOString(),
    };
  }
}
