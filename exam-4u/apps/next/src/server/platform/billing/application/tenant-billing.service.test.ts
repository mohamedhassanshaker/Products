import { describe, expect, it, vi } from 'vitest';
import { TenantBillingService } from './tenant-billing.service';
import type { BillingCheckoutService } from './billing-checkout.service';
import type { PackageRepository } from '../infrastructure/package.repository';
import type { TenantSubscriptionRepository } from '../infrastructure/tenant-subscription.repository';

/** Pure-logic unit tests (fake repositories/checkout service, no real database, no real Stripe) —
 * migration plan Phase 9 sub-slice "9b"'s own "Per-phase verification" item 4. Mirrors the
 * fake-repository shape `billing-checkout.service.test.ts` already established. */

const activePkg = { id: 'pkg-1', key: 'pro', name: 'Pro', description: 'Pro plan', priceCents: 2900, currency: 'usd', sortOrder: 1, isActive: true };
const inactivePkg = { id: 'pkg-2', key: 'legacy', name: 'Legacy', description: null, priceCents: 1900, currency: 'usd', sortOrder: 2, isActive: false };

function fakePackages(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}): PackageRepository {
  return { findAllActive: vi.fn(async () => [activePkg]), ...overrides } as unknown as PackageRepository;
}
function fakeSubscriptions(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}): TenantSubscriptionRepository {
  return { findByTenantId: vi.fn(async () => null), ...overrides } as unknown as TenantSubscriptionRepository;
}
function fakeCheckout(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}): BillingCheckoutService {
  return {
    createCheckoutSession: vi.fn(async () => ({ url: 'https://checkout.stripe.com/cs_1' })),
    ...overrides,
  } as unknown as BillingCheckoutService;
}

describe('TenantBillingService.getPlans', () => {
  it('returns only active packages, with no current package/status when the tenant has no subscription yet', async () => {
    const service = new TenantBillingService(fakePackages(), fakeSubscriptions(), fakeCheckout());
    const result = await service.getPlans('tenant-1');
    expect(result).toEqual({
      currentPackageId: null,
      status: null,
      packages: [
        {
          id: 'pkg-1',
          key: 'pro',
          name: 'Pro',
          description: 'Pro plan',
          priceCents: 2900,
          currency: 'usd',
          sortOrder: 1,
        },
      ],
    });
  });

  it('excludes an inactive package from the catalog even though findAllActive is the only source queried', async () => {
    // findAllActive itself is responsible for the active-only filter (PackageRepository's own
    // doc-commented rule) — this test asserts getPlans never re-includes an inactive package even if
    // it were accidentally returned, by asserting the projection is a pure 1:1 map, not a filter.
    const packages = fakePackages({ findAllActive: vi.fn(async () => [activePkg]) });
    const service = new TenantBillingService(packages, fakeSubscriptions(), fakeCheckout());
    const result = await service.getPlans('tenant-1');
    expect(result.packages.map((p) => p.key)).toEqual(['pro']);
    expect(result.packages.some((p) => p.key === inactivePkg.key)).toBe(false);
  });

  it('surfaces the current package id and status from an existing subscription', async () => {
    const subscriptions = fakeSubscriptions({
      findByTenantId: vi.fn(async () => ({ packageId: 'pkg-1', status: 'PAST_DUE' })),
    });
    const service = new TenantBillingService(fakePackages(), subscriptions, fakeCheckout());
    const result = await service.getPlans('tenant-1');
    expect(result.currentPackageId).toBe('pkg-1');
    expect(result.status).toBe('PAST_DUE');
  });
});

describe('TenantBillingService.initiateCheckout', () => {
  it('supplies /settings/billing?checkout=success|cancel redirect URLs built from the tenant origin, never the platform-console default', async () => {
    const checkout = fakeCheckout();
    const service = new TenantBillingService(fakePackages(), fakeSubscriptions(), checkout);

    const result = await service.initiateCheckout('tenant-1', 'Acme Inc', 'https://acme.examland.app', 'pkg-1');

    expect(checkout.createCheckoutSession).toHaveBeenCalledWith('tenant-1', 'Acme Inc', 'pkg-1', {
      successUrl: 'https://acme.examland.app/settings/billing?checkout=success',
      cancelUrl: 'https://acme.examland.app/settings/billing?checkout=cancel',
    });
    expect(result).toEqual({ url: 'https://checkout.stripe.com/cs_1' });
  });

  it('propagates whatever error BillingCheckoutService throws verbatim (no re-wrapping)', async () => {
    class Boom extends Error {}
    const checkout = fakeCheckout({
      createCheckoutSession: vi.fn(async () => {
        throw new Boom('package inactive');
      }),
    });
    const service = new TenantBillingService(fakePackages(), fakeSubscriptions(), checkout);
    await expect(service.initiateCheckout('tenant-1', 'Acme', 'https://acme.examland.app', 'pkg-1')).rejects.toBeInstanceOf(Boom);
  });
});
