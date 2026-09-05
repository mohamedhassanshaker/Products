/**
 * Cross-cutting port over the payment provider (Stripe) — ported from
 * `legacy/api/src/platform/billing/domain/ports/payment-gateway.port.ts`, relocated to
 * `common/ports/` rather than a `platform/billing/domain/ports/**` subfolder (a deliberate divergence
 * from legacy's per-module placement, matching this app's own `StoragePort`/`PasswordHasherPort`
 * precedent instead — see those files' own doc comments): the concrete adapter
 * (`server/infrastructure/payments/stripe.adapter.ts`) lives in a *different* top-level module than
 * `platform/billing`, and this app's module-boundary ESLint rules forbid a module from deep-importing
 * another module's `domain/**` — putting the port under `platform/billing/domain/ports/` would force
 * `infrastructure/payments` to either deep-import across that boundary (defeating the rule) or import
 * through `platform/billing`'s barrel (backwards: infrastructure depending on an application module).
 * `common/ports/` has no module-boundary rule at all (shared-kernel, stateless contract — nothing to
 * protect), so both `platform/billing`'s application services and `infrastructure/payments`'s adapter
 * import this file directly without any cross-module coupling in either direction.
 *
 * `platform/billing`'s application layer depends only on this interface, never on the `stripe` SDK
 * directly — enforced by `infrastructure/payments` being the *only* module allowed to import `stripe`
 * (LLD-equivalent import-boundary rule, matching legacy's identical confinement).
 *
 * Migration plan Phase 2 sub-slice "2c" (FR-PKG-6) is Platform-Admin-initiated only — self-serve
 * tenant-initiated checkout is Phase 9 scope — but every method here is still generic enough to serve
 * that later phase unchanged, exactly as legacy's own port doc comment notes.
 */
export interface PaymentGatewayPort {
  /**
   * Returns a provider customer id for the tenant, creating one only if `existingCustomerId` is
   * absent — FR-PKG-6: "a returning tenant reuses the same customer on a later attempt rather than
   * accumulating duplicate customer records."
   */
  ensureCustomer(t: { tenantId: string; name: string; email?: string; existingCustomerId?: string | null }): Promise<string>;

  /**
   * Creates a hosted Checkout Session for one monthly-recurring line item, priced inline via
   * `price_data` (no Stripe dashboard product/price setup needed). Does not itself grant access; the
   * tenant's subscription only moves to `ACTIVE` once the corresponding `checkout.session.completed`
   * webhook is verified and processed.
   */
  createCheckoutSession(a: {
    customerId: string;
    /** The catalog package's primary-key id — carried through Stripe's own session `metadata` so
     * `BillingWebhookService.handleCheckoutCompleted` can read it back on `checkout.session.completed`
     * and apply it to `tenant_subscription.package_id` in the same atomic write as the
     * status/provider-id update (ported verbatim: without this, a completed checkout never actually
     * changes which package a tenant is subscribed to). */
    packageId: string;
    packageKey: string;
    packageName: string;
    priceCents: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
    tenantId: string;
  }): Promise<{ id: string; url: string }>;

  /**
   * Verifies the webhook's cryptographic signature and parses the event. Must throw on any
   * verification failure (bad signature, wrong secret, tampered/expired payload) — callers map any
   * thrown error to a generic, non-disclosing 401 (`WEBHOOK_SIGNATURE_INVALID`). Security-critical:
   * concrete implementations must use the provider SDK's own signature-verification routine, never a
   * hand-rolled HMAC comparison.
   */
  verifyAndParseWebhook(rawBody: string | Buffer, signature: string): { id: string; type: string; data: unknown };
}
