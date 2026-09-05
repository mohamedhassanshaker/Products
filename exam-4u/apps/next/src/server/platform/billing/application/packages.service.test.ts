import { describe, expect, it, vi } from 'vitest';
import { ValidationFailedError } from '@/server/common/errors/domain-error';
import { FeatureNotFoundError, PackageKeyExistsError, PackageNotFoundError } from '../domain/errors';
import type { PackageRepository } from '../infrastructure/package.repository';
import type { PackageFeatureRepository } from '../infrastructure/package-feature.repository';
import type { FeatureRepository } from '../infrastructure/feature.repository';
import { PackagesService } from './packages.service';

/** Pure-logic unit tests (fake repositories, no real database) for `PackagesService` — migration plan
 * Phase 2 sub-slice "2b"'s own "Per-phase verification" item 4. */

function createFakePackageRepo(overrides: Partial<PackageRepository> = {}): PackageRepository {
  const base: Partial<PackageRepository> = {
    findAll: vi.fn(async () => []),
    findAllActive: vi.fn(async () => []),
    findById: vi.fn(async () => null),
    existsByKey: vi.fn(async () => false),
    create: vi.fn(async (input) => ({ id: 'p1', currency: 'usd', ...input, createdAt: new Date(), updatedAt: new Date() }) as never),
    save: vi.fn(async (entity) => entity as never),
    ...overrides,
  };
  return base as PackageRepository;
}

function createFakePackageFeatureRepo(overrides: Partial<PackageFeatureRepository> = {}): PackageFeatureRepository {
  const base: Partial<PackageFeatureRepository> = {
    findByPackageId: vi.fn(async () => []),
    replaceForPackage: vi.fn(async () => undefined),
    ...overrides,
  };
  return base as PackageFeatureRepository;
}

function createFakeFeatureRepo(overrides: Partial<FeatureRepository> = {}): FeatureRepository {
  const base: Partial<FeatureRepository> = {
    findByIds: vi.fn(async () => []),
    ...overrides,
  };
  return base as FeatureRepository;
}

const baseRow = {
  id: 'p1',
  key: 'pro',
  name: 'Pro',
  description: null,
  priceCents: 2900,
  currency: 'usd',
  stripePriceId: null,
  isActive: true,
  sortOrder: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('PackagesService.create', () => {
  it('rejects a malformed key', async () => {
    const service = new PackagesService(createFakePackageRepo(), createFakePackageFeatureRepo(), createFakeFeatureRepo());
    await expect(service.create({ key: 'Bad Key!', name: 'x', priceCents: 100 })).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('rejects an already-taken key', async () => {
    const packages = createFakePackageRepo({ existsByKey: vi.fn(async () => true) });
    const service = new PackagesService(packages, createFakePackageFeatureRepo(), createFakeFeatureRepo());
    await expect(service.create({ key: 'pro', name: 'x', priceCents: 100 })).rejects.toBeInstanceOf(PackageKeyExistsError);
  });

  // Phase 10 sub-slice "10b1"'s own real `Promise.all` concurrency e2e proof found that a real
  // concurrent double-create race for the identical key produced an untranslated 500 instead of the
  // intended 409 PACKAGE_KEY_EXISTS — `existsByKey`'s pre-check passes for both concurrent callers
  // before either insert commits. This unit test locks in the fix at the unit level: a duplicate-key
  // DB error from `create()` itself (simulating the race having reached the DB) must still be
  // translated to `PackageKeyExistsError`, not rethrown raw.
  it('translates a real MySQL duplicate-key error from create() (the concurrent-race case existsByKey cannot catch) into PackageKeyExistsError', async () => {
    const dbDuplicateError = Object.assign(new Error("Duplicate entry 'pro' for key 'package.uq_package_key'"), {
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    });
    const packages = createFakePackageRepo({ create: vi.fn(async () => { throw dbDuplicateError; }) });
    const service = new PackagesService(packages, createFakePackageFeatureRepo(), createFakeFeatureRepo());
    await expect(service.create({ key: 'pro', name: 'x', priceCents: 100 })).rejects.toBeInstanceOf(PackageKeyExistsError);
  });

  it('rethrows any OTHER (non-duplicate-key) create() failure unchanged, never masking it as PackageKeyExistsError', async () => {
    const packages = createFakePackageRepo({ create: vi.fn(async () => { throw new Error('connection reset'); }) });
    const service = new PackagesService(packages, createFakePackageFeatureRepo(), createFakeFeatureRepo());
    await expect(service.create({ key: 'pro', name: 'x', priceCents: 100 })).rejects.toThrow('connection reset');
  });

  it('defaults isActive true, sortOrder 0, and currency to the platform-fixed usd', async () => {
    const packages = createFakePackageRepo();
    const service = new PackagesService(packages, createFakePackageFeatureRepo(), createFakeFeatureRepo());
    await service.create({ key: 'pro', name: 'Pro', priceCents: 2900 });
    expect(packages.create).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'pro', isActive: true, sortOrder: 0, currency: 'usd' }),
    );
  });
});

describe('PackagesService.list/listActive', () => {
  it('list() returns every package', async () => {
    const packages = createFakePackageRepo({ findAll: vi.fn(async () => [{ ...baseRow }]) });
    const service = new PackagesService(packages, createFakePackageFeatureRepo(), createFakeFeatureRepo());
    const result = await service.list();
    expect(result).toEqual([expect.objectContaining({ id: 'p1', key: 'pro' })]);
  });

  it('listActive() delegates to the active-only read path', async () => {
    const packages = createFakePackageRepo({ findAllActive: vi.fn(async () => [{ ...baseRow }]) });
    const service = new PackagesService(packages, createFakePackageFeatureRepo(), createFakeFeatureRepo());
    const result = await service.listActive();
    expect(packages.findAllActive).toHaveBeenCalled();
    expect(result).toEqual([expect.objectContaining({ id: 'p1', isActive: true })]);
  });
});

describe('PackagesService.get', () => {
  it('throws PackageNotFoundError for an unknown id', async () => {
    const service = new PackagesService(createFakePackageRepo(), createFakePackageFeatureRepo(), createFakeFeatureRepo());
    await expect(service.get('missing')).rejects.toBeInstanceOf(PackageNotFoundError);
  });

  it('projects the configured feature rows into {featureId, limit} pairs', async () => {
    const packages = createFakePackageRepo({ findById: vi.fn(async () => ({ ...baseRow })) });
    const packageFeatures = createFakePackageFeatureRepo({
      findByPackageId: vi.fn(async () => [{ id: 'pf1', packageId: 'p1', featureId: 'f1', limit: 5, enabled: true }]),
    });
    const service = new PackagesService(packages, packageFeatures, createFakeFeatureRepo());
    const result = await service.get('p1');
    expect(result.features).toEqual([{ featureId: 'f1', limit: 5 }]);
  });
});

describe('PackagesService.update', () => {
  it('throws PackageNotFoundError for an unknown id', async () => {
    const service = new PackagesService(createFakePackageRepo(), createFakePackageFeatureRepo(), createFakeFeatureRepo());
    await expect(service.update('missing', { name: 'x' })).rejects.toBeInstanceOf(PackageNotFoundError);
  });

  it('leaves an unsupplied field unchanged', async () => {
    const packages = createFakePackageRepo({ findById: vi.fn(async () => ({ ...baseRow })) });
    const service = new PackagesService(packages, createFakePackageFeatureRepo(), createFakeFeatureRepo());
    const result = await service.update('p1', { isActive: false });
    expect(result.isActive).toBe(false);
    expect(result.name).toBe('Pro');
  });

  it('rejects a malformed new key', async () => {
    const packages = createFakePackageRepo({ findById: vi.fn(async () => ({ ...baseRow })) });
    const service = new PackagesService(packages, createFakePackageFeatureRepo(), createFakeFeatureRepo());
    await expect(service.update('p1', { key: 'Bad Key!' })).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('allows a valid, non-colliding key change', async () => {
    const packages = createFakePackageRepo({ findById: vi.fn(async () => ({ ...baseRow })), existsByKey: vi.fn(async () => false) });
    const service = new PackagesService(packages, createFakePackageFeatureRepo(), createFakeFeatureRepo());
    const result = await service.update('p1', { key: 'pro-renamed' });
    expect(result.key).toBe('pro-renamed');
  });
});

describe('PackagesService.replaceFeatures', () => {
  it('throws PackageNotFoundError for an unknown package id', async () => {
    const service = new PackagesService(createFakePackageRepo(), createFakePackageFeatureRepo(), createFakeFeatureRepo());
    await expect(service.replaceFeatures('missing', [])).rejects.toBeInstanceOf(PackageNotFoundError);
  });

  it('throws FeatureNotFoundError if any featureId does not resolve to a catalog feature', async () => {
    const packages = createFakePackageRepo({ findById: vi.fn(async () => ({ ...baseRow })) });
    const features = createFakeFeatureRepo({ findByIds: vi.fn(async () => []) }); // none found
    const service = new PackagesService(packages, createFakePackageFeatureRepo(), features);
    await expect(service.replaceFeatures('p1', [{ featureId: 'missing-feature' }])).rejects.toBeInstanceOf(FeatureNotFoundError);
  });

  it('validates before writing anything (no replaceForPackage call on a bad featureId)', async () => {
    const packages = createFakePackageRepo({ findById: vi.fn(async () => ({ ...baseRow })) });
    const features = createFakeFeatureRepo({ findByIds: vi.fn(async () => []) });
    const packageFeatures = createFakePackageFeatureRepo();
    const service = new PackagesService(packages, packageFeatures, features);
    await expect(service.replaceFeatures('p1', [{ featureId: 'missing-feature' }])).rejects.toBeInstanceOf(FeatureNotFoundError);
    expect(packageFeatures.replaceForPackage).not.toHaveBeenCalled();
  });

  it('replaces the feature configuration and re-fetches the detail', async () => {
    const packages = createFakePackageRepo({ findById: vi.fn(async () => ({ ...baseRow })) });
    const features = createFakeFeatureRepo({ findByIds: vi.fn(async () => [{ id: 'f1' }] as never) });
    const packageFeatures = createFakePackageFeatureRepo({
      findByPackageId: vi.fn(async () => [{ id: 'pf1', packageId: 'p1', featureId: 'f1', limit: null, enabled: true }]),
    });
    const service = new PackagesService(packages, packageFeatures, features);
    const result = await service.replaceFeatures('p1', [{ featureId: 'f1', limit: null }]);
    expect(packageFeatures.replaceForPackage).toHaveBeenCalledWith('p1', [{ featureId: 'f1', limit: null }]);
    expect(result.features).toEqual([{ featureId: 'f1', limit: null }]);
  });

  it('empty items[] disables every feature for this package (default-deny), still validated as an empty set', async () => {
    const packages = createFakePackageRepo({ findById: vi.fn(async () => ({ ...baseRow })) });
    const packageFeatures = createFakePackageFeatureRepo({ findByPackageId: vi.fn(async () => []) });
    const service = new PackagesService(packages, packageFeatures, createFakeFeatureRepo());
    await service.replaceFeatures('p1', []);
    expect(packageFeatures.replaceForPackage).toHaveBeenCalledWith('p1', []);
  });
});
