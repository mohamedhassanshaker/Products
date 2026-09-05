import { Inject, Injectable } from '@nestjs/common';
import type { DashboardSummaryQuery, DashboardSummaryResponse } from '@liveavatar/contracts';
import { isOperator, type AdminActor } from '../../../common/auth/admin-actor';
import { DASHBOARD_STATS_REPOSITORY, type DashboardStatsRepositoryPort } from '../domain/ports';

const RANGE_MS: Record<'1h' | '24h' | '7d', number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

/**
 * `GET /dashboard/summary` (FR-DASH-1, Screen 1). Zero tenants returns zeros
 * for every field rather than an error/empty-state exception — the caller
 * (Angular store) decides whether to show the "No deployments yet" empty
 * state based on `active_deployments === 0`.
 */
@Injectable()
export class GetDashboardSummaryUseCase {
  constructor(@Inject(DASHBOARD_STATS_REPOSITORY) private readonly stats: DashboardStatsRepositoryPort) {}

  /**
   * @param actor - Authenticated admin (operator sees all tenants, admin only assigned)
   * @param query - `{range?, tenant_id?}`
   */
  async execute(actor: AdminActor, query: DashboardSummaryQuery): Promise<DashboardSummaryResponse> {
    const range = query.range ?? '24h';
    const to = new Date();
    const from = new Date(to.getTime() - RANGE_MS[range]);

    const tenantIds = this.resolveTenantScope(actor, query.tenant_id);

    const [activeDeployments, sessions] = await Promise.all([
      this.stats.countActiveTenants(tenantIds),
      this.stats.countSessionsByOutcome(tenantIds, from, to),
    ]);

    return {
      active_deployments: activeDeployments,
      sessions,
      error_rate: sessions.started > 0 ? sessions.failed / sessions.started : 0,
      range,
    };
  }

  /** @returns `null` = no filter (operator, no tenant_id) */
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
