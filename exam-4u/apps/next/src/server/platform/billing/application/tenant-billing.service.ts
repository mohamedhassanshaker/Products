import type { PackageRepository } from '../infrastructure/package.repository';
import type { TenantSubscriptionRepository } from '../infrastructure/tenant-subscription.repository';
import type { BillingCheckoutService } from './billing-checkout.service';

/** One catalog entry on the self-serve plan-upgrade screen — mirrors legacy's `TenantPlanSummary`
 * projection (LLD §1.4: controllers/screens never consume the entity directly). */
export interface TenantPlanSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  sortOrder: number;
}

export interface TenantPlansResponse {
  /** `null` if the tenant has no subscription row yet (FR-PKG-4: treated as zero enabled features,
   * never as "on some plan"). */
  currentPackageId: string | null;
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | null;
  /** Active packages only (`SubscriptionAdminService`/`BillingCheckoutService`'s own identical rule:
   * an inactive package is never a valid *new* selection target — see `PackageRepository.findAllActive`'s
   * own doc comment). */
  packages: TenantPlanSummary[];
}

/**
 * The self-serve (Tenant-Admin-initiated) half of FR-PKG-6 (migration plan Phase 9 sub-slice "9b") —
 * ported logic from `legacy/api/src/platform/billing/application/tenant-billing.service.ts`.
 * Deliberately reuses {@link BillingCheckoutService} completely unmodified in its business logic (only
 * the `redirectUrls` parameter sub-slice "2c" already added is exercised here); this class contributes
 * nothing new to Checkout-Session creation itself, only the tenant-realm read path (plan catalog +
 * current subscription) and the tenant-origin redirect URLs a Tenant Admin needs instead of the
 * Platform Admin console's own.
 *
 * **Deliberately has no dependency on `platform/tenants`** — the same reasoning
 * `BillingCheckoutService`'s own doc comment documents: the caller (the tenant-realm Route Handler)
 * already resolves the tenant's `name`/`subdomainSlug` via `TenantsService.get` for its own use before
 * calling this service, so a second, redundant cross-module dependency here would just duplicate that
 * lookup.
 */
export class TenantBillingService {
  constructor(
    private readonly packages: PackageRepository,
    private readonly subscriptions: TenantSubscriptionRepository,
    private readonly checkout: BillingCheckoutService,
  ) {}

  /** The plan-upgrade screen's source data: every active catalog package, plus which one (if any) is
   * the tenant's current plan and its lifecycle status. Never throws on "no subscription yet" — that
   * is a valid, common state for a freshly-provisioned tenant, not an error. */
  async getPlans(tenantId: string): Promise<TenantPlansResponse> {
    const [activePackages, subscription] = await Promise.all([
      this.packages.findAllActive(),
      this.subscriptions.findByTenantId(tenantId),
    ]);
    return {
      currentPackageId: subscription?.packageId ?? null,
      status: subscription?.status ?? null,
      packages: activePackages.map((pkg) => ({
        id: pkg.id,
        key: pkg.key,
        name: pkg.name,
        description: pkg.description,
        priceCents: pkg.priceCents,
        currency: pkg.currency,
        sortOrder: pkg.sortOrder,
      })),
    };
  }

  /**
   * Initiates a Checkout Session for the calling tenant's own upgrade choice. Delegates entirely to
   * {@link BillingCheckoutService.createCheckoutSession} (unchanged validation/error taxonomy —
   * `BillingNotConfiguredError`/`PackageNotFoundError`/`PackageInactiveError` all propagate verbatim),
   * supplying only this tenant's own `/settings/billing` origin as the redirect target instead of the
   * Platform Admin console's `/platform/tenants/{tenantId}` one.
   *
   * @param tenantId The already-resolved, ALS-derived tenant id (caller owns tenant resolution — see
   *   this class's own doc comment on why `platform/tenants` isn't a dependency here).
   * @param tenantName Passed straight through to `BillingCheckoutService` (Stripe customer display name
   *   on first creation only).
   * @param tenantOrigin The tenant's own browser-reachable origin (e.g.
   *   `https://{subdomainSlug}.{PUBLIC_APEX_DOMAIN}`) — used to build the `/settings/billing?checkout=...`
   *   redirect targets so Stripe sends the browser back to *this* tenant's own settings page, never the
   *   Platform Admin console's.
   */
  async initiateCheckout(
    tenantId: string,
    tenantName: string,
    tenantOrigin: string,
    packageId: string,
  ): Promise<{ url: string }> {
    const base = `${tenantOrigin}/settings/billing`;
    return this.checkout.createCheckoutSession(tenantId, tenantName, packageId, {
      successUrl: `${base}?checkout=success`,
      cancelUrl: `${base}?checkout=cancel`,
    });
  }
}
