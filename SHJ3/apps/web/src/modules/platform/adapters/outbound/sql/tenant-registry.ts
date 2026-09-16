/**
 * SQL Server-backed `TenantRegistry` — the platform-global source of truth `ProvisionTenant`
 * (application/provision-tenant.ts) reads and writes.
 *
 * ## Why this file exists now, not earlier
 *
 * `ProvisionTenant` has been testable against fakes since it was written (architecture.md
 * §4's whole point), but nothing in the repository wired it to a real store until the
 * tenant-isolation suite (docs/testing.md §5) needed two *actually provisioned* tenants to
 * assert isolation against. This is that wiring: a `TenantRegistry` implementation over
 * `platform.Tenants` / `platform.TenantProvisioningSteps`, reached exclusively through
 * `getPlatformDb()` so it is one of the two audited cross-tenant paths (ADR-0002 rule 5)
 * rather than a client of its own.
 *
 * ## Two naming seams this adapter closes
 *
 * The domain and the schema disagree on vocabulary in two places, and this file is where
 * the disagreement is resolved rather than left for every call site to remember:
 *
 *  1. **Store names.** The domain's `ProvisioningStore` uses `"Sql"` (domain/tenant.ts);
 *     `CK_TenantProvisioningSteps_store` (prisma/sql/001_constraints.sql §1.2) accepts
 *     `'SqlServer'`. `STORE_DB_VALUE` / `STORE_DOMAIN_VALUE` are the only two places that
 *     translation happens.
 *  2. **The embedding pair.** The domain's `Tenant.embeddingModel` / `embeddingDimensions`
 *     do not live on `platform.Tenants` at all — they live on
 *     `platform.VectorCollectionRegistry`, one row per tenant's live collection
 *     (`state = 'Active'`), because a tenant may rebuild its collection under a new model
 *     without renaming the tenant (§7.5's alias switch). `register()` therefore writes both
 *     rows and `findBySlug()` / `listActive()` join them back into one domain `Tenant`.
 *
 * ## A known gap this adapter does NOT paper over
 *
 * `TenantProvisioningError` / `TenantRollbackError` (domain/tenant.ts) and
 * `ProvisionTenant.rollback()` all set a tenant to status `"Failed"` after a provisioning
 * step fails. `CK_Tenants_status` (prisma/sql/001_constraints.sql §1.1) does **not** include
 * `'Failed'` in its closed set — only `'Provisioning' | 'Active' | 'Suspended' |
 * 'Deprovisioning' | 'Deprovisioned'`. That is a real mismatch between the domain and the
 * schema it is meant to persist to, discovered by wiring this adapter against the real
 * database rather than a fake that has no CHECK constraints to violate.
 *
 * This adapter does not silently remap `"Failed"` to some other status — guessing at the
 * "closest" allowed value would misrepresent what actually happened, which is worse than a
 * loud failure (`no-laziness`: root causes only). `setStatus()` passes the domain value
 * through unchanged, so a real provisioning failure against this database currently throws
 * a `CHECK` constraint violation out of `ProvisionTenant.rollback()` — which, being outside
 * that method's own `try`/`catch`, would replace the original, actionable
 * `TenantProvisioningError` with an opaque SQL error. Fixing the schema is a migration
 * decision outside this suite's scope; this comment and the isolation suite's own report are
 * the loud surfacing the code quality rules call for. The isolation suite's fixture
 * (`tests/isolation/setup.ts`) never exercises this path — it cleans up any stray prior-run
 * tenant with direct deletes rather than through `ProvisionTenant`'s rollback, specifically
 * to avoid depending on the broken path.
 */

import { randomBytes } from "node:crypto";
// ADR-0011: `Tenant`, `TenantProvisioningStep` and `VectorCollectionRegistryEntry` are all
// `platform`-schema models, so their generated types come from the platform client, not the
// tenant one (a separate generated client entirely — see tenant-db.ts's module comment).
import type { Prisma } from "../../../../../../../../prisma/generated/platform-client/index.js";
import {
  PROVISIONING_STORES,
  type ProvisioningStep,
  type ProvisioningStore,
  type Tenant,
  type TenantStatus,
} from "../../../domain/tenant.js";
import type { TenantRegistry } from "../../../ports/provisioning.js";
import type { TenantSlug } from "../../../tenancy/tenant-slug.js";
import { getPlatformDb } from "./tenant-db.js";

const OPERATION = "tenant registry";

/** A government entity's tenant, as opposed to the platform operator's own row (§4.1). */
const DEFAULT_ENTITY_KIND = "GovernmentEntity";

/**
 * `CK_PrivacyConfigs_dataResidency` names this value; `platform.Tenants.dataResidency` itself
 * carries no CHECK constraint, so this is a sensible default rather than an enforced one.
 * Every tenant this adapter provisions is a Sharjah government entity, and every store in
 * the local Compose stack (deployment.md) runs in the Sharjah data centre.
 */
const DEFAULT_DATA_RESIDENCY = "UaeSharjahDc";

/** `CK_VectorCollectionRegistry_distance`. Matches `qdrant_provisioner.py`'s `DISTANCE`. */
const DEFAULT_DISTANCE = "Cosine";

/**
 * Domain `ProvisioningStore` → `CK_TenantProvisioningSteps_store`'s closed set. See the
 * module comment — this is the one legitimate naming seam, not a bug to fix here.
 */
const STORE_DB_VALUE: Record<ProvisioningStore, string> = {
  Sql: "SqlServer",
  Neo4j: "Neo4j",
  Qdrant: "Qdrant",
  Redis: "Redis",
};

const STORE_DOMAIN_VALUE: Record<string, ProvisioningStore> = Object.fromEntries(
  PROVISIONING_STORES.map((store) => [STORE_DB_VALUE[store], store]),
);

function toDbStore(store: ProvisioningStore): string {
  return STORE_DB_VALUE[store];
}

function toDomainStore(dbValue: string): ProvisioningStore {
  const store = STORE_DOMAIN_VALUE[dbValue];
  if (!store) {
    throw new Error(
      `platform.TenantProvisioningSteps holds an unrecognised store value "${dbValue}". ` +
        "This registry adapter's STORE_DB_VALUE map is out of date with the CHECK constraint.",
    );
  }
  return store;
}

/**
 * 26-character Crockford-base32 ULID (`§1.2`'s id contract): a 48-bit millisecond timestamp
 * followed by 80 bits of randomness, both base32-encoded. Not imported from a package
 * because none is a dependency of this workspace yet (`pnpm-lock.yaml` carries no `ulid`) —
 * and `platform.Tenants.id` / `platform.VectorCollectionRegistry.id` only require
 * `CHAR(26)`, with no format CHECK, so a minimal correct implementation is proportionate to
 * what one small adapter needs rather than a new shared dependency for it.
 */
const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeBase32(value: number, length: number): string {
  let remaining = value;
  let out = "";
  for (let i = 0; i < length; i++) {
    out = CROCKFORD_BASE32[remaining % 32] + out;
    remaining = Math.floor(remaining / 32);
  }
  return out;
}

function newUlid(now: Date = new Date()): string {
  const time = encodeBase32(now.getTime(), 10);
  const randomness = Array.from(randomBytes(16), (byte) => CROCKFORD_BASE32[byte % 32]).join("");
  return time + randomness;
}

// ---------------------------------------------------------------------------
// Row shapes read back from Prisma, and their mapping into the domain Tenant.
// ---------------------------------------------------------------------------

type TenantRow = Prisma.TenantGetPayload<{
  include: { provisioningSteps: true; vectorCollections: true };
}>;

/** The tenant's live collection — `state = 'Active'`, per `UQ_VectorCollectionRegistry_tenantId_active`. */
function activeVectorCollection(
  row: TenantRow,
): TenantRow["vectorCollections"][number] | undefined {
  return row.vectorCollections.find((entry) => entry.state === "Active");
}

/**
 * Build one domain `ProvisioningStep`, omitting optional fields rather than setting them to
 * `undefined`. `exactOptionalPropertyTypes` (tsconfig.base.json) treats those as different:
 * an omitted key satisfies `startedAt?: Date`, but an explicit `startedAt: undefined` does
 * not, so the conditional spreads below are load-bearing, not stylistic.
 */
function toDomainStep(row: TenantRow["provisioningSteps"][number]): ProvisioningStep {
  return {
    store: toDomainStore(row.store),
    // The CHECK constraint's set is identical to ProvisioningStepStatus's, so this cast
    // documents an already-enforced invariant rather than introducing an unchecked one.
    status: row.state as ProvisioningStep["status"],
    ...(row.startedAt ? { startedAt: row.startedAt } : {}),
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
    ...(row.lastError ? { failureReason: row.lastError } : {}),
  };
}

function toDomainTenant(row: TenantRow): Tenant {
  const vector = activeVectorCollection(row);

  return {
    slug: row.slug,
    displayName: row.displayName,
    status: row.status as TenantStatus,
    sqlSchema: row.sqlSchema,
    neo4jTenantLabel: row.neo4jTenantLabel,
    qdrantCollection: row.qdrantCollection,
    redisPrefix: row.redisPrefix,
    // Absent only if the register() write below never ran, which would itself be a bug —
    // register() always creates the Active row in the same call that creates the tenant.
    embeddingModel: vector?.embeddingModel ?? "",
    embeddingDimensions: vector?.embeddingDimension ?? 0,
    steps: row.provisioningSteps.map(toDomainStep),
    createdAt: row.createdAt,
    ...(row.activatedAt ? { activatedAt: row.activatedAt } : {}),
  };
}

const ROW_INCLUDE = { provisioningSteps: true, vectorCollections: true } as const;

/**
 * The real `TenantRegistry`. Every method resolves `getPlatformDb()` fresh rather than
 * caching the client on the instance, matching `PlatformAuditSink`'s pattern — the platform
 * client itself is cached and pooled one level down, in `tenant-db.ts`.
 */
export class PrismaTenantRegistry implements TenantRegistry {
  async findBySlug(slug: TenantSlug): Promise<Tenant | null> {
    const db = getPlatformDb(OPERATION);
    const row = await db.tenant.findUnique({ where: { slug }, include: ROW_INCLUDE });
    return row ? toDomainTenant(row) : null;
  }

  async listActive(): Promise<readonly Tenant[]> {
    const db = getPlatformDb(OPERATION);
    const rows = await db.tenant.findMany({
      where: { status: "Active" },
      include: ROW_INCLUDE,
    });
    return rows.map(toDomainTenant);
  }

  /** Every tenant regardless of status — the platform operator's Tenants screen (unlike `listActive`, which is what every ordinary tenant-facing read path uses). */
  async listAll(): Promise<readonly Tenant[]> {
    const db = getPlatformDb(OPERATION);
    const rows = await db.tenant.findMany({ include: ROW_INCLUDE, orderBy: { createdAt: "asc" } });
    return rows.map(toDomainTenant);
  }

  async register(input: {
    slug: TenantSlug;
    displayName: string;
    embeddingModel: string;
    embeddingDimensions: number;
    entityKind?: "GovernmentEntity" | "PlatformOperator";
  }): Promise<Tenant> {
    const db = getPlatformDb(OPERATION);
    const now = new Date();
    const tenantId = newUlid(now);
    const collectionName = `${input.slug}_knowledge`;

    // One write, not two: platform.Tenants and its VectorCollectionRegistry row are
    // created together so a reader can never observe a tenant with no recorded embedding
    // contract (which toDomainTenant would otherwise have to paper over with a placeholder).
    const [row] = await db.$transaction([
      db.tenant.create({
        data: {
          id: tenantId,
          slug: input.slug,
          displayName: input.displayName,
          entityKind: input.entityKind ?? DEFAULT_ENTITY_KIND,
          sqlSchema: input.slug,
          neo4jTenantLabel: `Tenant_${input.slug}`,
          qdrantCollection: collectionName,
          // Bare slug, matching CK_Tenants_derivedNames — NOT the trailing-colon form
          // `redisPrefixFor()` (tenancy/tenant-slug.ts) produces for physical key building.
          // That helper is what every runtime Redis access actually uses; this column is
          // the registry's own record and is constrained to equal the slug verbatim.
          redisPrefix: input.slug,
          dataResidency: DEFAULT_DATA_RESIDENCY,
          status: "Provisioning",
          createdAt: now,
          updatedAt: now,
        },
        include: ROW_INCLUDE,
      }),
      db.vectorCollectionRegistryEntry.create({
        data: {
          id: newUlid(new Date(now.getTime() + 1)),
          tenantId,
          collectionName,
          aliasName: collectionName,
          embeddingModel: input.embeddingModel,
          embeddingDimension: input.embeddingDimensions,
          distance: DEFAULT_DISTANCE,
          pointCount: 0n,
          state: "Active",
          createdAt: now,
          updatedAt: now,
        },
      }),
    ]);

    // The transaction returned the tenant row created before its vector-collection sibling
    // existed, so `vectorCollections` on it is empty — re-read rather than hand-assemble,
    // so this method returns exactly what findBySlug would.
    const tenant = await this.findBySlug(row.slug as TenantSlug);
    if (!tenant) {
      throw new Error(`Tenant "${row.slug}" vanished immediately after its own registration.`);
    }
    return tenant;
  }

  async recordStep(slug: TenantSlug, step: ProvisioningStep): Promise<void> {
    const db = getPlatformDb(OPERATION);
    const tenant = await db.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (!tenant) {
      throw new Error(`Cannot record a provisioning step for unknown tenant "${slug}".`);
    }

    const store = toDbStore(step.store);
    const now = new Date();
    const existing = await db.tenantProvisioningStep.findUnique({
      where: { tenantId_store: { tenantId: tenant.id, store } },
    });

    await db.tenantProvisioningStep.upsert({
      where: { tenantId_store: { tenantId: tenant.id, store } },
      create: {
        id: newUlid(now),
        tenantId: tenant.id,
        store,
        state: step.status,
        // A step's first row is its first attempt — later attempts go through `update`,
        // which increments rather than re-inserts (UQ_TenantProvisioningSteps_tenantId_store).
        attemptCount: 1,
        startedAt: step.startedAt ?? null,
        completedAt: step.completedAt ?? null,
        rolledBackAt: step.status === "RolledBack" ? now : null,
        lastError: step.failureReason ?? null,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        state: step.status,
        attemptCount: (existing?.attemptCount ?? 0) + 1,
        startedAt: step.startedAt ?? existing?.startedAt ?? null,
        completedAt:
          step.completedAt ?? (step.status === "Completed" ? now : (existing?.completedAt ?? null)),
        rolledBackAt: step.status === "RolledBack" ? now : (existing?.rolledBackAt ?? null),
        lastError: step.failureReason ?? null,
        updatedAt: now,
      },
    });
  }

  async setStatus(slug: TenantSlug, status: TenantStatus, at: Date): Promise<void> {
    const db = getPlatformDb(OPERATION);
    // TR_Tenants_activationRequiresFourSteps (ADR-0002 rule 6) is the database's own copy
    // of this guard; this update is rejected at the trigger if it is not yet true, which is
    // the "belt and braces" ProvisionTenant.execute()'s own comment describes.
    //
    // Confirmed directly against the live `CK_Tenants_status` constraint (not assumed from
    // this file's own earlier comment, which was stale): the database already accepts both
    // `'Failed'` and `'Deprovisioned'` — `TenantStatus` (domain/tenant.ts) just hadn't caught
    // up with `'Deprovisioned'` until `DeprovisionTenant` needed to set it.
    await db.tenant.update({
      where: { slug },
      data: {
        status,
        updatedAt: at,
        ...(status === "Active" ? { activatedAt: at } : {}),
        ...(status === "Suspended" ? { suspendedAt: at } : {}),
        ...(status === "Deprovisioned" ? { deprovisionedAt: at } : {}),
      },
    });
  }
}
