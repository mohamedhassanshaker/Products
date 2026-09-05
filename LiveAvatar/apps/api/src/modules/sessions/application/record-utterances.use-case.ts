import { Inject, Injectable } from '@nestjs/common';
import type { UtteranceBatchRequest } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import { SESSION_REPOSITORY, type SessionRepositoryPort } from '../domain/ports';
import { UTTERANCE_REPOSITORY, type UtteranceRepositoryPort, type UtteranceInput } from '../domain/telemetry-ports';

/**
 * `POST /internal/sessions/{id}/utterances` (FR-CALL-3, FR-SESS-1). Agent-
 * only write path, guarded by `InternalTokenGuard` at the controller.
 */
@Injectable()
export class RecordUtterancesUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
    @Inject(UTTERANCE_REPOSITORY) private readonly utterances: UtteranceRepositoryPort,
  ) {}

  /**
   * @param sessionId - Target session
   * @param batch - Batch of utterance rows to upsert
   * @throws AppError SESSION_NOT_FOUND when the session id is unknown
   */
  async execute(sessionId: string, batch: UtteranceBatchRequest): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (!session) {
      throw AppError.notFound('SESSION_NOT_FOUND');
    }
    const items: UtteranceInput[] = batch.items.map((item) => ({
      seq: item.seq,
      role: item.role,
      text: item.text ?? null,
      startedAt: new Date(item.started_at),
      endedAt: item.ended_at ? new Date(item.ended_at) : null,
    }));
    await this.utterances.upsertMany(sessionId, session.tenantId, items);
  }
}
