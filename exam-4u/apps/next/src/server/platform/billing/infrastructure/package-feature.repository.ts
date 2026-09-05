import { randomUUID } from 'node:crypto';
import type { DataSource, Repository } from 'typeorm';
import { PackageFeatureEntity } from '@/server/infrastructure/database';

/**
 * Data access over `platform.package_feature` — Phase 1a built the read path (`findByPackageId`); this
 * dispatch (migration plan Phase 2 sub-slice "2b", FR-PKG-3/FR-PKG-7) adds {@link replaceForPackage},
 * the single write path this table gets — ported from
 * `legacy/api/src/platform/packages/infrastructure/repositories/package-feature.repository.ts`'s
 * "atomic full replace" behind `PUT /platform/packages/:id/features`.
 */
export class PackageFeatureRepository {
  private readonly repo: Repository<PackageFeatureEntity>;

  constructor(private readonly dataSource: DataSource) {
    // String-name lookup, not the class reference (fixed Phase 1 sub-slice 1b — see
    // `server/tenancy/raw-tenant-lookup.ts`'s doc comment for the cross-webpack-bundle
    // entity-class-identity mismatch this avoids).
    this.repo = dataSource.getRepository<PackageFeatureEntity>('package_feature');
  }

  /** Every `package_feature` row configured for one package — used by the Platform Admin
   * package-detail response to pre-populate the feature-configuration matrix's checked/limit state,
   * and by a future feature-usage-enforcement phase's read path. Absent-from-this-list = disabled
   * (default-deny, FR-PKG-3). */
  async findByPackageId(packageId: string): Promise<PackageFeatureEntity[]> {
    return this.repo.find({ where: { packageId } });
  }

  /** A single `(package, feature)` configuration row, or `null` if the pair is absent (default-deny,
   * FR-PKG-3 — the caller, `FeatureUsageService.resolveEffectivePackageFeature`, must treat `null`
   * identically to an `enabled=false` row, never as "unlimited"/"allowed"). Added by the
   * post-Phase-10-e2e closure dispatch that ports `platform/usage` — this is the sole read path
   * `FeatureUsageService.checkAndIncrement` needs per gated request (one row, not the whole package's
   * configuration). */
  async findByPackageAndFeature(packageId: string, featureId: string): Promise<PackageFeatureEntity | null> {
    return this.repo.findOne({ where: { packageId, featureId } });
  }

  /**
   * Atomically replaces a package's entire feature configuration: deletes every existing
   * `package_feature` row for `packageId`, then inserts exactly the given `items` (each becomes an
   * `enabled=true` row with its given `limit`; a catalog feature simply omitted from `items` ends up
   * with no row at all, i.e. disabled by default-deny). Runs inside one transaction so a mid-replace
   * failure can never leave the package with a half-old/half-new configuration.
   *
   * Caller (`PackagesService.replaceFeatures`) has already validated every `featureId` exists
   * (`FEATURE_NOT_FOUND` otherwise) and that `packageId` itself exists — this method trusts both.
   */
  async replaceForPackage(packageId: string, items: { featureId: string; limit: number | null }[]): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // String-name deletes/inserts, not the entity class — the same cross-webpack-bundle
      // entity-class-identity concern `PlatformTenantRepository`'s doc comment documents applies to
      // `EntityManager.delete`/`create`/`save` calls too (they resolve metadata the same way
      // `getRepository(EntityClass)` does), so this transaction uses the literal table name
      // throughout rather than the `PackageFeatureEntity` class reference.
      await manager.delete('package_feature', { packageId });
      if (items.length === 0) return;
      const rows = items.map((item) => ({
        id: randomUUID(),
        packageId,
        featureId: item.featureId,
        limit: item.limit,
        enabled: true,
      }));
      await manager.insert('package_feature', rows);
    });
  }
}
