import { Inject, Injectable } from '@nestjs/common';
import type { ListAlertsQuery } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { ALERT_REPOSITORY, type AlertRepositoryPort } from '../../sessions';

const DEFAULT_WINDOW_DAYS = 7;

/** `GET /tenants/{id}/alerts` (FR-ALERT-4). Default window is the last 7 days. */
@Injectable()
export class ListAlertsUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(ALERT_REPOSITORY) private readonly alerts: AlertRepositoryPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path `:id`
   * @param query - `{type?, from?, to?, page}`
   */
  async execute(actor: AdminActor, tenantId: string, query: ListAlertsQuery) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || !canAccessTenant(actor, tenant.id)) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }

    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    if (from.getTime() > to.getTime()) {
      throw AppError.badRequest('SESS_RANGE_INVALID');
    }

    const page = query.page && query.page >= 1 ? query.page : 1;
    const pageSize = 25;
    const { items, total } = await this.alerts.list({ tenantId, type: query.type, from, to, page, pageSize });

    return {
      items: items.map((row) => ({ id: row.id, type: row.type, message: row.message, created_at: row.createdAt.toISOString() })),
      total,
    };
  }
}
