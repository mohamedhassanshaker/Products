import type { FeatureEntity, PackageEntity } from '@/server/infrastructure/database';
import type { FeatureRepository, PackageFeatureRepository, PackageRepository, TenantSubscriptionRepository } from '@/server/platform/billing';
import { FeatureLimitReachedError, FeatureNotEnabledError } from '../domain/errors';
import { derivePeriodKey, deriveResetsAt, type FeatureUsageSnapshotItem } from '../domain/usage.types';
import type { TenantFeatureUsageRepository } from '../infrastructure/tenant-feature-usage.repository';

/**
 * FR-PKG-5's enforcement engine (LLD §9.5's pseudocode, implemented verbatim) — ported from
 * `legacy/api/src/platform/usage/application/feature-usage.service.ts`. The sole place
 * `requireFeatureLimit` (this module's Route-Handler-callable equivalent of legacy's
 * `FeatureLimitGuard`) calls into — no Route Handler/service outside this class ever queries
 * `package_feature`/`tenant_feature_usage` directly, so this is the single chokepoint for every
 * gated-action decision (mirroring `PermissionResolutionService`'s role for RBAC).
 *
 * **Fail-closed by construction — every branch that cannot resolve a real, enabled, in-limit feature
 * throws; there is no default-allow path**:
 * - No subscription record at all → `FeatureNotEnabledError` (FR-PKG-4: "a tenant with no
 *   subscription record... is treated as having zero enabled features, never as unlimited").
 * - `CANCELED` subscription whose fallback package doesn't exist in the catalog → `FeatureNotEnabledError`
 *   (FR-PKG-6: "if that fallback package does not exist... the tenant is treated as having zero
 *   enabled features (fail closed)").
 * - `(package, feature)` row absent, or present with `enabled=false` → `FeatureNotEnabledError`
 *   (FR-PKG-3 default-deny — a feature absent from a package's configuration is disabled, not
 *   unlimited).
 *
 * Depends on `server/platform/billing`'s repositories via its public barrel (not deep imports) —
 * matches this app's own module-boundary convention; `platform/usage` itself is reachable only via its
 * own barrel (`@/server/platform/usage`), enforced by `apps/next/.eslintrc.cjs`.
 */
export class FeatureUsageService {
  constructor(
    private readonly features: FeatureRepository,
    private readonly packages: PackageRepository,
    private readonly packageFeatures: PackageFeatureRepository,
    private readonly subscriptions: TenantSubscriptionRepository,
    private readonly usage: TenantFeatureUsageRepository,
    /** `env.FALLBACK_PACKAGE_KEY` (defaults to `'starter'`) — the package a `CANCELED` subscription
     * falls back to (FR-PKG-6). Passed as a plain string, not the whole `EnvVars` object, matching
     * this app's own narrow-config-injection convention (e.g. `BillingCheckoutService`'s `opts`). */
    private readonly fallbackPackageKey: string,
  ) {}

  /**
   * FR-PKG-5's gated-action entry point. Reads the current count, rejects with
   * `FEATURE_LIMIT_REACHED` if the package's limit for this feature+period is already reached,
   * otherwise atomically increments the counter and lets the caller proceed.
   *
   * **Documented check-then-upsert trade-off (do not "fix" this — see LLD §9.5/FR-PKG-5, ported
   * verbatim from legacy)**: the limit read and the increment are two separate statements, not one
   * atomic compare-and-swap. At low-to-moderate concurrency this is fine; under a burst of concurrent
   * requests for the same tenant+feature arriving at the exact limit boundary, a small overrun is
   * possible. What *is* guaranteed atomic is the increment itself
   * (`TenantFeatureUsageRepository.incrementCount`) — two concurrent increments never clobber each
   * other's count.
   *
   * @throws {FeatureNotEnabledError} if the feature key is unknown, or the tenant's effective package
   *   does not enable it (default-deny).
   * @throws {FeatureLimitReachedError} if the tenant's package limit for this feature+period is already
   *   reached.
   */
  async checkAndIncrement(tenantId: string, featureKey: string): Promise<void> {
    const feature = await this.features.findByKey(featureKey);
    if (!feature) {
      // A gated Route Handler referencing a key that doesn't exist in the catalog is a developer/
      // deployment error, not a tenant-facing condition — fails closed the same as every other branch
      // here rather than assuming "unknown feature" means "unrestricted".
      throw new FeatureNotEnabledError(featureKey);
    }

    const packageFeature = await this.resolveEffectivePackageFeature(tenantId, feature);
    if (!packageFeature || !packageFeature.enabled) {
      throw new FeatureNotEnabledError(featureKey);
    }

    const periodKey = derivePeriodKey(feature.resetPeriod);
    if (packageFeature.limit !== null) {
      const count = await this.usage.getCount(tenantId, feature.id, periodKey);
      if (count >= packageFeature.limit) {
        throw new FeatureLimitReachedError(featureKey, packageFeature.limit, deriveResetsAt(feature.resetPeriod));
      }
    }

    await this.usage.incrementCount(tenantId, feature.id, periodKey);
  }

  /**
   * Self-service usage/quota read (FR-PKG-5: "readable by that tenant's Admin, not only by Platform
   * Admins"). Read-only — never increments anything. Reports every feature the tenant's effective
   * package configures (enabled or not), so a Tenant Admin can see what's unavailable on their plan,
   * not just what they've already used.
   */
  async getUsageSnapshot(tenantId: string): Promise<FeatureUsageSnapshotItem[]> {
    const subscription = await this.subscriptions.findByTenantId(tenantId);
    if (!subscription) return [];

    const pkg = await this.resolveEffectivePackage(subscription.status, subscription.packageId);
    if (!pkg) return [];

    const [allFeatures, packageFeatures] = await Promise.all([
      this.features.findAll(),
      this.packageFeatures.findByPackageId(pkg.id),
    ]);
    const byFeatureId = new Map(packageFeatures.map((pf) => [pf.featureId, pf]));

    const items: FeatureUsageSnapshotItem[] = [];
    for (const feature of allFeatures) {
      const pf = byFeatureId.get(feature.id);
      const enabled = pf?.enabled ?? false; // absent row = default-deny (FR-PKG-3)
      const limit = enabled ? (pf?.limit ?? null) : null;
      const periodKey = derivePeriodKey(feature.resetPeriod);
      const used = enabled ? await this.usage.getCount(tenantId, feature.id, periodKey) : 0;
      items.push({
        featureKey: feature.key,
        featureName: feature.name,
        unit: feature.unit,
        enabled,
        limit,
        used,
        remaining: enabled && limit !== null ? Math.max(limit - used, 0) : null,
        resetsAt: enabled ? (deriveResetsAt(feature.resetPeriod)?.toISOString() ?? null) : null,
      });
    }
    return items;
  }

  /** FR-PKG-4/6's package-resolution rule: `ACTIVE`/`PAST_DUE` use the tenant's own assigned package
   * unchanged (a `PAST_DUE` grace period never downgrades limits); `CANCELED` falls back to the fixed
   * `fallbackPackageKey` package, or fails closed (`null`) if that package is itself missing from the
   * catalog. */
  private async resolveEffectivePackage(
    status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED',
    ownPackageId: string,
  ): Promise<PackageEntity | null> {
    if (status === 'CANCELED') {
      return this.packages.findByKey(this.fallbackPackageKey);
    }
    return this.packages.findById(ownPackageId);
  }

  private async resolveEffectivePackageFeature(tenantId: string, feature: FeatureEntity) {
    const subscription = await this.subscriptions.findByTenantId(tenantId);
    if (!subscription) return null; // FR-PKG-4: no subscription ⇒ zero features

    const pkg = await this.resolveEffectivePackage(subscription.status, subscription.packageId);
    if (!pkg) return null; // FR-PKG-6: fallback package missing ⇒ fail closed

    return this.packageFeatures.findByPackageAndFeature(pkg.id, feature.id);
  }
}
