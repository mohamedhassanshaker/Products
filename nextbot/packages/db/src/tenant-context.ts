import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { getAppPool, getGatewayPool } from "./pool.js";
import { TenantContextRequiredError, TenantIsolationViolationError } from "./errors.js";
import * as schema from "./schema/index.js";

/** NFR-6 region enum — extensible, per LLD §3.3. */
export type Region = "UAE" | "EU" | "US";

/** Connector/channel environment vocabulary (distinct from `DeployEnvironment`, LLD §3.3). */
export type Environment = "Sandbox" | "Staging" | "Production";

/**
 * Everything a data-access call needs to know about the caller's tenant scope
 * (LLD §3.2 rule 4). Always required by `withTenant` — there is no "optional tenant"
 * mode; code that legitimately has no tenant (provisioning, internal ops) uses
 * `withPlatform` from `@nextbot/db/platform-only` instead.
 */
export interface TenantContext {
  tenantId: string;
  region: Region;
  environment: Environment;
}

/** The Drizzle handle yielded to `withTenant` callbacks — bound to one transaction. */
export type TenantScopedClient = NodePgDatabase<typeof schema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates a `TenantContext` before any connection is opened. This is the primary
 * fail-closed guard (LLD §3.2 rule 4): it is cheap, synchronous, and makes "unset
 * tenant context throws" a unit-testable property with no database involved. The
 * Postgres-level guard (`current_setting` raising on a missing GUC) is the backstop
 * for any path that somehow bypasses this check, not the primary mechanism.
 */
export function assertValidTenantContext(
  ctx: TenantContext | null | undefined,
): asserts ctx is TenantContext {
  if (ctx == null) {
    throw new TenantContextRequiredError("no context supplied");
  }
  if (typeof ctx.tenantId !== "string" || !UUID_RE.test(ctx.tenantId)) {
    throw new TenantContextRequiredError(
      `tenantId must be a UUID string, got ${JSON.stringify(ctx.tenantId)}`,
    );
  }
  if (ctx.region !== "UAE" && ctx.region !== "EU" && ctx.region !== "US") {
    throw new TenantContextRequiredError(`region must be one of UAE|EU|US, got ${JSON.stringify(ctx.region)}`);
  }
  if (ctx.environment !== "Sandbox" && ctx.environment !== "Staging" && ctx.environment !== "Production") {
    throw new TenantContextRequiredError(
      `environment must be one of Sandbox|Staging|Production, got ${JSON.stringify(ctx.environment)}`,
    );
  }
}

/**
 * Opens a transaction on the non-owner "app" role and scopes it to exactly one
 * tenant via `SET LOCAL app.current_tenant` (LLD §3.2 rule 4 / ADR-0001). This is the
 * **only** primitive any tenant-scoped module may use to reach the database.
 *
 * Guarantees:
 *  - Throws `TenantContextRequiredError` synchronously if `ctx` is missing/invalid —
 *    no connection is opened, no query runs.
 *  - The GUC is set via a parameterized `set_config` call (never string-interpolated),
 *    so a crafted tenantId cannot be used for SQL injection even in principle.
 *  - On any error (including the GUC-set call itself failing) the transaction is
 *    rolled back and the client is released back to the pool.
 *  - `fn`'s return value is only produced after a successful `COMMIT`.
 *
 * @param ctx tenant/region/environment the caller is scoped to.
 * @param fn  callback receiving a Drizzle handle bound to this transaction.
 * @throws {TenantContextRequiredError} when `ctx` is missing or malformed.
 * @throws {TenantIsolationViolationError} when the database rejects the GUC set.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (db: TenantScopedClient) => Promise<T>,
): Promise<T> {
  return withTenantOnPool(getAppPool, ctx, fn);
}

/**
 * Identical tenant-scoping behavior to `withTenant`, but on the "gateway" role's pool
 * (Phase 4/BL-02). `apps/gateway` is the only process wired to use this — it is the
 * sole caller with the extra column-level grant needed to decrypt `credential.ciphertext`
 * (LLD §3.5), while remaining exactly as RLS-scoped and tenant-isolated as `withTenant`.
 */
export async function withGatewayTenant<T>(
  ctx: TenantContext,
  fn: (db: TenantScopedClient) => Promise<T>,
): Promise<T> {
  return withTenantOnPool(getGatewayPool, ctx, fn);
}

/**
 * @param getPool a **lazy** pool accessor (not an already-resolved `Pool`) — invoked
 * only *after* `assertValidTenantContext` passes. This matters: `getAppPool()`/
 * `getGatewayPool()` read process env (`loadDbEnv()`) and throw if it's missing, which
 * must never mask/precede the fail-closed `TenantContextRequiredError` an invalid
 * `ctx` produces (a plain eagerly-evaluated `pool: Pool` parameter would evaluate the
 * getter as the call argument, before this function's body — and its validation —
 * ever runs).
 */
async function withTenantOnPool<T>(
  getPool: () => ReturnType<typeof getAppPool>,
  ctx: TenantContext,
  fn: (db: TenantScopedClient) => Promise<T>,
): Promise<T> {
  assertValidTenantContext(ctx);

  const client: PoolClient = await getPool().connect();
  try {
    await client.query("BEGIN");

    try {
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [ctx.tenantId]);
    } catch (cause) {
      await client.query("ROLLBACK");
      throw new TenantIsolationViolationError(cause);
    }

    const db = drizzle(client, { schema });
    try {
      const result = await fn(db);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    client.release();
  }
}
