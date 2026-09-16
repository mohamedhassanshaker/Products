/**
 * Shared fixture for the tenant-isolation release gate (docs/testing.md §5, ADR-0002).
 *
 * Provisions two real government-entity tenants — `sewa` and `customs` — across all four
 * stores, using the real `ProvisionTenant` use case wired to the real adapters
 * (`SqlStoreProvisioner`, `RedisStoreProvisioner`, `AiGraphProvisioner`,
 * `AiVectorProvisioner`), and de-provisions them when the suite finishes. Two tenants, not
 * one, because "isolation is untestable against one tenant" (testing.md §4.4): with a single
 * tenant every query returns the right data by accident, and this suite exists to prove the
 * *wrong* value never surfaces, which needs two structurally identical, value-distinct
 * tenants to even be a meaningful question.
 *
 * ## Why provisioning lives in `globalSetup`, not a per-file `beforeAll`
 *
 * The isolation suite spans several spec files (`sql.spec.ts`, `redis.spec.ts`,
 * `forged-tenant.spec.ts`, `cross-tenant-analytics.spec.ts`, …), and Vitest's default file
 * isolation gives each spec file its own fresh module registry — a module-level "already
 * provisioned" flag in this file would not survive from one spec file to the next, so a
 * naive per-file `beforeAll` would either re-provision on every file (expensive: two
 * tenants across four real stores) or, worse, have one file's `afterAll` tear down tenants
 * a later file still needs. Vitest's `globalSetup` hook (wired in `global-setup.ts`, and
 * `vitest.config.ts`'s `isolation` project) is the one place guaranteed to run exactly once
 * for the whole project invocation regardless of which files are selected — which is the
 * literal requirement ("provisioning happens once, not per test") applied at the level
 * where it is actually true. This module holds the fixture logic; `global-setup.ts` is the
 * thin Vitest adapter over it.
 *
 * ## Tolerating a prior run's residue
 *
 * A crashed prior run can leave `sewa` / `customs` behind in any status. `ProvisionTenant`
 * itself refuses to reuse a registered slug (its stores may hold residue — exactly the
 * ADR-0002 rule 6 concern), so this module cleans up any pre-existing row for either slug
 * *before* provisioning a fresh one, by driving every provisioner's `destroy()` directly and
 * hard-deleting the registry rows — not by going through `ProvisionTenant`'s own rollback
 * path. See `tenant-registry.ts`'s module comment for why: that path's `setStatus(...,
 * "Failed", ...)` call would violate `CK_Tenants_status` against the real database, which
 * would turn a routine cleanup into a crash. This fixture must not depend on a path known to
 * be broken against real infrastructure.
 */

import { randomUUID } from "node:crypto";
import {
  PROVISIONING_STORES,
  type Tenant,
} from "../../apps/web/src/modules/platform/domain/tenant.js";
import { ProvisionTenant } from "../../apps/web/src/modules/platform/application/provision-tenant.js";
import type {
  AuditActor,
  Clock,
  StoreProvisioner,
  TenantRegistry,
} from "../../apps/web/src/modules/platform/ports/provisioning.js";
import { PrismaTenantRegistry } from "../../apps/web/src/modules/platform/adapters/outbound/sql/tenant-registry.js";
import { PlatformAuditSink } from "../../apps/web/src/modules/platform/adapters/outbound/sql/audit-sink.js";
import { SqlStoreProvisioner } from "../../apps/web/src/modules/platform/adapters/outbound/sql/sql-store-provisioner.js";
import {
  disconnectAllTenantDbs,
  getPlatformDb,
} from "../../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { RedisStoreProvisioner } from "../../apps/web/src/modules/platform/adapters/outbound/cache/redis-store-provisioner.js";
import { disconnectCache } from "../../apps/web/src/modules/platform/adapters/outbound/cache/tenant-cache.js";
import { AiGraphProvisioner } from "../../apps/web/src/modules/platform/adapters/outbound/graph/ai-graph-provisioner.js";
import { AiVectorProvisioner } from "../../apps/web/src/modules/platform/adapters/outbound/vector/ai-vector-provisioner.js";
import { ProvisionDefaultChannelsHook } from "../../apps/web/src/modules/channels/adapters/outbound/sql/provision-default-channels-hook.js";
import { ProvisionDefaultRouterConfigHook } from "../../apps/web/src/modules/orchestration/adapters/outbound/sql/provision-default-router-config-hook.js";
import {
  runWithTenant,
  type Principal,
  type TenantContext,
} from "../../apps/web/src/modules/platform/tenancy/tenant-context.js";
import {
  assertValidSlugShape,
  type TenantSlug,
} from "../../apps/web/src/modules/platform/tenancy/tenant-slug.js";

/** The two government-entity tenants this suite provisions (testing.md §4.4). */
export const SEWA: TenantSlug = assertValidSlugShape("sewa");
export const CUSTOMS: TenantSlug = assertValidSlugShape("customs");
export const ISOLATION_TENANTS: readonly TenantSlug[] = [SEWA, CUSTOMS];

const DISPLAY_NAMES: Record<TenantSlug, string> = {
  [SEWA]: "Sharjah Electricity, Water & Gas Authority",
  [CUSTOMS]: "Sharjah Customs",
};

/**
 * `qdrant_provisioner.py`'s `CK_VectorCollectionRegistry_dimension` accepts only 1536 or
 * 3072, so this is read from the same env var the real embedding pipeline would use rather
 * than a suite-local constant, to keep this fixture honest about what it is provisioning.
 */
const EMBEDDING_MODEL = process.env.SHJ3_OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-large";
const EMBEDDING_DIMENSIONS = Number(process.env.SHJ3_OPENAI_EMBEDDING_DIM ?? 3072);

const ENVIRONMENT_KEY = process.env.SHJ3_ENVIRONMENT ?? "development";

const SYSTEM_ACTOR: AuditActor = { kind: "System", label: "tenant-isolation-suite" };

function systemClock(): Clock {
  return { now: () => new Date() };
}

function newTraceId(): string {
  return randomUUID().replace(/-/g, "");
}

/** One provisioner per store, in the shape `ProvisionTenant` requires. */
function buildProvisioners(): readonly StoreProvisioner[] {
  return [
    new SqlStoreProvisioner(),
    new RedisStoreProvisioner(),
    new AiGraphProvisioner(),
    new AiVectorProvisioner({
      embeddingModel: EMBEDDING_MODEL,
      embeddingDimensions: EMBEDDING_DIMENSIONS,
    }),
  ];
}

/**
 * Run `fn` inside a platform-scoped context (ADR-0002 rule 5) — required by
 * `getPlatformDb()`, `getProvisioningCache()` and the AI provisioners' trace propagation.
 *
 * The ambient `tenant` field is never read for *which* tenant gets provisioned or
 * de-provisioned — every provisioner call below takes its target slug as an explicit
 * argument — so binding it to `SEWA` here is arbitrary and harmless, not a claim about
 * which tenant is being acted on.
 */
function runAsProvisioning<T>(fn: () => Promise<T>): Promise<T> {
  const context: TenantContext = {
    tenant: SEWA,
    principal: null,
    traceId: newTraceId(),
    platformScope: "provisioning",
  };
  return runWithTenant(context, fn);
}

/** Best-effort destroy on all four stores. Every `StoreProvisioner.destroy()` is documented idempotent. */
async function destroyStoresIfPresent(slug: TenantSlug): Promise<void> {
  for (const provisioner of buildProvisioners()) {
    try {
      await provisioner.destroy(slug);
    } catch (error) {
      // Best-effort: a leftover store namespace is reported, not fatal — the point of this
      // helper is to make a second run possible, not to guarantee a first one is spotless.
      console.warn(
        `[isolation setup] ${provisioner.store} cleanup of "${slug}" did not complete cleanly`,
        error,
      );
    }
  }
}

/**
 * Remove a tenant's `platform.Tenants` row and its children directly, bypassing
 * `PrismaTenantRegistry.setStatus("Failed", …)` — see that file's module comment. Deletes
 * children before the parent to satisfy the `NoAction` foreign keys on
 * `TenantProvisioningSteps`, `VectorCollectionRegistry`, `TenantMemberships` and
 * `StaffUsers.homeTenantId`.
 *
 * The `StaffUsers`/`TenantMemberships` deletions are a real, load-bearing fix
 * (2026-09-09), not defensive padding: once `scripts/seed-iam-demo-data.ts` started
 * giving `sewa`/`customs` real `StaffUsers` (`homeTenantId` FK) and `TenantMemberships`
 * rows, this function's original two-delete form started failing `db.tenant.delete()`
 * outright the first time this suite ran against a seeded stack — destroying the
 * tenant's SQL/Redis/Neo4j/Qdrant stores via `destroyStoresIfPresent()` (called just
 * before this) while leaving the now-orphaned `Tenants`/`StaffUsers`/`TenantMemberships`
 * registry rows behind, wedging both `db:seed:iam`'s `ensureTenantProvisioned()`
 * (refuses to touch a registered-but-not-repaired row) and every subsequent isolation
 * run (this same function, called again, hitting the same FK). Reproduced directly
 * against the real stack, not inferred: the first fix attempt (deleting `StaffUsers`
 * alone) still failed on `TenantMemberships.staffUserId`, because `TenantMembership`
 * also grants a home-tenant `StaffUser` membership into *other* tenants — deleting only
 * `WHERE tenantId = tenant.id` would miss those. Deleted by `staffUserId IN (...)` as
 * well as `tenantId`, covering both directions.
 *
 * Deliberately narrow beyond that: this suite's own seeded fixtures are one `StaffUser`
 * per isolation tenant, no invites, no audit-actor rows. `StaffUser` also carries
 * `NoAction` FKs from `PlatformAuditLogEntry.actorStaffUserId`,
 * `GuideEntry.updatedByStaffUserId` and `PlatformSkin.createdByStaffUserId` — deleting a
 * `StaffUser` that is cross-referenced by any of those (or that invited another
 * surviving `StaffUser`) will still throw here. Not handled, because doing so
 * generically would mean silently deleting or nulling platform audit history from a
 * test fixture, which is a real design decision belonging to whoever owns
 * `platform.PlatformAuditLogEntries`' retention semantics — flagged here rather than
 * guessed at.
 */
async function hardDeleteRegistryRow(slug: TenantSlug): Promise<void> {
  const db = getPlatformDb("isolation suite cleanup");
  const tenant = await db.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!tenant) return;

  const staffUsers = await db.staffUser.findMany({
    where: { homeTenantId: tenant.id },
    select: { id: true },
  });
  const staffUserIds = staffUsers.map((staffUser) => staffUser.id);

  await db.tenantProvisioningStep.deleteMany({ where: { tenantId: tenant.id } });
  await db.vectorCollectionRegistryEntry.deleteMany({ where: { tenantId: tenant.id } });
  await db.tenantMembership.deleteMany({
    where: { OR: [{ tenantId: tenant.id }, { staffUserId: { in: staffUserIds } }] },
  });
  await db.staffUser.deleteMany({ where: { homeTenantId: tenant.id } });
  await db.tenant.delete({ where: { id: tenant.id } });
}

/** Tolerates a tenant left behind — in any status — by a crashed prior run. */
async function cleanupPriorRun(registry: TenantRegistry, slug: TenantSlug): Promise<void> {
  const existing = await registry.findBySlug(slug);
  if (!existing) return;

  console.warn(
    `[isolation setup] found a pre-existing "${slug}" tenant (status ${existing.status}) — ` +
      "cleaning it up before provisioning a fresh one",
  );
  await destroyStoresIfPresent(slug);
  await hardDeleteRegistryRow(slug);
}

export interface ProvisionedIsolationTenants {
  readonly sewa: Tenant;
  readonly customs: Tenant;
}

/** Provision `sewa` and `customs` across all four stores. Called once, from `global-setup.ts`. */
export async function provisionIsolationTenants(): Promise<ProvisionedIsolationTenants> {
  return runAsProvisioning(async () => {
    const registry = new PrismaTenantRegistry();
    const audit = new PlatformAuditSink();
    const useCase = new ProvisionTenant({
      registry,
      provisioners: buildProvisioners(),
      audit,
      clock: systemClock(),
      // Real provisioning now seeds B10 tab 1's fixed four-channel catalogue and B4's
      // `RouterConfigs` singleton (both bugs this fixture's own tenants should exercise too,
      // not just the real dev tenants) — wiring both here keeps this suite's tenants
      // structurally identical to a real provisioned one.
      postProvisionHooks: [
        new ProvisionDefaultChannelsHook(),
        new ProvisionDefaultRouterConfigHook(),
      ],
    });

    for (const slug of ISOLATION_TENANTS) {
      await cleanupPriorRun(registry, slug);
    }

    // Sequential rather than Promise.all: each store adapter reaches shared infrastructure
    // (one Prisma connection pool, one shj3-ai process), and a clear "which tenant failed"
    // error is worth more here than the seconds parallelism would save.
    const sewa = await useCase.execute({
      slug: SEWA,
      displayName: DISPLAY_NAMES[SEWA],
      embeddingModel: EMBEDDING_MODEL,
      embeddingDimensions: EMBEDDING_DIMENSIONS,
      actor: SYSTEM_ACTOR,
      environment: ENVIRONMENT_KEY,
    });
    const customs = await useCase.execute({
      slug: CUSTOMS,
      displayName: DISPLAY_NAMES[CUSTOMS],
      embeddingModel: EMBEDDING_MODEL,
      embeddingDimensions: EMBEDDING_DIMENSIONS,
      actor: SYSTEM_ACTOR,
      environment: ENVIRONMENT_KEY,
    });

    return { sewa, customs };
  });
}

/** De-provision both isolation tenants and release the pooled store connections. */
export async function destroyIsolationTenants(): Promise<void> {
  await runAsProvisioning(async () => {
    for (const slug of ISOLATION_TENANTS) {
      await destroyStoresIfPresent(slug);
      await hardDeleteRegistryRow(slug);
    }
  });

  // Between-run hygiene: an open Prisma pool per tenant schema, and the shared Redis
  // connection, must not outlive the process that opened them (tenant-db.ts, tenant-cache.ts).
  await disconnectAllTenantDbs();
  await disconnectCache();
}

// ---------------------------------------------------------------------------
// Test-facing helpers. Every isolation spec needs a principal and a bound
// context to exercise getTenantDb() / getTenantCache() as one tenant or the
// other — this is the one place that shape is built, so every spec file
// builds it the same way.
// ---------------------------------------------------------------------------

/** A plausible staff principal for `tenant`, for specs that need one to bind a context. */
export function principalFor(tenant: TenantSlug, overrides: Partial<Principal> = {}): Principal {
  return {
    id: `usr_${tenant}_isolation_test`,
    tenant,
    displayName: `${tenant} isolation test principal`,
    roles: ["Staff"],
    permissions: new Set<string>(),
    assurance: "L2",
    ...overrides,
  };
}

/** A bound `TenantContext` for `tenant`, principal included, fresh trace id per call. */
export function contextFor(tenant: TenantSlug): TenantContext {
  return { tenant, principal: principalFor(tenant), traceId: newTraceId() };
}

/** Re-exported so spec files that need every store's name don't re-derive it. */
export { PROVISIONING_STORES };
