import { describe, expect, it, vi } from 'vitest';
import { SubscriptionAdminService } from './subscription-admin.service';
import { PackageInactiveError, PackageNotFoundError } from '../domain/errors';
import type { PackageRepository } from '../infrastructure/package.repository';
import type { TenantSubscriptionRepository } from '../infrastructure/tenant-subscription.repository';

/** Pure-logic unit tests (fake repositories, no real database) — mirrors the fake-repository shape
 * `legacy/api/src/platform/subscriptions/application/subscription-admin.service.spec.ts` already
 * established, minus the `getSubscriptionWithUsage`/`FeatureUsageService` half (not ported — see
 * `SubscriptionAdminService`'s own doc comment for why: no `platform/usage` module exists yet). */

const pkg = (over: Partial<{ isActive: boolean }> = {}) => ({
  id: 'pkg-1',
  key: 'pro',
  name: 'Pro',
  priceCents: 2900,
  currency: 'usd',
  isActive: true,
  ...over,
});

function fakePackages(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}): PackageRepository {
  return { findById: vi.fn(async () => pkg()), ...overrides } as unknown as PackageRepository;
}
function fakeSubscriptions(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}): TenantSubscriptionRepository {
  return {
    findByTenantId: vi.fn(async () => null),
    upsertForTenant: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as TenantSubscriptionRepository;
}

describe('SubscriptionAdminService.getSummary', () => {
  it('returns null for a tenant with no subscription row (FR-PKG-4)', async () => {
    const service = new SubscriptionAdminService(fakePackages(), fakeSubscriptions());
    expect(await service.getSummary('t1')).toBeNull();
  });

  it("resolves the current package's display fields alongside the subscription status", async () => {
    const service = new SubscriptionAdminService(
      fakePackages(),
      fakeSubscriptions({
        findByTenantId: vi.fn(async () => ({ packageId: 'pkg-1', status: 'ACTIVE', providerCustomerId: 'cus_1' })),
      }),
    );
    const result = await service.getSummary('t1');
    expect(result).toEqual({
      packageId: 'pkg-1',
      packageKey: 'pro',
      packageName: 'Pro',
      priceCents: 2900,
      currency: 'usd',
      status: 'ACTIVE',
      hasProviderCustomer: true,
    });
  });

  it('reports hasProviderCustomer: false when no Stripe customer has ever been created', async () => {
    const service = new SubscriptionAdminService(
      fakePackages(),
      fakeSubscriptions({ findByTenantId: vi.fn(async () => ({ packageId: 'pkg-1', status: 'ACTIVE', providerCustomerId: null })) }),
    );
    const result = await service.getSummary('t1');
    expect(result?.hasProviderCustomer).toBe(false);
  });

  it('degrades to null if the referenced package no longer exists (defensive)', async () => {
    const service = new SubscriptionAdminService(
      fakePackages({ findById: vi.fn(async () => null) }),
      fakeSubscriptions({ findByTenantId: vi.fn(async () => ({ packageId: 'gone', status: 'ACTIVE' })) }),
    );
    expect(await service.getSummary('t1')).toBeNull();
  });
});

describe('SubscriptionAdminService.reassign', () => {
  it('throws PackageNotFoundError for an unknown package', async () => {
    const service = new SubscriptionAdminService(fakePackages({ findById: vi.fn(async () => null) }), fakeSubscriptions());
    await expect(service.reassign('t1', 'missing')).rejects.toBeInstanceOf(PackageNotFoundError);
  });

  it('throws PackageInactiveError for an inactive target package', async () => {
    const service = new SubscriptionAdminService(fakePackages({ findById: vi.fn(async () => pkg({ isActive: false })) }), fakeSubscriptions());
    await expect(service.reassign('t1', 'pkg-1')).rejects.toBeInstanceOf(PackageInactiveError);
  });

  it('defaults a first-time assignment to ACTIVE', async () => {
    const upsertForTenant = vi.fn(async () => undefined);
    const service = new SubscriptionAdminService(fakePackages(), fakeSubscriptions({ upsertForTenant }));
    const result = await service.reassign('t1', 'pkg-1');
    expect(upsertForTenant).toHaveBeenCalledWith('t1', 'pkg-1', 'ACTIVE');
    expect(result.status).toBe('ACTIVE');
  });

  it("preserves an existing subscription's status across a reassignment (FR-PKG-4: package change, not status change)", async () => {
    const upsertForTenant = vi.fn(async () => undefined);
    const service = new SubscriptionAdminService(
      fakePackages(),
      fakeSubscriptions({
        findByTenantId: vi.fn(async () => ({ packageId: 'old-pkg', status: 'PAST_DUE', providerCustomerId: null })),
        upsertForTenant,
      }),
    );
    const result = await service.reassign('t1', 'pkg-1');
    expect(upsertForTenant).toHaveBeenCalledWith('t1', 'pkg-1', 'PAST_DUE');
    expect(result.status).toBe('PAST_DUE');
  });
});
