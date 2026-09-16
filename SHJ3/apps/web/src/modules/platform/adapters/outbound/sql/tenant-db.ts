/**
 * Tenant-scoped and platform-scoped SQL Server access.
 *
 * ADR-0002 rule 3: no unscoped store client is exported from this module. There
 * is no `getPrismaClient()` and no exported `prisma`. Callers get `getTenantDb()`
 * or `getPlatformDb()`, each already bound to its scope, so an application-layer
 * author has no vocabulary in which to express a cross-tenant query.
 *
 * ## Two generated clients, not one (ADR-0011)
 *
 * `platform` and the tenant schemas are declared in two separate Prisma schema
 * files — `prisma/platform/schema.prisma` and `prisma/tenant/schema.prisma` — and
 * therefore have two separately generated clients, imported below as
 * `PlatformPrismaClient` and `TenantPrismaClient`. This split is not cosmetic.
 *
 * `getTenantDb()` was originally "one PrismaClient per tenant, differing only in
 * the connection string's `schema=` parameter" — and that mechanism was, for a
 * while, believed broken: a single schema file using Prisma's `multiSchema`
 * preview feature for both `platform` and `tenant_template` resolves `@@schema()`
 * to a literal schema name at `prisma generate` time, identical for every client
 * instance regardless of its connection string. Confirmed directly against a live
 * database (ADR-0010): every tenant's `getTenantDb().<model>.*` query resolved
 * against the literal `tenant_template` schema, never the calling tenant's own.
 *
 * A follow-up experiment (ADR-0011) found the defect was narrower than that: a
 * MINIMAL schema with no `@@schema()` and no `multiSchema` correctly routes both
 * reads and writes via the connection string's `schema=` parameter alone. So
 * `prisma/tenant/schema.prisma` declares no `@@schema()` and does not enable
 * `multiSchema` — which is what makes the mechanism below correct again, proven
 * directly against a live database. `prisma/platform/schema.prisma` keeps
 * `multiSchema` (and `@@schema("platform")`) unchanged, because `platform` is
 * exactly the case that feature is designed for: ONE real, fixed, always-present
 * schema, needing no per-instance schema selection to resolve correctly.
 *
 * ## How tenant schema binding works
 *
 * Prisma's schema is static, but the tenant set is not — a schema is created
 * when a government entity is onboarded. Prisma cannot switch schema per query,
 * and SQL Server has no `search_path` to set. What SQL Server's Prisma connector
 * *does* accept — once `multiSchema` is out of the way — is a `schema=` parameter
 * in the connection string, read per client instance.
 *
 * So the binding is per *client*: one `TenantPrismaClient` per tenant, each with
 * its tenant's schema in its datasource URL, constructed lazily and cached. The
 * models are declared once against `tenant_template`, and each tenant's real
 * schema is created from that same DDL at provisioning time — so one generated
 * client type is correct for every tenant.
 *
 * The consequence to watch is connection multiplication: N tenants means N
 * pools, and `SHJ3_SQL_POOL_MAX × N` can exhaust SQL Server well before the
 * tenant count feels large (RISK-021). Hence the bounded cache below, which is
 * the mitigation rather than an optimisation.
 *
 * `platform` needs no such pool: there is exactly one platform schema, ever, so a
 * single lazily-constructed client lives for the process lifetime instead.
 */

// NodeNext relative imports to the two generated clients (ADR-0011). Deliberately
// plain relative paths, not a package-manager alias: this file is the ONE place
// (no-unscoped-store-clients gate) permitted to construct either client, so the
// path's length is a one-time, unambiguous cost rather than something every
// caller has to reason about — callers only ever see `getTenantDb()` /
// `getPlatformDb()`.
import { PrismaClient as PlatformPrismaClient } from "../../../../../../../../prisma/generated/platform-client/index.js";
import { PrismaClient as TenantPrismaClient } from "../../../../../../../../prisma/generated/tenant-client/index.js";
import {
  currentTenant,
  requireTenantContext,
  type TenantContext,
} from "../../../tenancy/tenant-context.js";
import { sqlSchemaFor, type TenantSlug } from "../../../tenancy/tenant-slug.js";

export type { PlatformPrismaClient, TenantPrismaClient };

/**
 * How many tenant clients to keep open at once. Each holds a connection pool,
 * so this is a real resource ceiling, not a cache-hit optimisation.
 *
 * At government-entity scale (a few dozen) every tenant stays resident. The
 * eviction path exists so that a larger tenant set degrades into slower
 * cold-start rather than into connection exhaustion, which is the failure mode
 * RISK-021 describes.
 */
const MAX_RESIDENT_CLIENTS = Number(process.env.SHJ3_SQL_MAX_RESIDENT_CLIENTS ?? 32);

interface TenantEntry {
  client: TenantPrismaClient;
  lastUsedAt: number;
}

const tenantClients = new Map<string, TenantEntry>();

function baseUrl(): string {
  const url = process.env.SHJ3_SQL_URL;
  if (!url) {
    // Fail at first use rather than returning a client pointed at nothing.
    // Config is validated at boot too; this is the second line.
    throw new Error(
      "SHJ3_SQL_URL is not set. The process should have refused to start — check the boot-time config validation.",
    );
  }
  return url;
}

/**
 * Insert or replace the `schema` parameter in a SQL Server connection string.
 *
 * The slug is validated before it arrives here, which matters because a schema
 * name cannot be a bound parameter — it lands in identifier position, so the
 * character-class check in `assertValidSlugShape` is the only thing standing
 * between a tenant value and an injection.
 */
function urlForSchema(schema: string): string {
  const url = baseUrl();
  const withoutSchema = url
    .split(";")
    .filter((part) => !/^schema=/i.test(part.trim()))
    .join(";");
  const separator = withoutSchema.endsWith(";") ? "" : ";";
  return `${withoutSchema}${separator}schema=${schema}`;
}

function evictIfNeeded(): void {
  if (tenantClients.size < MAX_RESIDENT_CLIENTS) return;

  let oldestKey: string | undefined;
  let oldestAt = Number.POSITIVE_INFINITY;
  for (const [key, entry] of tenantClients) {
    if (entry.lastUsedAt < oldestAt) {
      oldestAt = entry.lastUsedAt;
      oldestKey = key;
    }
  }
  if (!oldestKey) return;

  const evicted = tenantClients.get(oldestKey);
  tenantClients.delete(oldestKey);
  // Disconnect in the background. An in-flight query on the evicted client
  // completes; Prisma drains before closing.
  void evicted?.client.$disconnect().catch(() => {
    /* nothing useful to do — the process is shedding a pool */
  });
}

function clientForTenantSchema(schema: string): TenantPrismaClient {
  const existing = tenantClients.get(schema);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return existing.client;
  }

  evictIfNeeded();

  const client = new TenantPrismaClient({
    datasources: { db: { url: urlForSchema(schema) } },
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

  tenantClients.set(schema, { client, lastUsedAt: Date.now() });
  return client;
}

function clientFor(slug: TenantSlug): TenantPrismaClient {
  return clientForTenantSchema(sqlSchemaFor(slug));
}

/**
 * The tenant-scoped database handle. **This is the only way feature code
 * reaches SQL Server for tenant data.**
 *
 * Every query issued through the returned client resolves unqualified table
 * names against the calling tenant's schema, so `db.agent.findMany()` cannot
 * return another government entity's agents — not because a filter was
 * remembered, but because the client is not connected in a way that could see
 * them.
 */
export function getTenantDb(operation = "sql access"): TenantPrismaClient {
  return clientFor(currentTenant(operation));
}

// ---------------------------------------------------------------------------
// Platform client. `platform` is one real, fixed, always-present schema — not a
// pool key among many — so this is a single lazily-constructed client held for
// the process lifetime, not the bounded cache tenant clients need.
// ---------------------------------------------------------------------------

/**
 * The platform schema name. A compile-time constant, never derived from input —
 * which is why it can be a reserved slug (`assertValidSlugShape` rejects it
 * precisely so no *tenant* can ever be called `platform` and collide with it).
 */
const PLATFORM_SCHEMA = "platform";

let platformClient: PlatformPrismaClient | undefined;

function platformClientInstance(): PlatformPrismaClient {
  if (!platformClient) {
    platformClient = new PlatformPrismaClient({
      datasources: { db: { url: urlForSchema(PLATFORM_SCHEMA) } },
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }
  return platformClient;
}

/**
 * Platform-global tables: the tenant registry, staff accounts, credentials, the
 * platform audit log, global policy definitions, migration status.
 *
 * This is one of the two audited cross-tenant paths (ADR-0002 rule 5), so it is
 * gated rather than freely available: the caller must be inside a context that
 * declared a `platformScope`. That is a deliberate speed bump — it means
 * reaching global data is a decision visible in the code, and every such path is
 * expected to write an audit entry.
 */
export function getPlatformDb(operation = "platform access"): PlatformPrismaClient {
  const context: TenantContext = requireTenantContext(operation);
  if (!context.platformScope) {
    throw new Error(
      `"${operation}" reached platform-global data without a platform scope. ` +
        "Cross-tenant access is limited to provisioning and analytics rollups (ADR-0002 rule 5); " +
        "both must run inside runWithTenant({ platformScope: … }) and write an audit entry.",
    );
  }
  return platformClientInstance();
}

/** Close every open pool — every resident tenant client, and the platform client.
 *  Called on shutdown, and between integration tests. */
export async function disconnectAllTenantDbs(): Promise<void> {
  const openTenants = [...tenantClients.values()];
  tenantClients.clear();
  const platform = platformClient;
  platformClient = undefined;

  await Promise.allSettled([
    ...openTenants.map((entry) => entry.client.$disconnect()),
    ...(platform ? [platform.$disconnect()] : []),
  ]);
}
