"use server";

/**
 * Server Actions for `/tenants` (Part C + E of the platform-admin wave).
 *
 * Every action calls `withStaffAuth()` (ordinary staff auth — Part B's whole point is
 * that a platform operator signs in through the exact same flow every staff member
 * uses) then `platformOperatorGate().execute(principal, operation)` — the compound
 * gate: `platform:operate` AND the principal's own tenant is the real Platform
 * tenant. Neither check alone is the boundary; both together are.
 *
 * Each action catches its own use case's thrown errors and returns a structured
 * `{ ok: false, error }`, matching `(backoffice)/iam/actions.ts`'s own convention —
 * `SuspendTenant`/`DeprovisionTenant`'s refusals (wrong status, mismatched typed
 * confirmation) are expected, user-facing outcomes, not server faults.
 */

import { randomUUID } from "node:crypto";
import type { Tenant } from "../../../../modules/platform/domain/tenant.js";
import { ListTenants } from "../../../../modules/platform/application/list-tenants.js";
import { SuspendTenant } from "../../../../modules/platform/application/suspend-tenant.js";
import { DeprovisionTenant } from "../../../../modules/platform/application/deprovision-tenant.js";
import { ProvisionTenant } from "../../../../modules/platform/application/provision-tenant.js";
import { assertValidSlugShape } from "../../../../modules/platform/tenancy/tenant-slug.js";
import { runWithTenant, type Principal } from "../../../../modules/platform/tenancy/tenant-context.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import {
  auditSink,
  defaultEmbeddingDimensions,
  defaultEmbeddingModel,
  environment,
  platformOperatorGate,
  realClock,
  sessionRevoker,
  storeProvisioners,
  tenantRegistry,
} from "./composition.js";

export type ActionResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

/**
 * Rebind to `platformScope: "provisioning"` for the duration of one call.
 *
 * `withStaffAuth()`'s own context is bound `platformScope: "identity"` (ordinary
 * per-request staff access — `auth-middleware.ts`'s own doc comment) — enough for
 * `ListTenants`/`SuspendTenant` (both go through `getPlatformDb()`'s loose "some
 * scope is bound" gate), but `ProvisionTenant`/`DeprovisionTenant` reach
 * `RedisStoreProvisioner`, which calls `getProvisioningCache()` — gated strictly on
 * `platformScope === "provisioning"` (ADR-0002 rule 5: only tenant provisioning may
 * address another tenant's cache namespace). Found for real: creating a tenant from
 * `/tenants` got through the Sql/Neo4j/Qdrant steps (their gates are the loose one)
 * and failed at the Redis step with exactly that error. The ambient `tenant` value
 * is left as the operator's own (`principal.tenant`) — deliberately not rebound to
 * the target slug, unlike `branding/actions.ts`'s `withTargetTenant()`: every
 * provisioner here takes the target slug as an explicit argument, never reads it
 * from ambient context (`seed-iam-demo-data.ts`'s identical `runAsProvisioning`
 * precedent confirms only the scope matters here, not which tenant is ambient).
 */
function withProvisioningScope<T>(principal: Principal, fn: () => Promise<T>): Promise<T> {
  return runWithTenant(
    { tenant: principal.tenant, principal, traceId: randomUUID().replace(/-/g, ""), platformScope: "provisioning" },
    fn,
  );
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function listTenantsAction(): Promise<ActionResult<readonly Tenant[]>> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      await platformOperatorGate().execute(principal, "platform.tenants.list");
      const tenants = await new ListTenants({ registry: tenantRegistry() }).execute();
      return { ok: true, value: tenants } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function createTenantAction(input: {
  readonly slug: string;
  readonly displayName: string;
}): Promise<ActionResult<{ readonly slug: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        await platformOperatorGate().execute(principal, "platform.tenants.create");

        const tenant = await withProvisioningScope(principal, () =>
          new ProvisionTenant({
            registry: tenantRegistry(),
            provisioners: storeProvisioners(),
            audit: auditSink(),
            clock: realClock(),
          }).execute({
            slug: assertValidSlugShape(input.slug),
            displayName: input.displayName,
            embeddingModel: defaultEmbeddingModel(),
            embeddingDimensions: defaultEmbeddingDimensions(),
            actor: { kind: "Principal", principal },
            environment: environment(),
          }),
        );
        return { ok: true, value: { slug: tenant.slug } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function suspendTenantAction(slug: string): Promise<ActionResult<{ readonly status: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        await platformOperatorGate().execute(principal, "platform.tenants.suspend");

        const tenant = await new SuspendTenant({
          registry: tenantRegistry(),
          sessionRevoker: sessionRevoker(),
          audit: auditSink(),
          clock: realClock(),
        }).execute({
          slug: assertValidSlugShape(slug),
          actor: { kind: "Principal", principal },
          environment: environment(),
        });
        return { ok: true, value: { status: tenant.status } } as const;
      },
      { method: "POST", body: { slug } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function deprovisionTenantAction(
  slug: string,
  confirmSlug: string,
): Promise<ActionResult<{ readonly status: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        await platformOperatorGate().execute(principal, "platform.tenants.deprovision");

        const tenant = await withProvisioningScope(principal, () =>
          new DeprovisionTenant({
            registry: tenantRegistry(),
            provisioners: storeProvisioners(),
            audit: auditSink(),
            clock: realClock(),
          }).execute({
            slug: assertValidSlugShape(slug),
            confirmSlug,
            actor: { kind: "Principal", principal },
            environment: environment(),
          }),
        );
        return { ok: true, value: { status: tenant.status } } as const;
      },
      { method: "POST", body: { slug, confirmSlug } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}
