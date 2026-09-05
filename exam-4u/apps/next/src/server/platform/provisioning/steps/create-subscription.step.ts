import type { ProvisioningStepName } from '@examland/contracts';
import { getEnv } from '@/server/config';
import type { PackageRepository, TenantSubscriptionRepository } from '@/server/platform/billing';
import type { ProvisioningContext, ProvisioningStep } from '@/server/tenancy';

/**
 * HLD §4.4 step 5: `INSERT TenantSubscription(packageId, status=ACTIVE)` — ported verbatim from
 * `legacy/api/src/tenancy/provisioning/steps/create-subscription.step.ts`. Writes against the
 * **platform** schema (not the tenant schema) — a subscription is platform-owned billing/entitlement
 * state.
 *
 * Looks up the real, migration-seeded catalog package identified by `getEnv().FALLBACK_PACKAGE_KEY`
 * (default `'starter'`) and subscribes the new tenant to it. If that package is somehow missing from
 * the catalog (a broken deployment — the seed migration is expected to have run before any tenant is
 * ever provisioned), this step throws rather than silently falling back to an unlimited/undefined
 * package, so provisioning fails loudly (`Failed` status, retriable) instead of creating a tenant
 * with an undefined entitlement state.
 *
 * Idempotent via `TenantSubscriptionRepository.upsertForTenant`'s natural-key upsert (`uq_sub_tenant`
 * — one subscription per tenant), so a retried provisioning attempt never creates a duplicate row.
 *
 * **This is exactly the "pulled forward" step the migration plan calls out**: the package/feature/
 * subscription catalog migration+seed+read-path (`server/platform/billing`) had to land in this same
 * dispatch precisely because this step hard-depends on the seeded `starter` package existing.
 */
export class CreateSubscriptionStep implements ProvisioningStep {
  readonly name: ProvisioningStepName = 'create_subscription';

  constructor(
    private readonly packages: PackageRepository,
    private readonly subscriptions: TenantSubscriptionRepository,
  ) {}

  async run(ctx: ProvisioningContext): Promise<void> {
    const starterKey = getEnv().FALLBACK_PACKAGE_KEY;
    const starterPackage = await this.packages.findByKey(starterKey);
    if (!starterPackage) {
      throw new Error(
        `Cannot provision tenant '${ctx.tenant.subdomainSlug}': the starter package ('${starterKey}') is missing from the ` +
          'platform catalog. Ensure the SeedFeaturePackageCatalog migration has run.',
      );
    }

    await this.subscriptions.upsertForTenant(ctx.tenant.id, starterPackage.id, 'ACTIVE');
  }
}
