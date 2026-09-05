import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { isOperator } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../domain/ports';
import { toTenantListItemDto } from './tenant-dto';

const MAX_PAGE_SIZE = 100;

/**
 * Lists tenants for Screen 3 (FR-TENANT-2). Operators see every tenant;
 * admins see only tenants they are assigned to — an empty list, never 403.
 */
@Injectable()
export class ListTenantsUseCase {
  constructor(@Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort) {}

  /**
   * @param actor - Authenticated admin
   * @param query - Search/filter/pagination
   */
  async execute(
    actor: AdminActor,
    query: { q?: string; status?: 'active' | 'paused'; page?: number; page_size?: number },
  ) {
    const page = query.page && query.page >= 1 ? query.page : 1;
    const pageSize = query.page_size ?? 25;
    if (pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw AppError.badRequest('PAGE_SIZE_INVALID');
    }

    const { items, total } = await this.tenants.list({
      q: query.q,
      status: query.status,
      page,
      pageSize,
      tenantIds: isOperator(actor) ? null : actor.tenantIds,
    });

    return {
      items: items.map(toTenantListItemDto),
      total,
      page,
      page_size: pageSize,
    };
  }
}
