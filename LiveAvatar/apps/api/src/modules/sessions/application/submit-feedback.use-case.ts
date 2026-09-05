import { Inject, Injectable } from '@nestjs/common';
import type { PublicFeedbackRequest } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import { SESSION_REPOSITORY, type SessionRepositoryPort } from '../domain/ports';
import { FEEDBACK_REPOSITORY, type FeedbackRepositoryPort } from '../domain/telemetry-ports';
import { assertValidSummaryToken } from './get-session-summary.use-case';

/**
 * `POST /public/sessions/{id}/feedback` (FR-CALL-4). The only end-user write
 * path in the whole platform (per the backlog's own framing of BL-025) — same
 * `X-Summary-Token` gate as `GetSessionSummaryUseCase`, reused rather than
 * re-implemented.
 */
@Injectable()
export class SubmitFeedbackUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
    @Inject(FEEDBACK_REPOSITORY) private readonly feedback: FeedbackRepositoryPort,
  ) {}

  /**
   * @param sessionId - Path `:id`
   * @param presentedToken - `X-Summary-Token` header, raw (unhashed) value
   * @param body - `{rating(1-5), comment?(<=1000)}`
   */
  async execute(sessionId: string, presentedToken: string | undefined, body: PublicFeedbackRequest): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (!session) {
      throw AppError.notFound('SESSION_NOT_FOUND');
    }
    assertValidSummaryToken(session, presentedToken);

    const alreadySubmitted = await this.feedback.existsForSession(sessionId);
    if (alreadySubmitted) {
      throw AppError.conflict('FEEDBACK_ALREADY_SUBMITTED');
    }

    const result = await this.feedback.create({
      sessionId,
      tenantId: session.tenantId,
      rating: body.rating,
      comment: body.comment ?? null,
    });
    if (result === 'duplicate') {
      throw AppError.conflict('FEEDBACK_ALREADY_SUBMITTED');
    }
  }
}
