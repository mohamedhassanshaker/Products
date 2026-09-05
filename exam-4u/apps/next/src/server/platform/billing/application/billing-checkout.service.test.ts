import { describe, expect, it, vi } from 'vitest';
import type { PaymentGatewayPort } from '@/server/common/ports/payment-gateway.port';
import { BillingCheckoutService } from './billing-checkout.service';
import { BillingNotConfiguredError, PackageInactiveError, PackageNotFoundError } from '../domain/errors';
import type { PackageRepository } from '../infrastructure/package.repository';
import type { TenantSubscriptionRepository } from '../infrastructure/tenant-subscription.repository';

/** Pure-logic unit tests (fake repositories/gateway, no real database, no real Stripe) — migration
 * plan Phase 2 sub-slice "2c"'s own "Per-phase verification" item 4. Mirrors the fake-repository/
 * fake-gateway shape `legacy/api/src/platform/billing/application/billing-checkout.service.spec.ts`
 * already established. */

const pkg = { id: 'pkg-1', key: 'pro', name: 'Pro', priceCents: 2900, currency: 'usd', isActive: true };

const defaultOpts = {
  stripeSecretKey: 'sk_test',
  stripeWebhookSecret: 'whsec_test',
  checkoutSuccessUrlTemplate: 'https://admin.example.com/tenants/{tenantId}?checkout=success',
  checkoutCancelUrlTemplate: 'https://admin.example.com/tenants/{tenantId}?checkout=cancel',
};

function fakePackages(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}): PackageRepository {
  return { findById: vi.fn(async () => pkg), ...overrides } as unknown as PackageRepository;
}
function fakeSubscriptions(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}): TenantSubscriptionRepository {
  return {
    findByTenantId: vi.fn(async () => null),
    setProviderCustomerId: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as TenantSubscriptionRepository;
}
function fakeGateway(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}): PaymentGatewayPort {
  return {
    ensureCustomer: vi.fn(async () => 'cus_new'),
    createCheckoutSession: vi.fn(async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' })),
    verifyAndParseWebhook: vi.fn(),
    ...overrides,
  } as unknown as PaymentGatewayPort;
}

describe('BillingCheckoutService.createCheckoutSession', () => {
  it('throws BillingNotConfiguredError before touching package data when the secret key is empty', async () => {
    const packages = fakePackages();
    const service = new BillingCheckoutService(packages, fakeSubscriptions(), fakeGateway(), {
      ...defaultOpts,
      stripeSecretKey: '',
    });
    await expect(service.createCheckoutSession('t1', 'Acme', 'pkg-1')).rejects.toBeInstanceOf(BillingNotConfiguredError);
    expect(packages.findById).not.toHaveBeenCalled();
  });

  it('throws BillingNotConfiguredError when only the webhook secret is empty', async () => {
    const service = new BillingCheckoutService(fakePackages(), fakeSubscriptions(), fakeGateway(), {
      ...defaultOpts,
      stripeWebhookSecret: '',
    });
    await expect(service.createCheckoutSession('t1', 'Acme', 'pkg-1')).rejects.toBeInstanceOf(BillingNotConfiguredError);
  });

  it('throws PackageNotFoundError for an unknown package', async () => {
    const service = new BillingCheckoutService(
      fakePackages({ findById: vi.fn(async () => null) }),
      fakeSubscriptions(),
      fakeGateway(),
      defaultOpts,
    );
    await expect(service.createCheckoutSession('t1', 'Acme', 'missing')).rejects.toBeInstanceOf(PackageNotFoundError);
  });

  it('throws PackageInactiveError for an inactive package', async () => {
    const service = new BillingCheckoutService(
      fakePackages({ findById: vi.fn(async () => ({ ...pkg, isActive: false })) }),
      fakeSubscriptions(),
      fakeGateway(),
      defaultOpts,
    );
    await expect(service.createCheckoutSession('t1', 'Acme', 'pkg-1')).rejects.toBeInstanceOf(PackageInactiveError);
  });

  it('creates a new provider customer and persists it when the tenant has none yet', async () => {
    const setProviderCustomerId = vi.fn(async () => undefined);
    const ensureCustomer = vi.fn(async () => 'cus_new');
    const service = new BillingCheckoutService(
      fakePackages(),
      fakeSubscriptions({ findByTenantId: vi.fn(async () => ({ providerCustomerId: null })), setProviderCustomerId }),
      fakeGateway({ ensureCustomer }),
      defaultOpts,
    );
    await service.createCheckoutSession('t1', 'Acme', 'pkg-1');
    expect(ensureCustomer).toHaveBeenCalledWith({ tenantId: 't1', name: 'Acme', existingCustomerId: null });
    expect(setProviderCustomerId).toHaveBeenCalledWith('t1', 'cus_new');
  });

  it('reuses an existing provider customer id without persisting it again, avoiding duplicate customers per FR-PKG-6', async () => {
    const setProviderCustomerId = vi.fn(async () => undefined);
    const ensureCustomer = vi.fn(async () => 'cus_existing');
    const service = new BillingCheckoutService(
      fakePackages(),
      fakeSubscriptions({
        findByTenantId: vi.fn(async () => ({ providerCustomerId: 'cus_existing' })),
        setProviderCustomerId,
      }),
      fakeGateway({ ensureCustomer }),
      defaultOpts,
    );
    await service.createCheckoutSession('t1', 'Acme', 'pkg-1');
    expect(ensureCustomer).toHaveBeenCalledWith({ tenantId: 't1', name: 'Acme', existingCustomerId: 'cus_existing' });
    expect(setProviderCustomerId).not.toHaveBeenCalled();
  });

  it('substitutes the tenantId placeholder into the configured success and cancel URL templates', async () => {
    const createCheckoutSession = vi.fn(async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' }));
    const service = new BillingCheckoutService(fakePackages(), fakeSubscriptions(), fakeGateway({ createCheckoutSession }), defaultOpts);
    await service.createCheckoutSession('t1', 'Acme', 'pkg-1');
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        successUrl: 'https://admin.example.com/tenants/t1?checkout=success',
        cancelUrl: 'https://admin.example.com/tenants/t1?checkout=cancel',
        packageId: 'pkg-1',
        packageKey: 'pro',
        packageName: 'Pro',
        priceCents: 2900,
        currency: 'usd',
        tenantId: 't1',
      }),
    );
  });

  it('returns the gateway-provided checkout URL', async () => {
    const service = new BillingCheckoutService(fakePackages(), fakeSubscriptions(), fakeGateway(), defaultOpts);
    const result = await service.createCheckoutSession('t1', 'Acme', 'pkg-1');
    expect(result).toEqual({ url: 'https://checkout.stripe.com/cs_1' });
  });

  it('uses the caller-supplied redirectUrls verbatim when provided, instead of the config templates (Phase 9 forward-reference)', async () => {
    const createCheckoutSession = vi.fn(async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' }));
    const service = new BillingCheckoutService(fakePackages(), fakeSubscriptions(), fakeGateway({ createCheckoutSession }), defaultOpts);
    await service.createCheckoutSession('t1', 'Acme', 'pkg-1', {
      successUrl: 'https://acme.examland.app/settings/billing?checkout=success',
      cancelUrl: 'https://acme.examland.app/settings/billing?checkout=cancel',
    });
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        successUrl: 'https://acme.examland.app/settings/billing?checkout=success',
        cancelUrl: 'https://acme.examland.app/settings/billing?checkout=cancel',
      }),
    );
  });
});
