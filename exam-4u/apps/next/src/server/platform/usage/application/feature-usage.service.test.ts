import { describe, expect, it, vi } from 'vitest';
import { FeatureUsageService } from './feature-usage.service';
import { FeatureLimitReachedError, FeatureNotEnabledError } from '../domain/errors';
import type { TenantFeatureUsageRepository } from '../infrastructure/tenant-feature-usage.repository';
import type { FeatureEntity, PackageEntity, PackageFeatureEntity, TenantSubscriptionEntity } from '@/server/infrastructure/database';
import type { FeatureRepository, PackageFeatureRepository, PackageRepository, TenantSubscriptionRepository } from '@/server/platform/billing';

/** Pure fake-repository unit tests, ported (behavior 1:1) from
 * `legacy/api/src/platform/usage/application/feature-usage.service.spec.ts` — adapted to this app's
 * vitest/`vi.fn()` convention and to `FeatureUsageService`'s own last constructor param being a plain
 * `fallbackPackageKey: string` (matching `SubscriptionAdminService`'s narrow-config-injection
 * precedent) rather than legacy's whole `AppConfigService`. */

const FEATURE: FeatureEntity = {
  id: 'feature-1',
  key: 'exams.create',
  name: 'Exam creation',
  description: null,
  unit: 'exams',
  resetPeriod: 'MONTHLY',
  createdAt: new Date(),
};

const OWN_PACKAGE: PackageEntity = {
  id: 'pkg-own',
  key: 'pro',
  name: 'Pro',
  description: null,
  priceCents: 4900,
  currency: 'usd',
  stripePriceId: null,
  isActive: true,
  sortOrder: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const FALLBACK_PACKAGE: PackageEntity = { ...OWN_PACKAGE, id: 'pkg-fallback', key: 'starter', name: 'Starter' };

function subscription(status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED', packageId = OWN_PACKAGE.id): TenantSubscriptionEntity {
  return {
    id: 'sub-1',
    tenantId: 'tenant-1',
    packageId,
    status,
    providerCustomerId: null,
    providerSubscriptionId: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function packageFeature(overrides: Partial<PackageFeatureEntity> = {}): PackageFeatureEntity {
  return { id: 'pf-1', packageId: OWN_PACKAGE.id, featureId: FEATURE.id, limit: null, enabled: true, ...overrides };
}

interface Mocks {
  features: FeatureRepository;
  packages: PackageRepository;
  packageFeatures: PackageFeatureRepository;
  subscriptions: TenantSubscriptionRepository;
  usage: TenantFeatureUsageRepository;
}

function buildService(overrides: Partial<{ [K in keyof Mocks]: Partial<Record<string, ReturnType<typeof vi.fn>>> }> = {}) {
  const mocks: Mocks = {
    features: { findByKey: vi.fn(async () => FEATURE), findAll: vi.fn(async () => [FEATURE]) } as unknown as FeatureRepository,
    packages: {
      findByKey: vi.fn(async () => FALLBACK_PACKAGE),
      findById: vi.fn(async () => OWN_PACKAGE),
    } as unknown as PackageRepository,
    packageFeatures: {
      findByPackageAndFeature: vi.fn(async () => packageFeature()),
      findByPackageId: vi.fn(async () => [packageFeature()]),
    } as unknown as PackageFeatureRepository,
    subscriptions: { findByTenantId: vi.fn(async () => subscription('ACTIVE')) } as unknown as TenantSubscriptionRepository,
    usage: {
      getCount: vi.fn(async () => 0),
      incrementCount: vi.fn(async () => undefined),
    } as unknown as TenantFeatureUsageRepository,
  };
  Object.assign(mocks.features, overrides.features);
  Object.assign(mocks.packages, overrides.packages);
  Object.assign(mocks.packageFeatures, overrides.packageFeatures);
  Object.assign(mocks.subscriptions, overrides.subscriptions);
  Object.assign(mocks.usage, overrides.usage);

  const service = new FeatureUsageService(mocks.features, mocks.packages, mocks.packageFeatures, mocks.subscriptions, mocks.usage, 'starter');
  return { service, ...mocks };
}

describe('FeatureUsageService', () => {
  describe('checkAndIncrement', () => {
    it('fails closed if the feature key is not in the catalog at all', async () => {
      const { service } = buildService({ features: { findByKey: vi.fn(async () => null) } });
      await expect(service.checkAndIncrement('tenant-1', 'unknown.feature')).rejects.toBeInstanceOf(FeatureNotEnabledError);
    });

    it('FR-PKG-4: a tenant with no subscription record is treated as zero enabled features, not unlimited', async () => {
      const { service, usage } = buildService({ subscriptions: { findByTenantId: vi.fn(async () => null) } });
      await expect(service.checkAndIncrement('tenant-1', 'exams.create')).rejects.toBeInstanceOf(FeatureNotEnabledError);
      expect(usage.incrementCount).not.toHaveBeenCalled();
    });

    it('DEFAULT-DENY (FR-PKG-3): a feature absent from the package configuration (no package_feature row) is denied, not allowed', async () => {
      const { service, usage } = buildService({ packageFeatures: { findByPackageAndFeature: vi.fn(async () => null) } });
      await expect(service.checkAndIncrement('tenant-1', 'exams.create')).rejects.toBeInstanceOf(FeatureNotEnabledError);
      expect(usage.incrementCount).not.toHaveBeenCalled();
    });

    it('denies a feature explicitly configured as enabled=false on the package', async () => {
      const { service, usage } = buildService({
        packageFeatures: { findByPackageAndFeature: vi.fn(async () => packageFeature({ enabled: false })) },
      });
      await expect(service.checkAndIncrement('tenant-1', 'exams.create')).rejects.toBeInstanceOf(FeatureNotEnabledError);
      expect(usage.incrementCount).not.toHaveBeenCalled();
    });

    it('allows and increments when the feature is enabled with no limit (unlimited) — never even reads the count', async () => {
      const { service, usage } = buildService();
      await service.checkAndIncrement('tenant-1', 'exams.create');
      expect(usage.getCount).not.toHaveBeenCalled();
      expect(usage.incrementCount).toHaveBeenCalledWith('tenant-1', FEATURE.id, expect.any(String));
    });

    it('allows and increments when usage is below the configured limit', async () => {
      const { service, usage } = buildService({
        packageFeatures: { findByPackageAndFeature: vi.fn(async () => packageFeature({ limit: 5 })) },
        usage: { getCount: vi.fn(async () => 4) },
      });
      await service.checkAndIncrement('tenant-1', 'exams.create');
      expect(usage.incrementCount).toHaveBeenCalled();
    });

    it('FEATURE_LIMIT_REACHED: rejects (without incrementing) once usage has reached the configured limit, naming feature/limit/resetsAt', async () => {
      const { service, usage } = buildService({
        packageFeatures: { findByPackageAndFeature: vi.fn(async () => packageFeature({ limit: 5 })) },
        usage: { getCount: vi.fn(async () => 5) },
      });

      const err = await service.checkAndIncrement('tenant-1', 'exams.create').catch((e) => e);
      expect(err).toBeInstanceOf(FeatureLimitReachedError);
      expect(err.code).toBe('FEATURE_LIMIT_REACHED');
      expect(err.details).toEqual({ feature: 'exams.create', limit: 5, resetsAt: expect.any(String) });
      expect(usage.incrementCount).not.toHaveBeenCalled();
    });

    it("PAST_DUE retains the tenant's own package limits unchanged (no fallback, no downgrade — FR-PKG-6)", async () => {
      const { service, packages, subscriptions } = buildService({
        subscriptions: { findByTenantId: vi.fn(async () => subscription('PAST_DUE')) },
      });
      await service.checkAndIncrement('tenant-1', 'exams.create');
      expect(packages.findById).toHaveBeenCalledWith(OWN_PACKAGE.id);
      expect(packages.findByKey).not.toHaveBeenCalled();
      expect(subscriptions.findByTenantId).toHaveBeenCalledWith('tenant-1');
    });

    it('CANCELED falls back to the fallbackPackageKey package (FR-PKG-6)', async () => {
      const { service, packages, packageFeatures } = buildService({
        subscriptions: { findByTenantId: vi.fn(async () => subscription('CANCELED')) },
        packageFeatures: { findByPackageAndFeature: vi.fn(async () => packageFeature({ packageId: FALLBACK_PACKAGE.id })) },
      });
      await service.checkAndIncrement('tenant-1', 'exams.create');
      expect(packages.findByKey).toHaveBeenCalledWith('starter');
      expect(packageFeatures.findByPackageAndFeature).toHaveBeenCalledWith(FALLBACK_PACKAGE.id, FEATURE.id);
    });

    it('FAIL-CLOSED EXIT GATE: a CANCELED subscription whose fallback package is missing from the catalog denies (zero features), never keeps the old paid-plan limits', async () => {
      const { service, usage } = buildService({
        subscriptions: { findByTenantId: vi.fn(async () => subscription('CANCELED')) },
        packages: { findByKey: vi.fn(async () => null) },
      });
      await expect(service.checkAndIncrement('tenant-1', 'exams.create')).rejects.toBeInstanceOf(FeatureNotEnabledError);
      expect(usage.incrementCount).not.toHaveBeenCalled();
    });
  });

  describe('getUsageSnapshot', () => {
    it('returns an empty snapshot for a tenant with no subscription (fail closed, not a crash)', async () => {
      const { service } = buildService({ subscriptions: { findByTenantId: vi.fn(async () => null) } });
      await expect(service.getUsageSnapshot('tenant-1')).resolves.toEqual([]);
    });

    it('returns an empty snapshot for a CANCELED subscription with a missing fallback package', async () => {
      const { service } = buildService({
        subscriptions: { findByTenantId: vi.fn(async () => subscription('CANCELED')) },
        packages: { findByKey: vi.fn(async () => null) },
      });
      await expect(service.getUsageSnapshot('tenant-1')).resolves.toEqual([]);
    });

    it('reports every catalog feature, marking one absent from the package configuration as disabled (default-deny)', async () => {
      const otherFeature: FeatureEntity = { ...FEATURE, id: 'feature-2', key: 'pdf.generations' };
      const { service } = buildService({
        features: { findAll: vi.fn(async () => [FEATURE, otherFeature]) },
        packageFeatures: { findByPackageId: vi.fn(async () => [packageFeature({ limit: 5 })]) },
        usage: { getCount: vi.fn(async () => 2) },
      });

      const snapshot = await service.getUsageSnapshot('tenant-1');
      expect(snapshot).toEqual([
        expect.objectContaining({ featureKey: 'exams.create', enabled: true, limit: 5, used: 2, remaining: 3 }),
        expect.objectContaining({ featureKey: 'pdf.generations', enabled: false, limit: null, used: 0, remaining: null }),
      ]);
    });
  });
});
