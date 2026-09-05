import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { HOP_REPOSITORY, type HopRepositoryPort } from '../../sessions';
import { SESSION_SEARCH_REPOSITORY, type SessionSearchRepositoryPort } from '../domain/ports';
import { toHopCycles } from './session-log-dto';

/** `GET /sessions/{id}/hops` (FR-SESS-3). */
@Injectable()
export class GetHopsUseCase {
  constructor(
    @Inject(SESSION_SEARCH_REPOSITORY) private readonly search: SessionSearchRepositoryPort,
    @Inject(HOP_REPOSITORY) private readonly hops: HopRepositoryPort,
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

    const rows = await this.hops.listBySession(id);
    return { cycles: toHopCycles(rows) };
  }
}
