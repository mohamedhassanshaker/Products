import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { UTTERANCE_REPOSITORY, type UtteranceRepositoryPort } from '../../sessions';
import { SESSION_SEARCH_REPOSITORY, type SessionSearchRepositoryPort } from '../domain/ports';
import { toTranscriptItemDto } from './session-log-dto';

/** `GET /sessions/{id}/transcript` (FR-SESS-2). */
@Injectable()
export class GetTranscriptUseCase {
  constructor(
    @Inject(SESSION_SEARCH_REPOSITORY) private readonly search: SessionSearchRepositoryPort,
    @Inject(UTTERANCE_REPOSITORY) private readonly utterances: UtteranceRepositoryPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param id - Path `:id`
   */
  async execute(actor: AdminActor, id: string) {
    const session = await this.search.findDetail(id);
    if (!session || !canAccessTenant(actor, session.tenantId)) {
      throw AppError.notFound('SESSION_NOT_FOUND');
    }
    if (session.transcriptPurged) {
      throw new AppError('TRANSCRIPT_PURGED', 410);
    }

    const rows = await this.utterances.listBySession(id);
    return { items: rows.map(toTranscriptItemDto) };
  }
}
