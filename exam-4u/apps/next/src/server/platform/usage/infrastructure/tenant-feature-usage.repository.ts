import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

/**
 * Data access over `platform.tenant_feature_usage` (LLD §9.5, FR-PKG-5) — ported verbatim from
 * `legacy/api/src/platform/usage/infrastructure/repositories/tenant-feature-usage.repository.ts`.
 * Deliberately uses raw parameterized SQL (matching this codebase's existing pattern for atomic
 * upserts — see `TenantSubscriptionRepository.upsertForTenant`) rather than TypeORM's query builder:
 * TypeORM's `.orUpdate()` overwrite clause replaces a column with the *proposed* value, it cannot
 * express `count = count + 1` against the *current* row value, which is exactly what the atomicity
 * guarantee below depends on.
 */
export class TenantFeatureUsageRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Current usage count for a tenant+feature+period, or `0` if no row exists yet (a feature never
   * used this period has an implicit count of zero — no row is created just to read it). */
  async getCount(tenantId: string, featureId: string, periodKey: string): Promise<number> {
    const rows: { count: number }[] = await this.dataSource.query(
      'SELECT count FROM tenant_feature_usage WHERE tenant_id = ? AND feature_id = ? AND period_key = ?',
      [tenantId, featureId, periodKey],
    );
    return rows[0]?.count ?? 0;
  }

  /**
   * Atomically increments the usage counter by one (LLD §9.5: "a single atomic upsert keyed on
   * tenant+feature+period, so two concurrent increments never clobber each other's count"). MySQL
   * serializes concurrent `INSERT ... ON DUPLICATE KEY UPDATE` statements against the same unique-key
   * row (an implicit row-level lock is taken for the duration of each statement), which is what makes
   * this safe under real concurrent load.
   *
   * Deliberately does **not** also check the limit in the same statement (FR-PKG-5's documented
   * accepted trade-off, ported verbatim from legacy — see `FeatureUsageService.checkAndIncrement`'s
   * own doc comment): the limit check reads the count *before* calling this method, so a burst of
   * concurrent requests arriving at the exact limit boundary can allow a small overrun. What *is*
   * guaranteed atomic is the increment itself — two concurrent increments never clobber each other's
   * count.
   */
  async incrementCount(tenantId: string, featureId: string, periodKey: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO tenant_feature_usage (id, tenant_id, feature_id, period_key, count)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE count = count + 1`,
      [randomUUID(), tenantId, featureId, periodKey],
    );
  }
}
