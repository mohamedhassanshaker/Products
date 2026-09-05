import { Inject, Injectable } from '@nestjs/common';
import type { FailoverStatsQuery } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { HOP_REPOSITORY, type HopRepositoryPort } from '../../sessions';

const RANGE_MS: Record<'1h' | '24h' | '7d', number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

/** `GET /tenants/{id}/failover-stats` (FR-ALERT-2). Default range: 24h. */
@Injectable()
export class GetFailoverStatsUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(HOP_REPOSITORY) private readonly hops: HopRepositoryPort,
  ) {}

  /**
   * @param actor - Authenticated admin
   * @param tenantId - Path `:id`
   * @param query - `{range?}`
   */
  async execute(actor: AdminActor, tenantId: string, query: FailoverStatsQuery) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || !canAccessTenant(actor, tenant.id)) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    const range = query.range ?? '24h';
    const since = new Date(Date.now() - RANGE_MS[range]);
    const stats = await this.hops.countLlmFailoverStats(tenantId, since);
    return {
      primary_failures: stats.primaryFailures,
      fallback_successes: stats.fallbackSuccesses,
      degraded_invocations: stats.degradedInvocations,
    };
  }
}
