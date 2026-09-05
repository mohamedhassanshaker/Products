import { Inject, Injectable } from '@nestjs/common';
import type { ListSessionsQuery } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { isOperator } from '../../../common/auth/admin-actor';
import { UTTERANCE_REPOSITORY, type UtteranceRepositoryPort } from '../../sessions';
import { SESSION_SEARCH_REPOSITORY, type SessionSearchRepositoryPort } from '../domain/ports';
import { toSessionListItemDto } from './session-log-dto';

const MAX_PAGE_SIZE = 100;

/**
 * `GET /sessions` (FR-SESS-1). Admins without an explicit `tenant_id` are
 * scoped to their own assigned tenants (a local, reversible interpretation of
 * the spec's "required for admin" — silently defaulting to "your tenants"
 * rather than erroring is consistent with every other list endpoint's
 * "empty, not a hard failure" posture; flagged in the plan doc). An admin
 * naming a `tenant_id` they are not assigned to sees an empty result (not
 * `403`) — the same posture `ListTenantsUseCase` already established.
 */
@Injectable()
export class ListSessionsUseCase {
  constructor(
    @Inject(SESSION_SEARCH_REPOSITORY) private readonly search: SessionSearchRepositoryPort,
    @Inject(UTTERANCE_REPOSITORY) private readonly utterances: UtteranceRepositoryPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param query - Search/filter/pagination
   */
  async execute(actor: AdminActor, query: ListSessionsQuery) {
    if (query.q && query.q.length > 200) {
      throw AppError.badRequest('SESS_QUERY_TOO_LONG');
    }
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from.getTime() > to.getTime()) {
      throw AppError.badRequest('SESS_RANGE_INVALID');
    }

    const page = query.page && query.page >= 1 ? query.page : 1;
    const pageSize = query.page_size ?? 25;
    if (pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw AppError.badRequest('PAGE_SIZE_INVALID');
    }

    const tenantIds = this.resolveTenantScope(actor, query.tenant_id);

    let sessionIds: string[] | undefined;
    if (query.q) {
      // A full-text match narrows to specific session ids; combined with the
      // tenant scope below via a plain `id IN (...)` filter (search itself is
      // already tenant-scoped when a single tenant_id is given).
      sessionIds = await this.utterances.searchSessionIds(
        query.q,
        tenantIds && tenantIds.length === 1 ? tenantIds[0] : undefined,
      );
    }

    const { items, total } = await this.search.search({
      tenantIds,
      sessionIds,
      from,
      to,
      status: query.status,
      page,
      pageSize,
    });

    return { items: items.map(toSessionListItemDto), total, page, page_size: pageSize };
  }

  /** @returns `null` = no filter (operator, no tenant_id); `[]`/`[id]` otherwise */
  private resolveTenantScope(actor: AdminActor, tenantId?: string): string[] | null {
    if (isOperator(actor)) {
      return tenantId ? [tenantId] : null;
    }
    if (tenantId) {
      return actor.tenantIds.includes(tenantId) ? [tenantId] : [];
    }
    return actor.tenantIds;
  }
}
