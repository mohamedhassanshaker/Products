/**
 * Deprovision (permanently delete) a tenant — the platform operator's "Delete"
 * (Part C of the platform-admin wave).
 *
 * Reuses the identical `StoreProvisioner.destroy()` + `.verify()` pair
 * `ProvisionTenant.rollback()` already calls on a failed provision — invoked
 * directly here instead of only after a failure, in reverse creation order
 * (`[...PROVISIONING_STORES].reverse()`, same as `stepsRequiringRollback`
 * produces).
 *
 * Two hard safety gates, enforced here in the use case itself, not merely by a
 * disabled UI button:
 *
 *  1. Refuses unless the tenant is already `Suspended` — forces Suspend-then-
 *     Delete as a mandatory two-step with a real cooling-off window.
 *  2. Refuses unless `confirmSlug` exactly equals the tenant's real slug —
 *     mirrors `ProvisionTenant.execute()`'s own hard-refusal-inside-`execute()`
 *     convention for a reused slug.
 *
 * Irreversible by construction: four physical stores torn down and verified
 * gone is the literal point of schema-per-tenant isolation (ADR-0002's
 * "right-to-be-forgotten becomes a bounded, provable operation") — there is no
 * soft-undo tier to add without contradicting the isolation model itself.
 */

import {
  PROVISIONING_STORES,
  type ProvisioningStore,
  type Tenant,
} from "../domain/tenant.js";
import type {
  AuditActor,
  AuditSink,
  Clock,
  StoreProvisioner,
  TenantRegistry,
} from "../ports/provisioning.js";
import type { TenantSlug } from "../tenancy/tenant-slug.js";

export interface DeprovisionTenantInput {
  readonly slug: TenantSlug;
  /** Must exactly equal `slug` — the typed-confirmation safety gate. */
  readonly confirmSlug: string;
  readonly actor: AuditActor;
  readonly environment: string;
}

export interface DeprovisionTenantDeps {
  readonly registry: TenantRegistry;
  /** One per store, same as `ProvisionTenantDeps`. */
  readonly provisioners: readonly StoreProvisioner[];
  readonly audit: AuditSink;
  readonly clock: Clock;
}

export class DeprovisionTenant {
  constructor(private readonly deps: DeprovisionTenantDeps) {}

  async execute(input: DeprovisionTenantInput): Promise<Tenant> {
    const { registry, audit, clock } = this.deps;
    const { slug } = input;

    if (input.confirmSlug !== slug) {
      throw new Error(
        `Refusing to deprovision "${slug}": the typed confirmation ("${input.confirmSlug}") ` +
          "does not match the tenant's slug exactly.",
      );
    }

    const existing = await registry.findBySlug(slug);
    if (!existing) {
      throw new Error(`Cannot deprovision "${slug}": no such tenant is registered.`);
    }
    if (existing.status !== "Suspended") {
      throw new Error(
        `Cannot deprovision "${slug}": status is "${existing.status}", not "Suspended". ` +
          "Suspend the tenant first — this is a mandatory two-step, cooling-off gate.",
      );
    }

    await registry.setStatus(slug, "Deprovisioning", clock.now());

    const byStore = new Map(this.deps.provisioners.map((p) => [p.store, p]));
    const failures: { store: ProvisioningStore; reason: string }[] = [];

    for (const store of [...PROVISIONING_STORES].reverse()) {
      const provisioner = byStore.get(store);
      if (!provisioner) continue;

      try {
        await provisioner.destroy(slug);

        // Erasure has to be demonstrated, not assumed — same reasoning
        // `ProvisionTenant.rollback()` already documents for Neo4j's filtered delete.
        const stillPresent = await provisioner.verify(slug);
        if (stillPresent) {
          failures.push({ store, reason: "still present after destroy" });
        }
      } catch (error) {
        failures.push({
          store,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (failures.length > 0) {
      await audit.record({
        actor: input.actor,
        action: "tenant.deprovision.incomplete",
        target: { kind: "Tenant", labelSnapshot: slug },
        summary: `Deprovisioning of tenant "${slug}" left ${String(failures.length)} store(s) uncleaned.`,
        environmentKey: input.environment,
        after: { uncleaned: failures },
        tenant: { slugSnapshot: slug },
      });
      throw new Error(
        `Deprovisioning "${slug}" left ${String(failures.length)} store(s) uncleaned: ` +
          failures.map((f) => `${f.store} (${f.reason})`).join(", ") +
          '. The tenant remains "Deprovisioning", not "Deprovisioned" — resolve the residue ' +
          "manually, then re-run this operation.",
      );
    }

    const deprovisionedAt = clock.now();
    await registry.setStatus(slug, "Deprovisioned", deprovisionedAt);

    await audit.record({
      actor: input.actor,
      action: "tenant.deprovision",
      target: { kind: "Tenant", labelSnapshot: slug },
      summary: `Tenant "${slug}" deprovisioned: all four stores torn down and verified gone.`,
      environmentKey: input.environment,
      after: { stores: PROVISIONING_STORES },
      tenant: { slugSnapshot: slug },
    });

    const tenant = await registry.findBySlug(slug);
    if (!tenant) {
      throw new Error(
        `Tenant "${slug}" vanished from the registry immediately after deprovisioning. ` +
          "This indicates registry corruption; do not retry until it is investigated.",
      );
    }
    return tenant;
  }
}
