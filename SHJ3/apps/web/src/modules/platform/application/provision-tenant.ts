/**
 * Provision a tenant across all four stores.
 *
 * Implements FR-PLAT-02. This is the use case whose correctness the entire
 * isolation argument rests on: every other guarantee in the system assumes a
 * tenant's four isolation units exist and belong to it alone.
 *
 * ## The shape of the problem
 *
 * Four stores, no distributed transaction (ADR-0003 rule 4). So atomicity is
 * achieved observably rather than transactionally:
 *
 *   1. Register the tenant as `Provisioning`. It is now recorded but not
 *      addressable — traffic is gated on `Active`.
 *   2. Create each isolation unit in order, verifying each before moving on.
 *   3. Flip the registry to `Active`. **This is the only commit point.**
 *
 * If any step fails, every step that created anything is rolled back in reverse
 * order and the tenant is left `Failed`. It is never left addressable.
 *
 * ## Why verify after create
 *
 * A `create` that returns without error has not proven anything — especially for
 * Neo4j, where ADR-0009 replaced `CREATE DATABASE` with label-scoped index
 * creation in a shared database. "The statement ran" and "this tenant's
 * isolation unit exists and is correctly shaped" are different claims, and only
 * the second one is safe to build on.
 *
 * This module imports no vendor package (architecture.md §4), so the same logic
 * is exercised by unit tests with fakes and by integration tests against real
 * containers.
 */

import {
  isFullyProvisioned,
  stepsRequiringRollback,
  TenantProvisioningError,
  TenantRollbackError,
  type ProvisioningStep,
  type ProvisioningStore,
  type Tenant,
} from "../domain/tenant.js";
import type {
  AuditActor,
  AuditSink,
  Clock,
  StoreProvisioner,
  TenantProvisionedHook,
  TenantRegistry,
} from "../ports/provisioning.js";
import { PROVISIONING_STORES } from "../domain/tenant.js";
import type { TenantSlug } from "../tenancy/tenant-slug.js";

export interface ProvisionTenantInput {
  slug: TenantSlug;
  displayName: string;
  embeddingModel: string;
  embeddingDimensions: number;
  /** The Super Admin performing this. Recorded on every audit entry. */
  actor: AuditActor;
  environment: string;
  /**
   * `GovernmentEntity` (the default) or `PlatformOperator` — added for B-2. Every tenant
   * provisioned before B-2 was implicitly `GovernmentEntity` (`PrismaTenantRegistry`'s own
   * hardcoded default); B9 tab 2's "Platform -> All entities" row needs a genuine
   * `PlatformOperator` tenant to exist at all (`TR_Teams_crossEntityScope` — `prisma/sql/
   * 001_constraints.sql` — rejects an `AllEntities`-scoped team everywhere else), and
   * nothing before this wave could ever provision one. Optional and defaulted, so every
   * existing caller (the isolation suite's own fixture, `tests/isolation/setup.ts`)
   * continues to provision an ordinary `GovernmentEntity` tenant unchanged.
   */
  entityKind?: "GovernmentEntity" | "PlatformOperator";
}

export interface ProvisionTenantDeps {
  registry: TenantRegistry;
  /** One per store. Ordering comes from PROVISIONING_STORES, not from this map. */
  provisioners: readonly StoreProvisioner[];
  audit: AuditSink;
  clock: Clock;
  /**
   * Feature-module default-data seeding, run once the tenant is `Active` (see
   * `TenantProvisionedHook`'s own doc comment for why this exists and why `platform` cannot
   * simply call a feature module's use case directly). Optional and defaulted to none, so
   * every existing caller (the isolation suite's own fixture) is unaffected until it opts in.
   */
  postProvisionHooks?: readonly TenantProvisionedHook[];
}

export class ProvisionTenant {
  constructor(private readonly deps: ProvisionTenantDeps) {}

  async execute(input: ProvisionTenantInput): Promise<Tenant> {
    const { registry, audit, clock } = this.deps;
    const { slug } = input;

    const provisioners = this.orderedProvisioners();

    // Reusing a slug whose stores may still hold residue is how one government
    // entity would inherit another's data, so an existing row blocks — including
    // one left in Failed. Cleaning up residue is RB-10, a deliberate act.
    const existing = await registry.findBySlug(slug);
    if (existing) {
      await audit.record({
        actor: input.actor,
        action: "tenant.provision",
        target: { kind: "Tenant", labelSnapshot: slug },
        summary: `Tenant "${slug}" provisioning refused: slug already registered with status ${existing.status}.`,
        environmentKey: input.environment,
        after: { reason: "slug already registered", status: existing.status },
        tenant: { slugSnapshot: slug },
      });
      throw new Error(
        `Tenant "${slug}" is already registered with status ${existing.status}. ` +
          "A slug is never reused, because its stores may still hold data — " +
          "clean up via RB-10 and choose a new slug.",
      );
    }

    await registry.register({
      slug,
      displayName: input.displayName,
      embeddingModel: input.embeddingModel,
      embeddingDimensions: input.embeddingDimensions,
      ...(input.entityKind !== undefined ? { entityKind: input.entityKind } : {}),
    });

    const completed: ProvisioningStep[] = [];

    for (const provisioner of provisioners) {
      const startedAt = clock.now();
      await registry.recordStep(slug, { store: provisioner.store, status: "Running", startedAt });

      try {
        await provisioner.create(slug);

        // "The statement ran" is not "the isolation unit exists".
        const verified = await provisioner.verify(slug);
        if (!verified) {
          throw new Error(
            "post-create verification failed: the isolation unit is absent or misshaped",
          );
        }

        const step: ProvisioningStep = {
          store: provisioner.store,
          status: "Completed",
          startedAt,
          completedAt: clock.now(),
        };
        await registry.recordStep(slug, step);
        completed.push(step);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await registry.recordStep(slug, {
          store: provisioner.store,
          status: "Failed",
          startedAt,
          failureReason: reason,
        });
        completed.push({ store: provisioner.store, status: "Failed", startedAt });

        await this.rollback(slug, completed, input);

        await audit.record({
          actor: input.actor,
          action: "tenant.provision",
          target: { kind: "Tenant", labelSnapshot: slug },
          summary: `Tenant "${slug}" provisioning failed at the ${provisioner.store} step: ${reason}`,
          environmentKey: input.environment,
          after: { failedStore: provisioner.store, reason },
          tenant: { slugSnapshot: slug },
        });

        throw new TenantProvisioningError(slug, provisioner.store, error);
      }
    }

    // The commit point. Guarded here as well as in the registry, because a
    // tenant activated with an incomplete store set is unrecoverable — it would
    // start serving traffic against isolation units that do not exist.
    if (!isFullyProvisioned(completed)) {
      await this.rollback(slug, completed, input);
      throw new Error(
        `Refusing to activate tenant "${slug}": expected ${PROVISIONING_STORES.length} completed ` +
          `steps, got ${completed.filter((s) => s.status === "Completed").length}.`,
      );
    }

    const activatedAt = clock.now();
    await registry.setStatus(slug, "Active", activatedAt);

    await audit.record({
      actor: input.actor,
      action: "tenant.provision",
      target: { kind: "Tenant", labelSnapshot: slug },
      summary: `Tenant "${slug}" provisioned across all four stores.`,
      environmentKey: input.environment,
      after: {
        stores: PROVISIONING_STORES,
        embeddingModel: input.embeddingModel,
        embeddingDimensions: input.embeddingDimensions,
      },
      tenant: { slugSnapshot: slug },
    });

    const tenant = await registry.findBySlug(slug);
    if (!tenant) {
      throw new Error(
        `Tenant "${slug}" vanished from the registry immediately after activation. ` +
          "This indicates registry corruption; do not retry until it is investigated.",
      );
    }

    await this.runPostProvisionHooks(slug, input);

    return tenant;
  }

  /**
   * Best-effort feature-module default-data seeding, run after the tenant is already
   * `Active`. See `TenantProvisionedHook`'s own doc comment for why a failure here is
   * caught and audited rather than thrown: the tenant's isolation units are already real and
   * verified by this point, and a hook failure must never make a correctly-provisioned
   * tenant look like a failed one.
   */
  private async runPostProvisionHooks(
    slug: TenantSlug,
    input: ProvisionTenantInput,
  ): Promise<void> {
    for (const hook of this.deps.postProvisionHooks ?? []) {
      try {
        await hook.onTenantProvisioned(slug);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await this.deps.audit.record({
          actor: input.actor,
          action: "tenant.provision.postHookFailed",
          target: { kind: "Tenant", labelSnapshot: slug },
          summary:
            `Tenant "${slug}" activated, but the "${hook.name}" post-provision hook failed: ` +
            reason,
          environmentKey: input.environment,
          after: { hook: hook.name, reason },
          tenant: { slugSnapshot: slug },
        });
        console.error(
          `ProvisionTenant: post-provision hook "${hook.name}" failed for tenant "${slug}": ` +
            `${reason}. The tenant remains Active — hooks seed convenience/default data, not ` +
            "the isolation guarantee this use case's four-store commit already proved.",
        );
      }
    }
  }

  /**
   * Compensating rollback, in reverse creation order.
   *
   * Every failure is collected rather than thrown on, so one uncooperative store
   * cannot prevent the other three from being cleaned up. Leaving three units
   * behind because the fourth refused would be strictly worse than leaving one.
   *
   * Rollback failures do not mask the original error: the caller still receives
   * `TenantProvisioningError`, and the residue is reported separately so an
   * operator knows to run RB-10.
   */
  private async rollback(
    slug: TenantSlug,
    steps: readonly ProvisioningStep[],
    input: ProvisionTenantInput,
  ): Promise<void> {
    const byStore = new Map(this.deps.provisioners.map((p) => [p.store, p]));
    const failures: { store: ProvisioningStore; reason: string }[] = [];

    for (const store of stepsRequiringRollback(steps)) {
      const provisioner = byStore.get(store);
      if (!provisioner) continue;

      try {
        await provisioner.destroy(slug);

        // Erasure has to be demonstrated, not assumed — under ADR-0009 the
        // Neo4j path is a filtered delete rather than a database drop, so a
        // successful call is not proof the data is gone.
        const stillPresent = await provisioner.verify(slug);
        if (stillPresent) {
          failures.push({ store, reason: "still present after destroy" });
          continue;
        }

        await this.deps.registry.recordStep(slug, {
          store,
          status: "RolledBack",
          completedAt: this.deps.clock.now(),
        });
      } catch (error) {
        failures.push({
          store,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Failed, not deleted: the row is the record that this slug's stores may
    // hold residue, which is what stops the slug being reused.
    await this.deps.registry.setStatus(slug, "Failed", this.deps.clock.now());

    if (failures.length > 0) {
      await this.deps.audit.record({
        actor: input.actor,
        action: "tenant.provision.rollback",
        target: { kind: "Tenant", labelSnapshot: slug },
        summary: `Rollback of tenant "${slug}" left ${failures.length} store(s) uncleaned.`,
        environmentKey: input.environment,
        after: { uncleaned: failures },
        tenant: { slugSnapshot: slug },
      });
      // Surfaced to logs and alerting rather than thrown, so the caller sees the
      // original provisioning failure — the actionable error — as the cause.
      console.error(new TenantRollbackError(slug, failures).message);
    }
  }

  /**
   * Order comes from `PROVISIONING_STORES`, not from the injected array.
   *
   * Creation order matters for rollback ordering, and a caller passing
   * provisioners in a different order must not silently change it.
   */
  private orderedProvisioners(): readonly StoreProvisioner[] {
    const byStore = new Map(this.deps.provisioners.map((p) => [p.store, p]));
    const missing = PROVISIONING_STORES.filter((store) => !byStore.has(store));
    if (missing.length > 0) {
      throw new Error(
        `Cannot provision a tenant without a provisioner for every store. Missing: ${missing.join(", ")}. ` +
          "Provisioning fewer than four stores would produce exactly the half-provisioned state " +
          "ADR-0002 rule 6 exists to prevent.",
      );
    }
    return PROVISIONING_STORES.map((store) => byStore.get(store)!);
  }
}
