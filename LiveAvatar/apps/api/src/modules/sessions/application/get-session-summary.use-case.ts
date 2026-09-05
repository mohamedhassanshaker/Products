import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PublicSessionSummary } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import { SESSION_REPOSITORY, type SessionRepositoryPort } from '../domain/ports';
import { FEEDBACK_REPOSITORY, UTTERANCE_REPOSITORY, type FeedbackRepositoryPort, type UtteranceRepositoryPort } from '../domain/telemetry-ports';

/**
 * `GET /public/sessions/{id}/summary` (FR-CALL-4, Screen 11). No admin JWT —
 * gated instead by the one-time `X-Summary-Token` minted by `EndSessionUseCase`
 * (30-minute TTL). `sessionId` is resolved first so an unknown id always
 * collapses to `404 SESSION_NOT_FOUND` (FR-CALL-5) regardless of what token
 * was presented; the token itself is only checked once a real row exists.
 */
@Injectable()
export class GetSessionSummaryUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
    @Inject(UTTERANCE_REPOSITORY) private readonly utterances: UtteranceRepositoryPort,
    @Inject(FEEDBACK_REPOSITORY) private readonly feedback: FeedbackRepositoryPort,
  ) {}

  /**
   * @param sessionId - Path `:id`
   * @param presentedToken - `X-Summary-Token` header, raw (unhashed) value
   */
  async execute(sessionId: string, presentedToken: string | undefined): Promise<PublicSessionSummary> {
    const session = await this.sessions.findById(sessionId);
    if (!session) {
      throw AppError.notFound('SESSION_NOT_FOUND');
    }

    assertValidSummaryToken(session, presentedToken);

    // LLD §5.8's own error list for this exact route names `410
    // TRANSCRIPT_PURGED` — checked after the token so an expired/wrong token
    // never learns whether the transcript happens to still exist.
    if (session.transcriptPurged) {
      throw new AppError('TRANSCRIPT_PURGED', 410);
    }

    const [utteranceRows, feedbackSubmitted] = await Promise.all([
      this.utterances.listBySession(sessionId),
      this.feedback.existsForSession(sessionId),
    ]);

    return {
      status: session.status,
      summary_text: session.summaryText ?? undefined,
      summary_status: session.summaryStatus,
      transcript: utteranceRows.map((row) => ({ role: row.role, text: row.text })),
      feedback_submitted: feedbackSubmitted,
    };
  }
}

/**
 * Verifies the presented raw token against the session's one-way hash and
 * expiry (FR-CALL-4). Missing/mismatched/expired all collapse to the same
 * `401 CALL_SUMMARY_EXPIRED` — there is nothing more specific to tell a
 * caller without leaking whether a token merely expired vs. was fabricated.
 * @param session - Loaded session row (has the stored hash, if any)
 * @param presentedToken - Raw `X-Summary-Token` header value
 */
export function assertValidSummaryToken(
  session: { summaryTokenHash: string | null; summaryTokenExpiresAt: Date | null },
  presentedToken: string | undefined,
): void {
  if (!presentedToken || !session.summaryTokenHash || !session.summaryTokenExpiresAt) {
    throw AppError.unauthorized('CALL_SUMMARY_EXPIRED');
  }
  if (session.summaryTokenExpiresAt.getTime() < Date.now()) {
    throw AppError.unauthorized('CALL_SUMMARY_EXPIRED');
  }
  const presentedHash = createHash('sha256').update(presentedToken).digest('hex');
  if (presentedHash !== session.summaryTokenHash) {
    throw AppError.unauthorized('CALL_SUMMARY_EXPIRED');
  }
}
