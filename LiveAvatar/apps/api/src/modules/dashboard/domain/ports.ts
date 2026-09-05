/** Cross-tenant aggregation reads for the Dashboard screen (FR-DASH-1). */
export interface DashboardStatsRepositoryPort {
  /** @param tenantIds - `null` = every tenant (operator, no filter) */
  countActiveTenants(tenantIds: string[] | null): Promise<number>;

  /**
   * Session volume within `[from, to]`, broken down the way FR-DASH-1 names:
   * `started` counts every session begun in the window regardless of its
   * current status; `ended`/`failed`/`abandoned` count sessions whose
   * terminal status matches and which began in the same window.
   */
  countSessionsByOutcome(
    tenantIds: string[] | null,
    from: Date,
    to: Date,
  ): Promise<{ started: number; ended: number; failed: number; abandoned: number }>;
}

export const DASHBOARD_STATS_REPOSITORY = Symbol('DASHBOARD_STATS_REPOSITORY');
