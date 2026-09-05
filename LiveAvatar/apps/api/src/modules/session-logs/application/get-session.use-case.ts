import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { userIdentity, agentIdentity } from '../../transport';
import { SESSION_SEARCH_REPOSITORY, type SessionSearchRepositoryPort } from '../domain/ports';
import { toSessionDetailDto } from './session-log-dto';

/**
 * `GET /sessions/{id}` (FR-SESS-2). Cross-tenant access collapses to the same
 * `404 SESSION_NOT_FOUND` as a genuinely unknown id (LLD §5.1's cross-tenant
 * rule) — never a `403`, so a session id alone can't be used to probe which
 * tenant it belongs to.
 */
@Injectable()
export class GetSessionUseCase {
  constructor(@Inject(SESSION_SEARCH_REPOSITORY) private readonly search: SessionSearchRepositoryPort) {}

  /**
   * @param actor - Authenticated admin
   * @param id - Path `:id`
   */
  async execute(actor: AdminActor, id: string) {
    const session = await this.search.findDetail(id);
    if (!session || !canAccessTenant(actor, session.tenantId)) {
      throw AppError.notFound('SESSION_NOT_FOUND');
    }

    // No separate participants table is persisted anywhere (LiveKit itself
    // is the source of truth for who is actually in the room at any given
    // moment); `userIdentity`/`agentIdentity` are the exact, deterministic
    // identities `IssueConversationTokenUseCase` mints tokens for (LLD §8.3),
    // so they are the correct "who was in this room" answer for a v1 audit
    // view without needing a live LiveKit room query.
    const participantIdentities = [userIdentity(session.id), agentIdentity(session.id)];

    return toSessionDetailDto(session, participantIdentities);
  }
}
