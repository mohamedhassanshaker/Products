import { describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { StripePaymentGatewayAdapter } from './stripe.adapter';

/**
 * Security-critical (migration plan Phase 2 sub-slice "2c" — "security-critical, full-review"). These
 * tests exercise Stripe's own real signature-verification routine (`Stripe.webhooks.constructEvent`/
 * `generateTestHeaderString`) end-to-end — never a hand-rolled or mocked stand-in — so a genuinely
 * broken verification wiring would fail here, not just an assumption about it. Mirrors
 * `legacy/api/src/infrastructure/payments/stripe.adapter.spec.ts`'s identical approach. This is also
 * this dispatch's "fake-but-realistic ... plus a real Stripe SDK signature-construction" proof named
 * in the dispatch prompt's own "On verifying against real Stripe" guidance — no live Stripe test-mode
 * API key is available in this environment (see the plan doc's "Decisions made" for the full note), so
 * `Stripe.webhooks.generateTestHeaderString` stands in as the documented, SDK-native way to prove real
 * signature verification without a live account.
 */
describe('StripePaymentGatewayAdapter.verifyAndParseWebhook', () => {
  const webhookSecret = 'whsec_test_fake_secret';
  const payload = JSON.stringify({
    id: 'evt_test_1',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_1', customer: 'cus_1', subscription: 'sub_1', metadata: { tenantId: 't1' } } },
  });

  it('accepts a genuinely, correctly signed payload (real Stripe SDK verification)', () => {
    const adapter = new StripePaymentGatewayAdapter('sk_test_fake', webhookSecret);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

    const result = adapter.verifyAndParseWebhook(payload, header);

    expect(result.id).toBe('evt_test_1');
    expect(result.type).toBe('checkout.session.completed');
    expect((result.data as { id: string }).id).toBe('cs_test_1');
  });

  it('rejects a payload signed with the wrong secret', () => {
    const adapter = new StripePaymentGatewayAdapter('sk_test_fake', webhookSecret);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_wrong_secret' });

    expect(() => adapter.verifyAndParseWebhook(payload, header)).toThrow();
  });

  it('rejects a tampered payload whose body no longer matches the signed payload', () => {
    const adapter = new StripePaymentGatewayAdapter('sk_test_fake', webhookSecret);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    const tamperedBody = payload.replace('t1', 't2-attacker-controlled');

    expect(() => adapter.verifyAndParseWebhook(tamperedBody, header)).toThrow();
  });

  it('rejects a missing/garbage signature header', () => {
    const adapter = new StripePaymentGatewayAdapter('sk_test_fake', webhookSecret);
    expect(() => adapter.verifyAndParseWebhook(payload, 'not-a-real-signature')).toThrow();
  });

  it("rejects a signature whose timestamp is outside Stripe SDK's own tolerance window (replay defense)", () => {
    const adapter = new StripePaymentGatewayAdapter('sk_test_fake', webhookSecret);
    const oldTimestamp = Math.floor(Date.now() / 1000) - 60 * 60 * 24; // 24h old
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret, timestamp: oldTimestamp });

    expect(() => adapter.verifyAndParseWebhook(payload, header)).toThrow();
  });
});

describe('StripePaymentGatewayAdapter.ensureCustomer', () => {
  it('reuses an existing customer id without ever constructing a Stripe client', async () => {
    // No secretKey supplied — if this path ever tried to hit the real Stripe API it would throw
    // (getClient() requires a non-empty secretKey), so this also proves the "reuse, do not create a
    // duplicate" branch never calls out to the gateway at all.
    const adapter = new StripePaymentGatewayAdapter('', 'whsec_test_fake_secret');
    const id = await adapter.ensureCustomer({ tenantId: 't1', name: 'Acme', existingCustomerId: 'cus_existing' });
    expect(id).toBe('cus_existing');
  });
});

describe('StripePaymentGatewayAdapter.getClient() guard', () => {
  it('ensureCustomer() throws (never calling the Stripe API) when no customer id exists yet and secretKey is empty', async () => {
    const adapter = new StripePaymentGatewayAdapter('', 'whsec_test_fake_secret');
    await expect(adapter.ensureCustomer({ tenantId: 't1', name: 'Acme', existingCustomerId: null })).rejects.toThrow(
      'Stripe is not configured',
    );
  });

  it('createCheckoutSession() throws when secretKey is empty', async () => {
    const adapter = new StripePaymentGatewayAdapter('', 'whsec_test_fake_secret');
    await expect(
      adapter.createCheckoutSession({
        customerId: 'cus_1',
        packageId: 'pkg-1',
        packageKey: 'pro',
        packageName: 'Pro',
        priceCents: 2900,
        currency: 'usd',
        successUrl: 'https://x/success',
        cancelUrl: 'https://x/cancel',
        tenantId: 't1',
      }),
    ).rejects.toThrow('Stripe is not configured');
  });
});

describe('StripePaymentGatewayAdapter.createCheckoutSession() — stubbed-client behavior', () => {
  it('throws when the Stripe SDK returns a session with no url (defensive — should never happen given the fixed shape)', async () => {
    const adapter = new StripePaymentGatewayAdapter('sk_test_fake', 'whsec_test_fake_secret');
    // The real Stripe client is only ever constructed lazily inside getClient() and cached on the
    // instance as `client` — reach in and stub its checkout.sessions.create() directly rather than
    // mocking the whole `stripe` module, so every other real-SDK-backed test above stays unaffected.
    (adapter as unknown as { client: unknown }).client = {
      checkout: { sessions: { create: vi.fn(async () => ({ id: 'cs_1', url: null })) } },
    };

    await expect(
      adapter.createCheckoutSession({
        customerId: 'cus_1',
        packageId: 'pkg-1',
        packageKey: 'pro',
        packageName: 'Pro',
        priceCents: 2900,
        currency: 'usd',
        successUrl: 'https://x/success',
        cancelUrl: 'https://x/cancel',
        tenantId: 't1',
      }),
    ).rejects.toThrow('Stripe Checkout Session was created without a redirect URL.');
  });

  it('reuses the cached client on a second call rather than constructing a new one', async () => {
    const adapter = new StripePaymentGatewayAdapter('sk_test_fake', 'whsec_test_fake_secret');
    const create = vi.fn(async () => ({ id: 'cus_1' }));
    (adapter as unknown as { client: unknown }).client = { customers: { create } };

    const id1 = await adapter.ensureCustomer({ tenantId: 't1', name: 'Acme', existingCustomerId: null });
    const id2 = await adapter.ensureCustomer({ tenantId: 't1', name: 'Acme', existingCustomerId: null });

    expect(id1).toBe('cus_1');
    expect(id2).toBe('cus_1');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('stamps packageId (alongside tenantId/packageKey) onto the created session metadata', async () => {
    const adapter = new StripePaymentGatewayAdapter('sk_test_fake', 'whsec_test_fake_secret');
    const create = vi.fn(async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' }));
    (adapter as unknown as { client: unknown }).client = { checkout: { sessions: { create } } };

    await adapter.createCheckoutSession({
      customerId: 'cus_1',
      packageId: 'pkg-1',
      packageKey: 'pro',
      packageName: 'Pro',
      priceCents: 2900,
      currency: 'usd',
      successUrl: 'https://x/success',
      cancelUrl: 'https://x/cancel',
      tenantId: 't1',
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ metadata: { tenantId: 't1', packageId: 'pkg-1', packageKey: 'pro' } }));
  });
});
