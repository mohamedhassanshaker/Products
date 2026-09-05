import { Inject, Injectable } from '@nestjs/common';
import type { SummaryRequest } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import { SESSION_REPOSITORY, type SessionRepositoryPort } from '../domain/ports';

/**
 * `POST /internal/sessions/{id}/summary` (FR-CALL-4). The agent is the only
 * writer of `Session.summaryText`/`summaryStatus` (HLD §7.3) — the control
 * plane only ever reads it back for Screen 11.
 */
@Injectable()
export class SetSessionSummaryUseCase {
  constructor(@Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort) {}

  /**
   * @param sessionId - Target session
   * @param request - `{summary_status, summary_text?}`
   * @throws AppError SESSION_NOT_FOUND when the session id is unknown
   */
  async execute(sessionId: string, request: SummaryRequest): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (!session) {
      throw AppError.notFound('SESSION_NOT_FOUND');
    }
    await this.sessions.setSummary(sessionId, request.summary_status, request.summary_text ?? null);
  }
}
