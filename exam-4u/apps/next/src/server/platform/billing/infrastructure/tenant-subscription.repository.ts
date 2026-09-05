import { randomUUID } from 'node:crypto';
import type { DataSource, Repository } from 'typeorm';
import type { TenantSubscriptionEntity } from '@/server/infrastructure/database';

/**
 * Data access over `platform.tenant_subscription` — ported from
 * `legacy/api/src/platform/subscriptions/infrastructure/repositories/tenant-subscription.
 * repository.ts`. `CreateSubscriptionStep` (Phase 1) creates the initial `ACTIVE` row during
 * provisioning; migration plan Phase 2 sub-slice "2c" adds every write method Stripe-driven status
 * transitions (`BillingWebhookService`) and direct reassignment (`SubscriptionAdminService`) need.
 */
export class TenantSubscriptionRepository {
  private readonly repo: Repository<TenantSubscriptionEntity>;

  constructor(dataSource: DataSource) {
    // String-name lookup, not the class reference (fixed Phase 1 sub-slice 1b — see
    // `server/tenancy/raw-tenant-lookup.ts`'s doc comment for the cross-webpack-bundle
    // entity-class-identity mismatch this avoids).
    this.repo = dataSource.getRepository<TenantSubscriptionEntity>('tenant_subscription');
  }

  /** A tenant's subscription row, or `null` for a tenant with none yet (FR-PKG-4: "treated as having
   * zero enabled features, never as unlimited"). Not yet consumed this dispatch — kept for the
   * feature-usage-enforcement phase. */
  async findByTenantId(tenantId: string): Promise<TenantSubscriptionEntity | null> {
    return this.repo.findOne({ where: { tenantId } });
  }

  /**
   * Idempotent create-or-update of a tenant's single subscription row, keyed on the `uq_sub_tenant`
   * unique constraint (one subscription per tenant). Used by `CreateSubscriptionStep` — a retried
   * provisioning attempt must not create a second row nor fail on a duplicate-key error.
   *
   * **Real, production-breaking bug found and fixed via this dispatch's own real-browser Playwright
   * pass** (`scripts/playwright-smoke.ts`) — `.into(TenantSubscriptionEntity)` (the entity **class**
   * reference) previously threw `TypeError: this.subQuery is not a function` when this step ran inside
   * the real, production-built `next start` server (never reproduced by any vitest-level test, which
   * calls this method in-process without Next.js's own webpack chunk-splitting). This is the exact
   * same cross-webpack-bundle entity-class-identity bug class Phase 1 sub-slice 1b already found and
   * fixed for `dataSource.getRepository(EntityClass)` (see `server/tenancy/raw-tenant-lookup.ts`'s doc
   * comment) — that fix only covered `getRepository()` call sites; this is a second, distinct call
   * site (`InsertQueryBuilder.into()`) with an identical root cause that had gone unfixed because no
   * prior real-HTTP/browser pass had ever exercised `CreateSubscriptionStep` against the actual built
   * server. Fixed the same way: pass the literal table-name string, immune to any class-identity/
   * minification issue since it's a string I write, not a runtime-derived class reference.
   */
  async upsertForTenant(
    tenantId: string,
    packageId: string,
    status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' = 'ACTIVE',
  ): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .insert()
      .into('tenant_subscription')
      .values({ id: randomUUID(), tenantId, packageId, status })
      .orUpdate(['package_id', 'status'], ['tenant_id'])
      .execute();
  }

  /** By the provider's own subscription id (`stripe`'s `Subscription.id`) — the join key every
   * `customer.subscription.*` webhook event is matched on (Phase 2 sub-slice "2c"). `null` means "no
   * tenant subscription row currently references this provider subscription id," which
   * `BillingWebhookService` treats as FR-PKG-6's documented "log and ignore (200)" case, never a
   * failure. */
  async findByProviderSubscriptionId(providerSubscriptionId: string): Promise<TenantSubscriptionEntity | null> {
    return this.repo.findOne({ where: { providerSubscriptionId } });
  }

  /** Records a newly-minted Stripe customer id the first time `BillingCheckoutService` creates one for
   * a tenant (FR-PKG-6: "a returning tenant reuses the same customer... rather than accumulating
   * duplicate customer records"). Only ever called on a tenant that already has a subscription row
   * (`CreateSubscriptionStep` guarantees one per tenant), so this is a plain column update, not an
   * upsert. */
  async setProviderCustomerId(tenantId: string, providerCustomerId: string): Promise<void> {
    await this.repo.update({ tenantId }, { providerCustomerId });
  }

  /**
   * `checkout.session.completed` (FR-PKG-6): moves the tenant's subscription to `ACTIVE` and records
   * both provider ids — this is the *only* place `providerSubscriptionId` is ever first written (a
   * Checkout Session doesn't exist yet when `provider_customer_id` alone was recorded by
   * {@link setProviderCustomerId}).
   *
   * @param fields.packageId The target package read back from the completed session's
   *   `metadata.packageId` (see `BillingWebhookService.handleCheckoutCompleted`). Applied in this
   *   *same* single `UPDATE` as `status`/the provider ids — deliberately not a second write — so a
   *   crash between the two could never leave the row `ACTIVE` on the *old* package. `undefined` (a
   *   webhook replay of a session predating this field, or a malformed/hand-crafted test event with no
   *   `packageId` in its metadata) leaves the column untouched rather than nulling it out or failing
   *   the whole webhook — the tenant simply keeps whatever package it already had, the safer of the two
   *   failure modes for a field TypeORM's `update()` never includes in the `SET` clause when the value
   *   is `undefined`.
   */
  async markActiveFromCheckout(
    tenantId: string,
    fields: { providerCustomerId: string; providerSubscriptionId: string; packageId?: string },
  ): Promise<void> {
    await this.repo.update(
      { tenantId },
      {
        status: 'ACTIVE',
        providerCustomerId: fields.providerCustomerId,
        providerSubscriptionId: fields.providerSubscriptionId,
        ...(fields.packageId ? { packageId: fields.packageId } : {}),
      },
    );
  }

  /**
   * `customer.subscription.updated` (FR-PKG-6): applies the caller's already-mapped status (see
   * `BillingWebhookService`'s status-mapping table, including the fail-toward-restrictive `PAST_DUE`
   * default for an unrecognized provider status) plus the provider's current billing period dates.
   */
  async updateStatusAndPeriod(
    providerSubscriptionId: string,
    fields: { status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED'; currentPeriodStart: Date | null; currentPeriodEnd: Date | null },
  ): Promise<void> {
    await this.repo.update(
      { providerSubscriptionId },
      { status: fields.status, currentPeriodStart: fields.currentPeriodStart, currentPeriodEnd: fields.currentPeriodEnd },
    );
  }

  /** `customer.subscription.deleted` (FR-PKG-6): `CANCELED` unconditionally, regardless of the
   * subscription's status immediately beforehand. */
  async markCanceled(providerSubscriptionId: string): Promise<void> {
    await this.repo.update({ providerSubscriptionId }, { status: 'CANCELED' });
  }
}
