import type pino from 'pino';
import type { PaymentGatewayPort } from '@/server/common/ports/payment-gateway.port';
import type { AuditLogService } from '@/server/platform/audit';
import { WebhookSignatureInvalidError } from '../domain/errors';
import type { PackageRepository } from '../infrastructure/package.repository';
import type { TenantSubscriptionRepository } from '../infrastructure/tenant-subscription.repository';

/** The subset of a Stripe Checkout Session fields this handler reads (ported from legacy's
 * `billing-webhook.service.ts`). Deliberately a hand-narrowed shape, not `Stripe.Checkout.Session` —
 * `platform/billing`'s application layer never imports the `stripe` SDK types (confined to
 * `infrastructure/payments`).
 *
 * `metadata.packageId` is the target package `BillingCheckoutService` stamps onto the session at
 * creation time (`StripePaymentGatewayAdapter.createCheckoutSession`) — read back here so completing
 * checkout actually changes which package the tenant is subscribed to. */
interface CheckoutSessionCompletedData {
  customer: string | null;
  subscription: string | null;
  metadata: { tenantId?: string; packageId?: string } | null;
}

/** The subset of a Stripe Subscription object fields this handler reads. */
interface SubscriptionEventData {
  id: string;
  status: string;
  current_period_start?: number;
  current_period_end?: number;
}

/** Maps Stripe's own subscription status vocabulary to this system's three-state
 * ACTIVE/PAST_DUE/CANCELED. Any value not explicitly listed here, including a status Stripe might
 * introduce in the future, maps to `PAST_DUE`, never `ACTIVE`: FR-PKG-6's fail-toward-restrictive rule
 * means an unrecognized status must never be interpreted as still-fine, since that would silently keep
 * granting access that should have been revoked. Ported verbatim from legacy's identical mapping. */
function mapProviderStatusToSubscriptionStatus(providerStatus: string): 'ACTIVE' | 'PAST_DUE' | 'CANCELED' {
  switch (providerStatus) {
    case 'active':
    case 'trialing':
      return 'ACTIVE';
    case 'canceled':
    case 'incomplete_expired':
      return 'CANCELED';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'PAST_DUE';
    default:
      return 'PAST_DUE';
  }
}

/** undefined/null-safe Unix-seconds to Date conversion (Stripe timestamps are seconds, not
 * milliseconds). */
function toDateOrNull(unixSeconds: number | undefined): Date | null {
  return typeof unixSeconds === 'number' ? new Date(unixSeconds * 1000) : null;
}

/**
 * FR-PKG-6 webhook-driven half (migration plan Phase 2 sub-slice "2c"), ported logic from
 * `legacy/api/src/platform/billing/application/billing-webhook.service.ts`. Security-critical: every
 * branch below is deliberately structured so no path can move a tenant to `ACTIVE` without a genuinely
 * verified event, and no path can ever throw back into an HTTP 5xx that would make Stripe retry
 * indefinitely for a condition that will never resolve (an unknown event type or an unmatched
 * subscription id are both terminal 200s, not errors).
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `System`-attributed `platform.audit_log` row (not
 * `PlatformAdmin` — no human admin initiated a webhook delivery) after each of the three handled event
 * types successfully applies its own write, mirroring legacy's identical
 * `billing.checkout_completed`/`billing.subscription_updated`/`billing.subscription_canceled` action
 * names. No audit row is written for an ignored/unmatched event (nothing changed, so nothing to
 * record) — matching legacy's own identical scoping. `AuditLogService.record` is itself fail-open (see
 * its own doc comment), so a logging failure here can never turn a successfully-processed webhook
 * event into a 5xx that would make Stripe retry indefinitely.
 */
export class BillingWebhookService {
  constructor(
    private readonly gateway: PaymentGatewayPort,
    private readonly subscriptions: TenantSubscriptionRepository,
    private readonly packages: PackageRepository,
    private readonly audit: AuditLogService,
    private readonly logger: pino.Logger,
  ) {}

  /**
   * @throws {WebhookSignatureInvalidError} if signature verification fails for any reason. The caller
   *   (the `POST /api/platform/billing/webhook` Route Handler) must map this to a bare 401 with no
   *   additional detail.
   *
   * Every other outcome (unknown event type, unmatched subscription id, or a successfully processed
   * event) resolves normally; the route always responds 200 in those cases, per FR-PKG-6.
   */
  async handle(rawBody: string | Buffer, signature: string): Promise<void> {
    let event: { id: string; type: string; data: unknown };
    try {
      event = this.gateway.verifyAndParseWebhook(rawBody, signature);
    } catch (err) {
      this.logger.warn({ err: (err as Error)?.message }, 'billing.webhook_signature_invalid');
      throw new WebhookSignatureInvalidError();
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.id, event.data as CheckoutSessionCompletedData);
        return;
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.id, event.data as SubscriptionEventData);
        return;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.id, event.data as SubscriptionEventData);
        return;
      default:
        this.logger.info({ eventId: event.id, eventType: event.type }, 'billing.webhook_event_ignored_unknown_type');
        return;
    }
  }

  private async handleCheckoutCompleted(eventId: string, data: CheckoutSessionCompletedData): Promise<void> {
    const tenantId = data.metadata?.tenantId;
    const subscription = tenantId ? await this.subscriptions.findByTenantId(tenantId) : null;
    if (!subscription || !data.customer || !data.subscription) {
      this.logger.warn({ eventId, tenantId }, 'billing.webhook_checkout_completed_unmatched');
      return;
    }

    // Resolves the target package from the session's own metadata (stamped on at checkout-session
    // creation) and re-validates it server-side before ever writing it — never trust a webhook
    // payload's id blindly, the same "re-derive, don't trust the caller" rule `BillingCheckoutService`
    // already applies when a Checkout Session is first created. A missing/unresolvable packageId (a
    // replayed pre-existing session, or a hand-crafted/malformed test event) is not fatal: it's logged
    // and the existing packageId is left untouched, rather than nulling it out or failing the whole
    // webhook (which would make Stripe retry indefinitely for a condition that can never resolve).
    let resolvedPackageId: string | undefined;
    const metadataPackageId = data.metadata?.packageId;
    if (metadataPackageId) {
      const pkg = await this.packages.findById(metadataPackageId);
      if (pkg) {
        resolvedPackageId = pkg.id;
      } else {
        this.logger.warn(
          { eventId, tenantId, metadataPackageId },
          'billing.webhook_checkout_completed_unknown_package_in_metadata',
        );
      }
    } else {
      this.logger.warn({ eventId, tenantId }, 'billing.webhook_checkout_completed_missing_package_metadata');
    }

    await this.subscriptions.markActiveFromCheckout(tenantId as string, {
      providerCustomerId: data.customer,
      providerSubscriptionId: data.subscription,
      packageId: resolvedPackageId,
    });
    this.logger.info(
      { eventId, tenantId, providerSubscriptionId: data.subscription, packageId: resolvedPackageId },
      'billing.checkout_completed',
    );
    await this.audit.record({
      actorType: 'System',
      tenantId: tenantId as string,
      action: 'billing.checkout_completed',
      targetType: 'TenantSubscription',
      targetId: tenantId as string,
      summary: { providerSubscriptionId: data.subscription, packageId: resolvedPackageId },
    });
  }

  private async handleSubscriptionUpdated(eventId: string, data: SubscriptionEventData): Promise<void> {
    const subscription = await this.subscriptions.findByProviderSubscriptionId(data.id);
    if (!subscription) {
      this.logger.warn({ eventId, providerSubscriptionId: data.id }, 'billing.webhook_subscription_updated_unmatched');
      return;
    }

    const status = mapProviderStatusToSubscriptionStatus(data.status);
    await this.subscriptions.updateStatusAndPeriod(data.id, {
      status,
      currentPeriodStart: toDateOrNull(data.current_period_start),
      currentPeriodEnd: toDateOrNull(data.current_period_end),
    });
    this.logger.info(
      { eventId, tenantId: subscription.tenantId, providerSubscriptionId: data.id, providerStatus: data.status, mappedStatus: status },
      'billing.subscription_updated',
    );
    await this.audit.record({
      actorType: 'System',
      tenantId: subscription.tenantId,
      action: 'billing.subscription_updated',
      targetType: 'TenantSubscription',
      targetId: subscription.tenantId,
      summary: { providerSubscriptionId: data.id, providerStatus: data.status, mappedStatus: status },
    });
  }

  private async handleSubscriptionDeleted(eventId: string, data: SubscriptionEventData): Promise<void> {
    const subscription = await this.subscriptions.findByProviderSubscriptionId(data.id);
    if (!subscription) {
      this.logger.warn({ eventId, providerSubscriptionId: data.id }, 'billing.webhook_subscription_deleted_unmatched');
      return;
    }

    await this.subscriptions.markCanceled(data.id);
    this.logger.info({ eventId, tenantId: subscription.tenantId, providerSubscriptionId: data.id }, 'billing.subscription_canceled');
    await this.audit.record({
      actorType: 'System',
      tenantId: subscription.tenantId,
      action: 'billing.subscription_canceled',
      targetType: 'TenantSubscription',
      targetId: subscription.tenantId,
      summary: { providerSubscriptionId: data.id },
    });
  }
}
