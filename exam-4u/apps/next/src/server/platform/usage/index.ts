import { getEnv } from '@/server/config';
import { getPlatformDataSource } from '@/server/infrastructure/database';
import { getBillingRepositories } from '@/server/platform/billing';
import { TenantFeatureUsageRepository } from './infrastructure/tenant-feature-usage.repository';
import { FeatureUsageService } from './application/feature-usage.service';
import { requireFeatureLimit } from './api/require-feature-limit';

export { TenantFeatureUsageRepository };
export { FeatureUsageService };
export { requireFeatureLimit };
export type { FeatureUsageSnapshotItem, ResetPeriod } from './domain/usage.types';
export { derivePeriodKey, deriveResetsAt } from './domain/usage.types';
export { FeatureLimitReachedError, FeatureNotEnabledError } from './domain/errors';

/**
 * `server/platform/usage`'s public barrel — FR-PKG-5's feature-usage-limit enforcement engine, ported
 * from `legacy/api/src/platform/usage/**` by the post-Phase-10-e2e closure dispatch (Phase 10's own e2e
 * validation pass confirmed this module was never ported to `apps/next` by any of phases 0-9 — see
 * `docs/plans/nextjs-rewrite-phase10-plan.md`'s "Post-e2e closure" section). Nothing outside this
 * module may import `./domain/**`/`./infrastructure/**`/`./application/**`/`./api/**` directly
 * (enforced by `apps/next/.eslintrc.cjs`'s `platform/usage` module-boundary rule).
 *
 * Depends on `server/platform/billing`'s already-real `FeatureRepository`/`PackageRepository`/
 * `PackageFeatureRepository`/`TenantSubscriptionRepository` (Phase 1a/2b/2c) via its public barrel —
 * this module adds no new platform-schema repositories for those tables, only the
 * `tenant_feature_usage` counter's own repository plus the enforcement/read-snapshot service.
 */
declare global {
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandFeatureUsageService: Promise<FeatureUsageService> | undefined;
}

/** Composition root for {@link FeatureUsageService} — cached on `globalThis` for the same Next.js
 * dev-hot-reload reason every other async platform-schema singleton in this app is (see
 * `server/platform/billing/index.ts`'s `getBillingRepositories()` for the identical pattern). Reuses
 * `platform/billing`'s own cached repositories rather than constructing duplicate ones against the
 * same `DataSource`. */
export async function getFeatureUsageService(): Promise<FeatureUsageService> {
  if (!globalThis.__examlandFeatureUsageService) {
    globalThis.__examlandFeatureUsageService = Promise.all([getBillingRepositories(), getPlatformDataSource()]).then(
      ([billing, platformDataSource]) => {
        const env = getEnv();
        return new FeatureUsageService(
          billing.features,
          billing.packages,
          billing.packageFeatures,
          billing.subscriptions,
          new TenantFeatureUsageRepository(platformDataSource),
          env.FALLBACK_PACKAGE_KEY,
        );
      },
    );
  }
  return globalThis.__examlandFeatureUsageService;
}
