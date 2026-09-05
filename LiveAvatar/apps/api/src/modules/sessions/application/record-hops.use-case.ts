import { Inject, Injectable } from '@nestjs/common';
import type { HopBatchRequest } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import { SESSION_REPOSITORY, type SessionRepositoryPort } from '../domain/ports';
import { HOP_REPOSITORY, type HopRepositoryPort, type HopInput } from '../domain/telemetry-ports';

/**
 * `POST /internal/sessions/{id}/hops` (NFR-1). Agent-only write path,
 * guarded by `InternalTokenGuard` at the controller.
 */
@Injectable()
export class RecordHopsUseCase {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepositoryPort,
    @Inject(HOP_REPOSITORY) private readonly hops: HopRepositoryPort,
  ) {}

  /**
   * @param sessionId - Target session
   * @param batch - Batch of hop rows to upsert
   * @throws AppError SESSION_NOT_FOUND when the session id is unknown
   */
  async execute(sessionId: string, batch: HopBatchRequest): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (!session) {
      throw AppError.notFound('SESSION_NOT_FOUND');
    }
    const items: HopInput[] = batch.items.map((item) => ({
      utteranceSeq: item.utterance_seq,
      hop: item.hop,
      firstPartialMs: item.first_partial_ms,
      firstTokenMs: item.first_token_ms,
      firstAudioMs: item.first_audio_ms,
      firstFrameMs: item.first_frame_ms,
      totalMs: item.total_ms,
      providerKey: item.provider_key,
      usedFallback: item.used_fallback,
      errorCode: item.error_code,
      nodeId: item.node_id,
      nodeType: item.node_type,
      lane: item.lane,
    }));
    await this.hops.upsertMany(sessionId, session.tenantId, items);
  }
}
