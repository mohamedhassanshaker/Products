import { describe, expect, it, vi } from 'vitest';
import type pino from 'pino';
import type { PaymentGatewayPort } from '@/server/common/ports/payment-gateway.port';
import { BillingWebhookService } from './billing-webhook.service';
import { WebhookSignatureInvalidError } from '../domain/errors';
import type { PackageRepository } from '../infrastructure/package.repository';
import type { TenantSubscriptionRepository } from '../infrastructure/tenant-subscription.repository';
import type { AuditLogService } from '@/server/platform/audit';

/** Pure-logic unit tests (fake gateway/repositories, no real database, no real Stripe) — mirrors the
 * fake-repository shape `legacy/api/src/platform/billing/application/billing-webhook.service.spec.ts`
 * already established. **Phase 2 sub-slice "2d" update**: `platform/audit` now exists, so every
 * constructor call below passes a `fakeAudit()` collaborator; the `System`-attributed audit-write
 * assertions themselves live in their own `describe` block near the bottom of this file. */

function fakeGateway(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}): PaymentGatewayPort {
  return { verifyAndParseWebhook: vi.fn(), ...overrides } as unknown as PaymentGatewayPort;
}
function fakeAudit(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}): AuditLogService {
  return { record: vi.fn().mockResolvedValue(undefined), ...overrides } as unknown as AuditLogService;
}
function fakeSubscriptions(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}): TenantSubscriptionRepository {
  return {
    findByTenantId: vi.fn(async () => null),
    findByProviderSubscriptionId: vi.fn(async () => null),
    markActiveFromCheckout: vi.fn(async () => undefined),
    updateStatusAndPeriod: vi.fn(async () => undefined),
    markCanceled: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as TenantSubscriptionRepository;
}
/** Defaults to resolving any id to a fake package row — individual tests override `findById` to
 * exercise the "unknown/malformed metadata.packageId" fail-safe branch. */
function fakePackages(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}): PackageRepository {
  return {
    findById: vi.fn(async (id: string) => ({ id, key: 'pro', name: 'Pro' })),
    ...overrides,
  } as unknown as PackageRepository;
}
function fakeLogger(): pino.Logger {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as pino.Logger;
}

describe('BillingWebhookService.handle - signature verification (security-critical)', () => {
  it('throws WebhookSignatureInvalidError, never leaking the underlying reason, when the gateway rejects the signature', async () => {
    const gateway = fakeGateway({
      verifyAndParseWebhook: vi.fn(() => {
        throw new Error('Stripe internal detail: timestamp outside tolerance');
      }),
    });
    const service = new BillingWebhookService(gateway, fakeSubscriptions(), fakePackages(), fakeAudit(), fakeLogger());

    await expect(service.handle('{}', 'bad-sig')).rejects.toBeInstanceOf(WebhookSignatureInvalidError);
    await expect(service.handle('{}', 'bad-sig')).rejects.toMatchObject({
      code: 'WEBHOOK_SIGNATURE_INVALID',
      message: expect.not.stringContaining('timestamp'),
    });
  });
});

describe('BillingWebhookService.handle - checkout.session.completed', () => {
  function event(data: unknown) {
    return { id: 'evt_1', type: 'checkout.session.completed', data };
  }

  it('activates the matched tenant subscription and records both provider ids (no packageId metadata: leaves packageId untouched)', async () => {
    const markActiveFromCheckout = vi.fn(async () => undefined);
    const subscriptions = fakeSubscriptions({
      findByTenantId: vi.fn(async () => ({ tenantId: 't1' })),
      markActiveFromCheckout,
    });
    const gateway = fakeGateway({
      verifyAndParseWebhook: vi.fn(() => event({ customer: 'cus_1', subscription: 'sub_1', metadata: { tenantId: 't1' } })),
    });
    const service = new BillingWebhookService(gateway, subscriptions, fakePackages(), fakeAudit(), fakeLogger());

    await service.handle('{}', 'sig');

    expect(markActiveFromCheckout).toHaveBeenCalledWith('t1', {
      providerCustomerId: 'cus_1',
      providerSubscriptionId: 'sub_1',
      packageId: undefined,
    });
  });

  it('applies the target packageId from session metadata in the same call as the ACTIVE/provider-id write', async () => {
    const markActiveFromCheckout = vi.fn(async () => undefined);
    const subscriptions = fakeSubscriptions({
      findByTenantId: vi.fn(async () => ({ tenantId: 't1' })),
      markActiveFromCheckout,
    });
    const packages = fakePackages({ findById: vi.fn(async () => ({ id: 'pro-pkg', key: 'pro', name: 'Pro' })) });
    const gateway = fakeGateway({
      verifyAndParseWebhook: vi.fn(() =>
        event({ customer: 'cus_1', subscription: 'sub_1', metadata: { tenantId: 't1', packageId: 'pro-pkg' } }),
      ),
    });
    const service = new BillingWebhookService(gateway, subscriptions, packages, fakeAudit(), fakeLogger());

    await service.handle('{}', 'sig');

    expect(packages.findById).toHaveBeenCalledWith('pro-pkg');
    expect(markActiveFromCheckout).toHaveBeenCalledWith('t1', {
      providerCustomerId: 'cus_1',
      providerSubscriptionId: 'sub_1',
      packageId: 'pro-pkg',
    });
  });

  it('leaves packageId unchanged (with a logged warning) when metadata.packageId does not resolve to any known package', async () => {
    const markActiveFromCheckout = vi.fn(async () => undefined);
    const subscriptions = fakeSubscriptions({
      findByTenantId: vi.fn(async () => ({ tenantId: 't1' })),
      markActiveFromCheckout,
    });
    const packages = fakePackages({ findById: vi.fn(async () => null) });
    const logger = fakeLogger();
    const gateway = fakeGateway({
      verifyAndParseWebhook: vi.fn(() =>
        event({ customer: 'cus_1', subscription: 'sub_1', metadata: { tenantId: 't1', packageId: 'does-not-exist' } }),
      ),
    });
    const service = new BillingWebhookService(gateway, subscriptions, packages, fakeAudit(), logger);

    await expect(service.handle('{}', 'sig')).resolves.toBeUndefined();

    expect(markActiveFromCheckout).toHaveBeenCalledWith('t1', {
      providerCustomerId: 'cus_1',
      providerSubscriptionId: 'sub_1',
      packageId: undefined,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ metadataPackageId: 'does-not-exist' }),
      'billing.webhook_checkout_completed_unknown_package_in_metadata',
    );
  });

  it('leaves packageId unchanged (with a logged warning) when metadata has no packageId at all', async () => {
    const markActiveFromCheckout = vi.fn(async () => undefined);
    const subscriptions = fakeSubscriptions({
      findByTenantId: vi.fn(async () => ({ tenantId: 't1' })),
      markActiveFromCheckout,
    });
    const packages = fakePackages();
    const logger = fakeLogger();
    const gateway = fakeGateway({
      verifyAndParseWebhook: vi.fn(() => event({ customer: 'cus_1', subscription: 'sub_1', metadata: { tenantId: 't1' } })),
    });
    const service = new BillingWebhookService(gateway, subscriptions, packages, fakeAudit(), logger);

    await service.handle('{}', 'sig');

    expect(packages.findById).not.toHaveBeenCalled();
    expect(markActiveFromCheckout).toHaveBeenCalledWith('t1', {
      providerCustomerId: 'cus_1',
      providerSubscriptionId: 'sub_1',
      packageId: undefined,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1' }),
      'billing.webhook_checkout_completed_missing_package_metadata',
    );
  });

  it('logs and ignores (never throws) when metadata.tenantId does not match any subscription row', async () => {
    const markActiveFromCheckout = vi.fn();
    const subscriptions = fakeSubscriptions({ findByTenantId: vi.fn(async () => null), markActiveFromCheckout });
    const gateway = fakeGateway({
      verifyAndParseWebhook: vi.fn(() => event({ customer: 'cus_1', subscription: 'sub_1', metadata: { tenantId: 'unknown-tenant' } })),
    });
    const service = new BillingWebhookService(gateway, subscriptions, fakePackages(), fakeAudit(), fakeLogger());

    await expect(service.handle('{}', 'sig')).resolves.toBeUndefined();
    expect(markActiveFromCheckout).not.toHaveBeenCalled();
  });

  it('logs and ignores when metadata is entirely missing', async () => {
    const markActiveFromCheckout = vi.fn();
    const subscriptions = fakeSubscriptions({ markActiveFromCheckout });
    const gateway = fakeGateway({ verifyAndParseWebhook: vi.fn(() => event({ customer: 'cus_1', subscription: 'sub_1', metadata: null })) });
    const service = new BillingWebhookService(gateway, subscriptions, fakePackages(), fakeAudit(), fakeLogger());

    await expect(service.handle('{}', 'sig')).resolves.toBeUndefined();
    expect(markActiveFromCheckout).not.toHaveBeenCalled();
  });
});

describe('BillingWebhookService.handle - customer.subscription.updated (status mapping)', () => {
  function event(data: unknown) {
    return { id: 'evt_2', type: 'customer.subscription.updated', data };
  }

  it.each([
    ['active', 'ACTIVE'],
    ['trialing', 'ACTIVE'],
    ['past_due', 'PAST_DUE'],
    ['unpaid', 'PAST_DUE'],
    ['incomplete', 'PAST_DUE'],
    ['canceled', 'CANCELED'],
    ['incomplete_expired', 'CANCELED'],
    ['some_future_status_stripe_might_add', 'PAST_DUE'],
  ])('maps provider status %s to %s (fail-toward-restrictive for anything unrecognized)', async (providerStatus, expected) => {
    const updateStatusAndPeriod = vi.fn(async () => undefined);
    const subscriptions = fakeSubscriptions({
      findByProviderSubscriptionId: vi.fn(async () => ({ tenantId: 't1' })),
      updateStatusAndPeriod,
    });
    const gateway = fakeGateway({ verifyAndParseWebhook: vi.fn(() => event({ id: 'sub_1', status: providerStatus })) });
    const service = new BillingWebhookService(gateway, subscriptions, fakePackages(), fakeAudit(), fakeLogger());

    await service.handle('{}', 'sig');

    expect(updateStatusAndPeriod).toHaveBeenCalledWith('sub_1', expect.objectContaining({ status: expected }));
  });

  it('converts Unix-seconds period bounds to Date objects', async () => {
    const updateStatusAndPeriod = vi.fn(async () => undefined);
    const subscriptions = fakeSubscriptions({
      findByProviderSubscriptionId: vi.fn(async () => ({ tenantId: 't1' })),
      updateStatusAndPeriod,
    });
    const gateway = fakeGateway({
      verifyAndParseWebhook: vi.fn(() => event({ id: 'sub_1', status: 'active', current_period_start: 1700000000, current_period_end: 1702592000 })),
    });
    const service = new BillingWebhookService(gateway, subscriptions, fakePackages(), fakeAudit(), fakeLogger());

    await service.handle('{}', 'sig');

    expect(updateStatusAndPeriod).toHaveBeenCalledWith('sub_1', {
      status: 'ACTIVE',
      currentPeriodStart: new Date(1700000000 * 1000),
      currentPeriodEnd: new Date(1702592000 * 1000),
    });
  });

  it('logs and ignores (200-equivalent, never throws) an unmatched provider subscription id', async () => {
    const updateStatusAndPeriod = vi.fn();
    const subscriptions = fakeSubscriptions({ findByProviderSubscriptionId: vi.fn(async () => null), updateStatusAndPeriod });
    const gateway = fakeGateway({ verifyAndParseWebhook: vi.fn(() => event({ id: 'sub_unknown', status: 'active' })) });
    const service = new BillingWebhookService(gateway, subscriptions, fakePackages(), fakeAudit(), fakeLogger());

    await expect(service.handle('{}', 'sig')).resolves.toBeUndefined();
    expect(updateStatusAndPeriod).not.toHaveBeenCalled();
  });
});

describe('BillingWebhookService.handle - customer.subscription.deleted', () => {
  function event(data: unknown) {
    return { id: 'evt_3', type: 'customer.subscription.deleted', data };
  }

  it('cancels the matched subscription unconditionally, regardless of its prior status', async () => {
    const markCanceled = vi.fn(async () => undefined);
    const subscriptions = fakeSubscriptions({
      findByProviderSubscriptionId: vi.fn(async () => ({ tenantId: 't1' })),
      markCanceled,
    });
    const gateway = fakeGateway({ verifyAndParseWebhook: vi.fn(() => event({ id: 'sub_1', status: 'active' })) });
    const service = new BillingWebhookService(gateway, subscriptions, fakePackages(), fakeAudit(), fakeLogger());

    await service.handle('{}', 'sig');

    expect(markCanceled).toHaveBeenCalledWith('sub_1');
  });

  it('logs and ignores (never throws) an unmatched provider subscription id', async () => {
    const markCanceled = vi.fn();
    const subscriptions = fakeSubscriptions({ findByProviderSubscriptionId: vi.fn(async () => null), markCanceled });
    const gateway = fakeGateway({ verifyAndParseWebhook: vi.fn(() => event({ id: 'sub_unknown' })) });
    const service = new BillingWebhookService(gateway, subscriptions, fakePackages(), fakeAudit(), fakeLogger());

    await expect(service.handle('{}', 'sig')).resolves.toBeUndefined();
    expect(markCanceled).not.toHaveBeenCalled();
  });
});

describe('BillingWebhookService.handle - unknown event type', () => {
  it('resolves without error and never touches the subscription repository', async () => {
    const subscriptions = fakeSubscriptions();
    const gateway = fakeGateway({ verifyAndParseWebhook: vi.fn(() => ({ id: 'evt_4', type: 'invoice.paid', data: {} })) });
    const service = new BillingWebhookService(gateway, subscriptions, fakePackages(), fakeAudit(), fakeLogger());

    await expect(service.handle('{}', 'sig')).resolves.toBeUndefined();
    expect(subscriptions.findByTenantId).not.toHaveBeenCalled();
    expect(subscriptions.findByProviderSubscriptionId).not.toHaveBeenCalled();
  });

  it('never writes an audit row for an ignored/unknown event type', async () => {
    const audit = fakeAudit();
    const gateway = fakeGateway({ verifyAndParseWebhook: vi.fn(() => ({ id: 'evt_4', type: 'invoice.paid', data: {} })) });
    const service = new BillingWebhookService(gateway, fakeSubscriptions(), fakePackages(), audit, fakeLogger());

    await service.handle('{}', 'sig');

    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('BillingWebhookService.handle - System-attributed audit writes (Phase 2 sub-slice "2d")', () => {
  it('writes a System-attributed billing.checkout_completed audit row after a matched checkout completes', async () => {
    const audit = fakeAudit();
    const subscriptions = fakeSubscriptions({ findByTenantId: vi.fn(async () => ({ tenantId: 't1' })) });
    const gateway = fakeGateway({
      verifyAndParseWebhook: vi.fn(() => ({
        id: 'evt_1',
        type: 'checkout.session.completed',
        data: { customer: 'cus_1', subscription: 'sub_1', metadata: { tenantId: 't1', packageId: 'pro-pkg' } },
      })),
    });
    const service = new BillingWebhookService(gateway, subscriptions, fakePackages(), audit, fakeLogger());

    await service.handle('{}', 'sig');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'System',
        tenantId: 't1',
        action: 'billing.checkout_completed',
        targetType: 'TenantSubscription',
        targetId: 't1',
      }),
    );
  });

  it('never writes an audit row for an unmatched checkout.session.completed event', async () => {
    const audit = fakeAudit();
    const subscriptions = fakeSubscriptions({ findByTenantId: vi.fn(async () => null) });
    const gateway = fakeGateway({
      verifyAndParseWebhook: vi.fn(() => ({
        id: 'evt_1',
        type: 'checkout.session.completed',
        data: { customer: 'cus_1', subscription: 'sub_1', metadata: { tenantId: 'unknown-tenant' } },
      })),
    });
    const service = new BillingWebhookService(gateway, subscriptions, fakePackages(), audit, fakeLogger());

    await service.handle('{}', 'sig');

    expect(audit.record).not.toHaveBeenCalled();
  });

  it('writes a System-attributed billing.subscription_updated audit row for a matched subscription-updated event', async () => {
    const audit = fakeAudit();
    const subscriptions = fakeSubscriptions({ findByProviderSubscriptionId: vi.fn(async () => ({ tenantId: 't1' })) });
    const gateway = fakeGateway({
      verifyAndParseWebhook: vi.fn(() => ({ id: 'evt_2', type: 'customer.subscription.updated', data: { id: 'sub_1', status: 'active' } })),
    });
    const service = new BillingWebhookService(gateway, subscriptions, fakePackages(), audit, fakeLogger());

    await service.handle('{}', 'sig');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'System', tenantId: 't1', action: 'billing.subscription_updated' }),
    );
  });

  it('writes a System-attributed billing.subscription_canceled audit row for a matched subscription-deleted event', async () => {
    const audit = fakeAudit();
    const subscriptions = fakeSubscriptions({ findByProviderSubscriptionId: vi.fn(async () => ({ tenantId: 't1' })) });
    const gateway = fakeGateway({
      verifyAndParseWebhook: vi.fn(() => ({ id: 'evt_3', type: 'customer.subscription.deleted', data: { id: 'sub_1' } })),
    });
    const service = new BillingWebhookService(gateway, subscriptions, fakePackages(), audit, fakeLogger());

    await service.handle('{}', 'sig');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'System', tenantId: 't1', action: 'billing.subscription_canceled' }),
    );
  });
});
