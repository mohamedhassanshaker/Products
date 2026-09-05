import { PackageInactiveError, PackageNotFoundError } from '../domain/errors';
import type { PackageRepository } from '../infrastructure/package.repository';
import type { TenantSubscriptionRepository } from '../infrastructure/tenant-subscription.repository';

/** The tenant-detail screen's billing panel data: the current package's display fields plus the
 * subscription's own lifecycle status. `null` means the tenant has no subscription row at all yet
 * (FR-PKG-4: "treated as having zero enabled features, never as unlimited"). */
export interface TenantSubscriptionSummary {
  packageId: string;
  packageKey: string;
  packageName: string;
  priceCents: number;
  currency: string;
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
  /** Non-`null` once a Stripe customer has ever been created for this tenant (via a checkout-session
   * creation) — the billing panel uses this only to decide whether to say "no Stripe customer yet",
   * never displayed as a raw id to the admin beyond that. */
  hasProviderCustomer: boolean;
}

/**
 * Platform Admin surface over a *specific tenant's* subscription (FR-PKG-4/FR-PKG-7: "view/reassign
 * any tenant's active subscription"), migration plan Phase 2 sub-slice "2c". Ported logic from
 * `legacy/api/src/platform/subscriptions/application/subscription-admin.service.ts`'s
 * `getSubscriptionWithUsage`/`reassign` pair — **the usage-snapshot half is deliberately not ported**:
 * legacy's `getSubscriptionWithUsage` also returned a per-feature usage snapshot via
 * `FeatureUsageService`, but no `platform/usage` module exists yet in this app (feature-usage
 * enforcement is a later phase's scope per the migration plan's own sequencing — nothing in Phase 0-2's
 * item list mentions it). This dispatch's `getSummary` therefore returns only the subscription/package
 * half of legacy's combined shape; a later phase that builds `platform/usage` can extend this method's
 * return shape (or add a sibling one) without needing to change `reassign`'s contract at all.
 *
 * **Deliberately no dependency on `platform/tenants`** — the same reasoning
 * `BillingCheckoutService`'s own doc comment documents: the caller (the `GET`/`PUT
 * .../tenants/:id/billing` Route Handlers) already resolves `tenantId` via `TenantsService.get` for its
 * own `TENANT_NOT_FOUND` check before ever calling this service.
 */
export class SubscriptionAdminService {
  constructor(
    private readonly packages: PackageRepository,
    private readonly subscriptions: TenantSubscriptionRepository,
  ) {}

  /** Reads a tenant's current subscription summary, or `null` if none exists yet. Caller owns the
   * `TENANT_NOT_FOUND` check (see class doc comment). */
  async getSummary(tenantId: string): Promise<TenantSubscriptionSummary | null> {
    const sub = await this.subscriptions.findByTenantId(tenantId);
    if (!sub) return null;

    const pkg = await this.packages.findById(sub.packageId);
    // A subscription row pointing at a package id that no longer exists shouldn't happen
    // (`fk_sub_package ... ON DELETE RESTRICT`, and packages aren't hard-deletable in this app) —
    // defensively treat it the same as "no subscription" rather than throwing, since this is a read
    // path a Platform Admin needs even in a data-inconsistency edge case.
    if (!pkg) return null;

    return {
      packageId: pkg.id,
      packageKey: pkg.key,
      packageName: pkg.name,
      priceCents: pkg.priceCents,
      currency: pkg.currency,
      status: sub.status,
      hasProviderCustomer: sub.providerCustomerId !== null,
    };
  }

  /**
   * Reassigns a tenant's subscription to a different package directly, without going through Stripe
   * checkout (FR-PKG-4: "takes effect immediately for enforcement purposes; usage already
   * recorded... carries forward") — e.g. comping a tenant, or correcting a mistake. Preserves the
   * subscription's existing status (a reassignment is a package change, not a status change); a
   * tenant with no subscription row yet is given a fresh `ACTIVE` one.
   *
   * @throws {PackageNotFoundError} if `packageId` doesn't resolve to any package.
   * @throws {PackageInactiveError} if the target package is `isActive: false` (an inactive package is
   *   never a valid *new* assignment target).
   */
  async reassign(tenantId: string, packageId: string): Promise<TenantSubscriptionSummary> {
    const pkg = await this.packages.findById(packageId);
    if (!pkg) throw new PackageNotFoundError();
    if (!pkg.isActive) throw new PackageInactiveError();

    const existing = await this.subscriptions.findByTenantId(tenantId);
    const status = existing?.status ?? 'ACTIVE';
    await this.subscriptions.upsertForTenant(tenantId, packageId, status);

    return {
      packageId: pkg.id,
      packageKey: pkg.key,
      packageName: pkg.name,
      priceCents: pkg.priceCents,
      currency: pkg.currency,
      status,
      hasProviderCustomer: existing?.providerCustomerId !== null && existing?.providerCustomerId !== undefined,
    };
  }
}
