import type { PaymentGatewayPort } from '@/server/common/ports/payment-gateway.port';
import { BillingNotConfiguredError, PackageInactiveError, PackageNotFoundError } from '../domain/errors';
import type { PackageRepository } from '../infrastructure/package.repository';
import type { TenantSubscriptionRepository } from '../infrastructure/tenant-subscription.repository';

/**
 * FR-PKG-6's Checkout-Session-creation half (migration plan Phase 2 sub-slice "2c"), ported logic
 * from `legacy/api/src/platform/billing/application/billing-checkout.service.ts`. **Platform-Admin-
 * initiated only** this dispatch — self-serve tenant-initiated checkout is Phase 9 scope (matching
 * legacy's own identical BL-36/P2 deferral), per the dispatch's own instruction and this file's own
 * `redirectUrls` parameter kept generic enough to serve that later phase unchanged.
 *
 * Creating a session never itself grants access (FR-PKG-6: "an abandoned checkout leaves the tenant
 * without access") — the tenant's subscription only moves to `ACTIVE` once `BillingWebhookService`
 * processes a verified `checkout.session.completed` event. This service's only side effect on
 * `tenant_subscription` is persisting a newly-created provider customer id, so a later retry reuses it
 * instead of accumulating duplicate Stripe customers (FR-PKG-6).
 *
 * **Deliberately has no dependency on `platform/tenants`** (unlike legacy's identically-scoped
 * service, which held its own `PlatformTenantRepository`) — the caller (the `POST .../checkout-session`
 * Route Handler) already resolves `tenantId` via `TenantsService.get` for its own `TENANT_NOT_FOUND`
 * check (the same "a module doesn't throw another bounded context's not-found code" contract
 * `AiModelsService.assignToTenant` already establishes in this app) and passes the tenant's `name`
 * straight through — avoiding a second, redundant cross-module dependency for this service to hold.
 */
export class BillingCheckoutService {
  constructor(
    private readonly packages: PackageRepository,
    private readonly subscriptions: TenantSubscriptionRepository,
    private readonly gateway: PaymentGatewayPort,
    private readonly opts: {
      stripeSecretKey: string;
      stripeWebhookSecret: string;
      checkoutSuccessUrlTemplate: string;
      checkoutCancelUrlTemplate: string;
    },
  ) {}

  /**
   * @param tenantId The already-validated tenant id (caller owns the `TENANT_NOT_FOUND` check).
   * @param tenantName The tenant's display name — used only as the Stripe customer's `name` on first
   *   creation.
   * @param packageId The catalog package the checkout targets.
   * @param redirectUrls Overrides the config-templated Platform Admin console success/cancel URLs.
   *   Omitted (this dispatch's only call site) falls back to the pre-configured
   *   `STRIPE_CHECKOUT_SUCCESS_URL`/`_CANCEL_URL` templates (or their derived platform-console
   *   defaults) — this parameter exists solely so a later, Phase-9 tenant-initiated checkout call site
   *   can redirect back to that tenant's own settings origin instead. No other business rule in this
   *   method changes based on who supplies this parameter.
   *
   * @throws {BillingNotConfiguredError} if `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are empty for
   *   this deployment.
   * @throws {PackageNotFoundError} if `packageId` doesn't resolve to any catalog package.
   * @throws {PackageInactiveError} if the target package is `isActive: false` — an inactive package is
   *   never a valid *new* checkout target (same rule `SubscriptionAdminService.reassign` enforces for a
   *   direct reassignment).
   */
  async createCheckoutSession(
    tenantId: string,
    tenantName: string,
    packageId: string,
    redirectUrls?: { successUrl: string; cancelUrl: string },
  ): Promise<{ url: string }> {
    // Checked first, and deliberately before any Stripe-independent validation below, so a
    // misconfigured deployment fails the same way regardless of which package was named — no
    // information about package validity is disclosed ahead of the config check.
    if (!this.opts.stripeSecretKey || !this.opts.stripeWebhookSecret) {
      throw new BillingNotConfiguredError();
    }

    const pkg = await this.packages.findById(packageId);
    if (!pkg) throw new PackageNotFoundError();
    if (!pkg.isActive) throw new PackageInactiveError();

    // Reuse the tenant's existing Stripe customer id if one was already recorded (FR-PKG-6) — from
    // either a prior checkout attempt or an earlier real subscription.
    const existingSubscription = await this.subscriptions.findByTenantId(tenantId);
    const customerId = await this.gateway.ensureCustomer({
      tenantId,
      name: tenantName,
      existingCustomerId: existingSubscription?.providerCustomerId ?? null,
    });
    if (!existingSubscription?.providerCustomerId) {
      // Persist the newly-minted customer id immediately (not only after checkout completes) so a
      // second checkout attempt — even one abandoned before any webhook fires — still reuses it.
      // Only ever reached when a subscription row already exists (`CreateSubscriptionStep` guarantees
      // one per tenant during provisioning), so this is a safe, targeted column update, never a reset
      // of a real ACTIVE/PAST_DUE/CANCELED status.
      await this.subscriptions.setProviderCustomerId(tenantId, customerId);
    }

    const session = await this.gateway.createCheckoutSession({
      customerId,
      // Carries the target package's id through Stripe metadata so `BillingWebhookService` can apply
      // it on `checkout.session.completed` — without this, a completed checkout never changes the
      // tenant's subscribed package.
      packageId: pkg.id,
      packageKey: pkg.key,
      packageName: pkg.name,
      priceCents: pkg.priceCents,
      currency: pkg.currency,
      tenantId,
      successUrl: redirectUrls?.successUrl ?? this.opts.checkoutSuccessUrlTemplate.replace('{tenantId}', tenantId),
      cancelUrl: redirectUrls?.cancelUrl ?? this.opts.checkoutCancelUrlTemplate.replace('{tenantId}', tenantId),
    });
    return { url: session.url };
  }
}
