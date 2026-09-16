/**
 * Suspend a tenant (Part C of the platform-admin wave).
 *
 * Three real effects, not just a status flip — a status flip alone would be
 * cosmetic:
 *
 *  1. `registry.setStatus(slug, "Suspended", now)` + an audit entry via the same
 *     `AuditSink` `ProvisionTenant` already uses, unchanged.
 *  2. `TenantSessionRevoker.destroyAllSessions(slug)` — every currently-signed-in
 *     staff member of this tenant loses their session *now*, not when it next
 *     expires naturally (api.md §3.6's per-user guarantee, extended to "every
 *     user of this tenant").
 *  3. Not performed here, but load-bearing: `ResolveSession.execute()` and
 *     `LocalPasswordProvider.resolveTenant()`/`resolvePrincipal()` (`iam` module)
 *     both independently refuse a non-`Active` tenant on every subsequent
 *     request and every fresh sign-in — confirmed directly by reading both
 *     before this wave, neither checked tenant status at all. Steps 1+2 alone
 *     would only end sessions that existed *at the moment of suspension*;
 *     without the `iam`-side checks, a sign-in attempt arriving a moment later,
 *     or a request already in flight, would still succeed.
 */

import type { Tenant } from "../domain/tenant.js";
import type { AuditActor, AuditSink, Clock, TenantRegistry, TenantSessionRevoker } from "../ports/provisioning.js";
import type { TenantSlug } from "../tenancy/tenant-slug.js";

export interface SuspendTenantInput {
  readonly slug: TenantSlug;
  readonly actor: AuditActor;
  readonly environment: string;
}

export interface SuspendTenantDeps {
  readonly registry: TenantRegistry;
  readonly sessionRevoker: TenantSessionRevoker;
  readonly audit: AuditSink;
  readonly clock: Clock;
}

export class SuspendTenant {
  constructor(private readonly deps: SuspendTenantDeps) {}

  async execute(input: SuspendTenantInput): Promise<Tenant> {
    const { registry, sessionRevoker, audit, clock } = this.deps;
    const { slug } = input;

    const existing = await registry.findBySlug(slug);
    if (!existing) {
      throw new Error(`Cannot suspend "${slug}": no such tenant is registered.`);
    }
    if (existing.status !== "Active") {
      throw new Error(
        `Cannot suspend "${slug}": status is "${existing.status}", not "Active". ` +
          "Only an Active tenant can be suspended.",
      );
    }

    const now = clock.now();
    await registry.setStatus(slug, "Suspended", now);
    const destroyedSessions = await sessionRevoker.destroyAllSessions(slug);

    await audit.record({
      actor: input.actor,
      action: "tenant.suspend",
      target: { kind: "Tenant", labelSnapshot: slug },
      summary: `Tenant "${slug}" suspended; ${String(destroyedSessions)} live session(s) ended.`,
      environmentKey: input.environment,
      after: { status: "Suspended", destroyedSessions },
      tenant: { slugSnapshot: slug },
    });

    const tenant = await registry.findBySlug(slug);
    if (!tenant) {
      throw new Error(
        `Tenant "${slug}" vanished from the registry immediately after suspension. ` +
          "This indicates registry corruption; do not retry until it is investigated.",
      );
    }
    return tenant;
  }
}
