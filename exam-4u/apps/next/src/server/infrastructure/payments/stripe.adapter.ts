import Stripe from 'stripe';
import type { PaymentGatewayPort } from '@/server/common/ports/payment-gateway.port';

/**
 * The real {@link PaymentGatewayPort} implementation (migration plan Phase 2 sub-slice "2c"),
 * ported logic from `legacy/api/src/infrastructure/payments/stripe.adapter.ts`. The only file in this
 * app importing `stripe` (enforced by `apps/next/.eslintrc.cjs`'s `infrastructure/payments`
 * module-boundary rule, mirroring `infrastructure/storage`'s identical confinement of `node:fs`) —
 * `platform/billing`'s application layer depends solely on the port.
 *
 * **Security-critical**: {@link verifyAndParseWebhook} delegates entirely to Stripe's own
 * `stripe.webhooks.constructEvent`, which performs a timing-safe HMAC-SHA256 comparison and a
 * replay-window/timestamp check internally — this class never hand-rolls signature comparison.
 *
 * The Stripe client is constructed lazily (only when `secretKey` is non-empty) so a deployment with
 * billing disabled (`STRIPE_SECRET_KEY` empty — `BILLING_NOT_CONFIGURED` 503) never even attempts to
 * build a client. `BillingCheckoutService` already short-circuits on an empty secret key before
 * calling this adapter at all; this adapter's own `getClient()` guard is a second, independent layer
 * in case a future caller ever bypasses that check.
 */
export class StripePaymentGatewayAdapter implements PaymentGatewayPort {
  private client: Stripe | null = null;

  /**
   * @param secretKey `STRIPE_SECRET_KEY` — empty means "billing not configured" (see `getClient()`).
   * @param webhookSecret `STRIPE_WEBHOOK_SECRET` — the signing secret every inbound webhook is
   *   verified against.
   */
  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
  ) {}

  async ensureCustomer(t: { tenantId: string; name: string; email?: string; existingCustomerId?: string | null }): Promise<string> {
    // FR-PKG-6: "a returning tenant reuses the same customer... rather than accumulating duplicate
    // customer records" — the caller (`BillingCheckoutService`) is the single source of truth for
    // whether one already exists (read from `tenant_subscription.provider_customer_id`); this adapter
    // never searches Stripe's customer list itself, avoiding an eventually-consistent search API.
    if (t.existingCustomerId) return t.existingCustomerId;

    const customer = await this.getClient().customers.create({
      name: t.name,
      email: t.email,
      metadata: { tenantId: t.tenantId },
    });
    return customer.id;
  }

  async createCheckoutSession(a: {
    customerId: string;
    packageId: string;
    packageKey: string;
    packageName: string;
    priceCents: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
    tenantId: string;
  }): Promise<{ id: string; url: string }> {
    // Inline `price_data` — deliberately no Stripe dashboard product/price setup (single-price,
    // monthly-interval, single-line-item subscriptions only).
    const session = await this.getClient().checkout.sessions.create({
      mode: 'subscription',
      customer: a.customerId,
      // `metadata.tenantId` is how the webhook handler resolves `checkout.session.completed` back to
      // a tenant before a `provider_subscription_id` even exists yet. `metadata.packageId` is how the
      // webhook handler learns *which* package this checkout was actually for, so it can apply the
      // upgrade/downgrade on completion. `packageKey` is kept alongside it purely as a human-readable
      // label when inspecting events in the Stripe dashboard; the webhook handler only ever trusts
      // `packageId`.
      metadata: { tenantId: a.tenantId, packageId: a.packageId, packageKey: a.packageKey },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: a.currency,
            unit_amount: a.priceCents,
            recurring: { interval: 'month' },
            product_data: { name: a.packageName },
          },
        },
      ],
      success_url: a.successUrl,
      cancel_url: a.cancelUrl,
    });

    if (!session.url) {
      // Stripe only omits `url` for a session created without a `success_url`/`ui_mode`
      // misconfiguration — should never happen given the fixed shape above, but surfacing it as a
      // thrown error (rather than returning an unusable empty string) keeps the port's contract
      // (`{ id: string; url: string }`, both always populated) honest for every caller.
      throw new Error('Stripe Checkout Session was created without a redirect URL.');
    }
    return { id: session.id, url: session.url };
  }

  verifyAndParseWebhook(rawBody: string | Buffer, signature: string): { id: string; type: string; data: unknown } {
    // `stripe.webhooks.constructEvent` is Stripe's own official verification routine — timing-safe
    // HMAC-SHA256 comparison plus a timestamp/replay-window check, never hand-rolled here (this
    // dispatch's exit gate is explicitly security-critical). Throws on any failure (missing/malformed
    // header, wrong secret, tampered payload, expired timestamp); the caller (`BillingWebhookService`)
    // catches *any* thrown error uniformly and maps it to the generic, non-disclosing
    // `WebhookSignatureInvalidError` — this method deliberately does not catch anything itself, so no
    // error detail is filtered or reshaped here either.
    const event = this.getClient().webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    return { id: event.id, type: event.type, data: event.data.object };
  }

  private getClient(): Stripe {
    if (this.client) return this.client;
    if (!this.secretKey) {
      throw new Error('Stripe is not configured (STRIPE_SECRET_KEY is empty).');
    }
    this.client = new Stripe(this.secretKey);
    return this.client;
  }
}
