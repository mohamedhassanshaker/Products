import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * TypeORM mapping for `platform.tenant_feature_usage` (LLD §4 DDL, FR-PKG-5) — ported verbatim from
 * `legacy/api/src/infrastructure/database/platform/entities/tenant-feature-usage.entity.ts`. One row
 * per `(tenant, feature, periodKey)` — `periodKey` is derived, never stored elsewhere (see
 * `server/platform/usage`'s `derivePeriodKey`: `'YYYY-MM'` for `MONTHLY`, `'YYYY-MM-DD'` for `DAILY`,
 * the literal `'lifetime'` for `NONE`). The `uq_usage` unique key (see this entity's own migration) is
 * what makes `TenantFeatureUsageRepository.incrementCount`'s `INSERT ... ON DUPLICATE KEY UPDATE
 * count = count + 1` atomic across concurrent requests for the same tenant+feature+period (LLD §9.5).
 *
 * Lives on the **platform** schema (not per-tenant) — mirrors legacy's placement, since the
 * feature-usage-enforcement engine (`FeatureUsageService`) already depends on the platform-schema
 * `package`/`feature`/`package_feature`/`tenant_subscription` tables to resolve a tenant's effective
 * limit; keeping the counter itself on the same schema avoids a cross-schema join for every gated
 * request.
 */
@Entity({ name: 'tenant_feature_usage' })
export class TenantFeatureUsageEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'tenant_id', type: 'char', length: 36 })
  tenantId!: string;

  @Column({ name: 'feature_id', type: 'char', length: 36 })
  featureId!: string;

  @Column({ name: 'period_key', type: 'varchar', length: 20 })
  periodKey!: string;

  @Column({ type: 'int', default: 0 })
  count!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;
}
