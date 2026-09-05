import { getEnv } from '@/server/config';
import { getPlatformDataSource } from '@/server/infrastructure/database';
import { getBillingRepositories } from '@/server/platform/billing';
import { TenantFeatureUsageRepository } from '../infrastructure/tenant-feature-usage.repository';
import { FeatureUsageService } from '../application/feature-usage.service';

/**
 * The Route-Handler-callable equivalent of legacy's `FeatureLimitGuard`/`@RequiresFeature` decorator
 * pair (LLD §8.1's `PermissionsGuard` **then** `FeatureLimitGuard` order) — this app has no NestJS
 * guard/decorator mechanism, so every feature-limited Route Handler calls this helper explicitly,
 * after `requirePermission` (mirroring `requirePermission`'s own doc comment on ordering: authorization
 * must already be proven before usage is metered).
 *
 * A Route Handler with no usage-metering requirement simply never calls this function — the exact
 * equivalent of legacy's "no `@RequiresFeature` metadata → not usage-metered" branch.
 *
 * @param tenantId The already-resolved, ALS-derived tenant id (the caller's own `requireTenantId()`
 *   result) — never a route parameter, so there is no cross-tenant id to tamper with.
 * @param featureKey The catalog `feature.key` this action consumes (e.g. `'exams.create'`).
 * @throws {import('../domain/errors').FeatureNotEnabledError} if the tenant's effective package does
 *   not enable this feature at all (default-deny).
 * @throws {import('../domain/errors').FeatureLimitReachedError} if the tenant's package limit for this
 *   feature+period has already been reached.
 *
 * **Deliberately builds a fresh `FeatureUsageService` per call** (reusing `platform/billing`'s own
 * cached repositories and the cached platform `DataSource` — only the cheap, side-effect-free service
 * object itself is constructed fresh) rather than routing through this module's own barrel
 * (`@/server/platform/usage`'s `getFeatureUsageService()`) — importing the barrel from one of its own
 * internal `api/**` files would create a circular module reference; this mirrors `server/rbac`'s
 * `requirePermission()`, which builds its own fresh `PermissionResolutionService` per call for the
 * identical reason (see that file's own doc comment).
 */
export async function requireFeatureLimit(tenantId: string, featureKey: string): Promise<void> {
  const [billing, platformDataSource, env] = await Promise.all([getBillingRepositories(), getPlatformDataSource(), getEnv()]);
  const service = new FeatureUsageService(
    billing.features,
    billing.packages,
    billing.packageFeatures,
    billing.subscriptions,
    new TenantFeatureUsageRepository(platformDataSource),
    env.FALLBACK_PACKAGE_KEY,
  );
  await service.checkAndIncrement(tenantId, featureKey);
}
