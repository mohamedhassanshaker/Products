import { eq } from "drizzle-orm";
import { schema } from "@nextbot/db";
import { withPlatform } from "@nextbot/db/platform-only";
import { loadGraphStoreEnv, tenantDatabaseName } from "@nextbot/graph-store";
import { ensureTenantGraphDatabase } from "@nextbot/graph-store/provisioning";

/**
 * Target Architecture Blueprint Phase 7a (ADR-0018 §2.2/§4) — provisions the
 * tenant's isolated Neo4j database/role/user immediately after its Postgres row
 * exists.
 *
 * **Disclosed, deliberate deviation from ADR-0018 §2.2's "created lazily, on a
 * tenant's first knowledge collection build"**: this phase has no ingestion
 * pipeline yet to hang a "first collection build" hook off of (that is Phase 7b's
 * scope), so this dispatch's own brief calls for provisioning eagerly, at
 * tenant-creation time, so Phase 7b's ingestion work can assume the database
 * already exists by the time it runs. See `packages/db/src/schema/tenancy.ts`'s
 * `tenantGraphDatabaseRoute` doc comment for the same disclosure recorded at the
 * schema level. Nothing about the ISOLATION MECHANISM itself changes — only when
 * `ensureTenantGraphDatabase()` is first called for a given tenant. A later phase
 * (or a cost-optimization pass) can move this call site to a real "first
 * collection build" hook without touching `ensureTenantGraphDatabase()`'s
 * idempotent primitive at all.
 *
 * **Deliberately best-effort / non-blocking to tenant creation**: unlike the
 * Postgres-side provisioning `provisionTenant()` already does (which must
 * succeed or the whole tenant creation fails), THIS function never throws and
 * never rolls back the tenant that was already committed to Postgres before it
 * runs. Two real, expected conditions justify this:
 *
 *  1. **The graph store may not be configured at all in this environment** —
 *     `GRAPH_STORE_*` env vars are absent in every test/dev environment that
 *     predates this phase (the large majority of this codebase's existing
 *     integration-test suite, `scripts/seed.ts`, and every other pre-Phase-7a
 *     caller of `provisionTenant()`). Treating a missing config as "Module B
 *     genuinely isn't wired up here yet" (skip silently, write nothing) rather
 *     than a hard failure is what keeps `provisionTenant()` itself from becoming
 *     a hard dependency on Neo4j being reachable for every tenant-creation call
 *     site across the whole pre-existing test suite — that would be a real,
 *     unintended regression this dispatch's own brief does not ask for.
 *  2. **Neo4j itself may be transiently unreachable** even when configured (the
 *     same class of outage ADR-0018 §2.8 already designs around at retrieval
 *     time: "a graph-store outage degrades... rather than fail the turn"). This
 *     function extends that same philosophy one step earlier, to provisioning
 *     time: a tenant that cannot reach Neo4j right now still gets created in
 *     Postgres, and is left in the exact "half-provisioned, `provisionedAt IS
 *     NULL`" state ADR-0018 §4 names as the expected, repairable-by-re-run
 *     signal — repaired by simply invoking `ensureTenantGraphDatabase(tenantId)`
 *     again later (idempotent), never by hand.
 *
 * Every failure is logged via `console.error` (no file-sink logger exists yet in
 * this codebase — same disclosed convention `packages/modules/authz/src/
 * application/evaluate-or-deny.ts`'s catch path already uses) so a silent gap is
 * at least observable, even though it is not fatal.
 */
export async function provisionTenantGraphDatabase(tenantId: string): Promise<void> {
  let env;
  try {
    env = loadGraphStoreEnv();
  } catch {
    // Graph store not configured in this environment — nothing to do, and
    // nothing recorded (see this function's own doc comment, reason 1).
    return;
  }

  const clusterUrl = env.GRAPH_STORE_URL;
  const databaseName = tenantDatabaseName(env.GRAPH_STORE_DATABASE_PREFIX, tenantId);

  try {
    // The routing "intent" row is written FIRST — this is the Postgres-side
    // record that a graph database is (or should be) associated with this
    // tenant, independent of whether the real Neo4j-side provisioning below
    // succeeds on this attempt. `provisionedAt` stays NULL until it does.
    //
    // `onConflictDoNothing()` (Phase 7b fast-follow — a real bug the
    // reconciliation job for a stranded tenant exposed): this function is now
    // also called by `reconcileStrandedGraphProvisioning()` to RETRY a tenant
    // that already has a routing row (left at `provisionedAt IS NULL` by an
    // earlier failed attempt). A plain `INSERT` would fail with a duplicate-key
    // error on that retry and return early WITHOUT ever calling
    // `ensureTenantGraphDatabase()` again — silently defeating ADR-0018 §4's own
    // "repairable by a re-run" requirement. Tolerating the conflict and falling
    // through to the real provisioning call below is what actually makes a
    // re-run repair anything.
    await withPlatform((db) => db.insert(schema.tenantGraphDatabaseRoute).values({ tenantId, clusterUrl, databaseName }).onConflictDoNothing());
  } catch (err) {
    console.error("[tenancy] failed to write tenant_graph_database_route routing row", {
      tenantId,
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  try {
    await ensureTenantGraphDatabase(tenantId);
    await withPlatform((db) =>
      db
        .update(schema.tenantGraphDatabaseRoute)
        .set({ provisionedAt: new Date() })
        .where(eq(schema.tenantGraphDatabaseRoute.tenantId, tenantId)),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      "[tenancy] Neo4j graph database provisioning failed — tenant creation still succeeded; " +
        "recorded for repair (provisionedAt stays NULL), repair by re-invoking ensureTenantGraphDatabase()",
      { tenantId, databaseName, message },
    );
    await withPlatform((db) =>
      db
        .update(schema.tenantGraphDatabaseRoute)
        .set({ lastProvisionErrorAt: new Date(), lastProvisionError: message })
        .where(eq(schema.tenantGraphDatabaseRoute.tenantId, tenantId)),
    ).catch(() => {
      // Recording the failure is itself best-effort — a disk-full/DB-unavailable
      // error here must never mask the fact that graph provisioning failed, nor
      // throw into this function's own caller.
    });
  }
}
