import crypto from "node:crypto";
import neo4j, { type Session } from "neo4j-driver";
import { getAdminDriver } from "../driver.js";
import { loadGraphStoreEnv } from "../config.js";
import { tenantDatabaseName, tenantRoleName, tenantUserName } from "../naming.js";
import { GraphStoreForbiddenError, isNeo4jErrorLike } from "../errors.js";

/** The single, shared service-user role every tenant's per-tenant user is granted
 *  `IMPERSONATE` under (ADR-0018 §2.2). One role, reused across every tenant — a
 *  per-tenant service-user role would be a second, unnecessary indirection since
 *  IMPERSONATE grants can simply list multiple target users on the one role. */
const SERVICE_ROLE_NAME = "role_svc_graph";

/** How long `CREATE DATABASE ... WAIT` blocks for the new database to come online
 *  before giving up — bounded so a stalled cluster fails this call loudly rather
 *  than hanging the caller indefinitely. */
const CREATE_DATABASE_WAIT_SECONDS = 60;

/**
 * Neo4j error codes that mean "the `IF NOT EXISTS`/`IF EXISTS` clause's intent was
 * ALREADY satisfied" — but reached via a genuine server-side race rather than the
 * clause itself, which is check-then-act, not atomic, across two truly concurrent
 * sessions (verified empirically against a real Neo4j 5 Enterprise instance during
 * this phase's implementation: 20 concurrent `CREATE ROLE x IF NOT EXISTS` calls
 * for the same role name produced 19 "Role already exists" errors alongside the
 * one that actually won the race). Since ADR-0018 §4 requires provisioning to be
 * safely callable concurrently (two tenants might be provisioned by two concurrent
 * requests, both bootstrapping the one shared service role/user), these specific
 * "already exists"/"already dropped" outcomes are treated as success, not failure —
 * they mean exactly what `IF NOT EXISTS`/`IF EXISTS` asked for, just arrived at by
 * a different path than the single-caller case.
 *
 * **Phase 7b fast-follow (QA finding on the 7a pass)**: firing 5 concurrent
 * `ensureTenantGraphDatabase()` calls for the same brand-new tenant reliably produced
 * 1-2 rejected promises with `Neo.ClientError.Schema.EquivalentSchemaRuleAlreadyExists`
 * ("An equivalent index already exists...") from `ensureIndexesAndConstraints()`'s own
 * `CREATE INDEX/CONSTRAINT ... IF NOT EXISTS` race — a real schema-token race distinct
 * from (and previously missed by) the `DeadlockDetected` transient-error race already
 * handled by the retry path below. Investigated per this fast-follow's own brief before
 * tolerating it: reproduced against a real Neo4j 5 Enterprise instance and confirmed the
 * constraint/index this call was trying to create IS genuinely already present and
 * correct by the time this error surfaces (the winning racer created it first) — this is
 * the exact same benign "someone else already created it" outcome already tolerated for
 * `CREATE DATABASE`/`ROLE`/`USER` above, just Neo4j's schema subsystem surfacing it under
 * a different error code than the generic `ArgumentError` shape those use. Tolerating it
 * here (rather than adding a lock/mutex around schema DDL) is the more correct fix
 * because it matches this file's own established idiom for every other "same DDL fired
 * concurrently by two provisioning callers" race, and because a lock would add real
 * machinery (a distributed lock this codebase has no primitive for yet) to guard against
 * an outcome that is already safe to observe and ignore.
 */
const ALREADY_SATISFIED_CODES = new Set([
  "Neo.ClientError.Database.ExistingDatabaseFound", // CREATE DATABASE race
  "Neo.ClientError.Schema.EquivalentSchemaRuleAlreadyExists", // CREATE INDEX/CONSTRAINT race
]);

/** `CREATE ROLE`/`CREATE USER` races surface as this SAME generic code for many
 *  unrelated argument problems too, so (unlike the database case above) this needs
 *  a message-shape check as well, not just the code. */
function isAlreadyExistsArgumentError(err: unknown): boolean {
  return (
    isNeo4jErrorLike(err) &&
    err.code === "Neo.ClientError.Statement.ArgumentError" &&
    /already exists/i.test(err.message)
  );
}

/**
 * Runs a `CREATE ... IF NOT EXISTS`/`DROP ... IF EXISTS`-style idempotent DDL
 * statement, tolerating the genuine race conditions Neo4j's system database has
 * for these clauses under real concurrency (see `ALREADY_SATISFIED_CODES`'s doc
 * comment), and retrying a `Neo.TransientError.*` (e.g. `DeadlockDetected`, also
 * observed empirically under concurrent `CREATE CONSTRAINT`/`CREATE INDEX` calls
 * against the same database) up to `maxAttempts` times using the driver's own
 * `neo4j.isRetriableError()` classifier.
 */
/** Exported for this file's own unit tests (`tenant-database-provisioner.test.ts`)
 *  to exercise the race-tolerance/retry logic directly against a mocked session,
 *  without needing to reproduce a genuine concurrent-Neo4j race in every test run
 *  (the real race IS also exercised end to end by the integration/isolation
 *  suites' own concurrent provisioning calls). Not part of this package's public
 *  `.`/`./provisioning` entry points (see `provisioning/index.ts`). */
export async function runIdempotentDdl(
  session: Session,
  cypher: string,
  params: Record<string, unknown> = {},
  maxAttempts = 5,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await session.run(cypher, params);
      return;
    } catch (err) {
      if (ALREADY_SATISFIED_CODES.has(isNeo4jErrorLike(err) ? err.code : "") || isAlreadyExistsArgumentError(err)) {
        return; // the clause's intent was already satisfied — a race, not a failure.
      }
      if (neo4j.isRetriableError(err) && attempt < maxAttempts) {
        continue; // e.g. a transient deadlock under concurrent schema DDL — retry.
      }
      throw err;
    }
  }
}

export interface TenantGraphDatabaseProvisionResult {
  databaseName: string;
  /** `true` only the first time this tenant's database was actually created —
   *  `false` on every idempotent re-run afterward. */
  created: boolean;
}

/**
 * Idempotently provisions a tenant's isolated Neo4j database, role, and user
 * (ADR-0018 §2.2/§4: "Provisioning a tenant now touches two engines... must do so
 * idempotently — a half-provisioned tenant... must be repairable by a re-run, not
 * by hand"). Safe to call repeatedly for the same tenant — every statement uses
 * `IF NOT EXISTS`/is naturally idempotent (`GRANT` of an already-held privilege is
 * a no-op in Neo4j, verified against a real instance during this phase's
 * implementation), so a partial failure on attempt N is fully repaired by simply
 * calling this again.
 *
 * Uses the **admin** driver exclusively (`getAdminDriver()`) — this is the one
 * place in this package that authenticates as anything other than the service
 * user, and it is never used to read/write tenant graph data, only to manage
 * databases/roles/grants/schema.
 *
 * Privilege set granted to the tenant's role (ADR-0018 §2.2's "no BYPASS
 * equivalent anywhere", verified against a real Neo4j 5 Enterprise instance):
 * `ACCESS` on the one database, `ALL GRAPH PRIVILEGES` (traverse/read/match/write/
 * delete data), and the three `CREATE NEW {NODE LABEL, RELATIONSHIP TYPE, PROPERTY
 * NAME}` token-creation privileges the ingestion pipeline needs to write a new
 * per-generation label (`:G_<hex>`) — deliberately NOT `CREATE DATABASE`/schema
 * constraint-or-index management/any DBMS-level privilege, which stay
 * admin-only.
 *
 * The per-tenant user's password is a random, immediately-discarded value: it is
 * NEVER used to log in directly (impersonation is the only access path, per
 * ADR-0018 §2.2), so there is nothing to persist or rotate for it.
 *
 * @throws {GraphStoreForbiddenError} if the admin credential itself lacks the
 *   DBMS-admin privileges this requires — a misconfiguration, not a tenant-data
 *   access attempt, but mapped through the same "never silent" error type since
 *   both are engine-level authorization rejections.
 */
export async function ensureTenantGraphDatabase(tenantId: string): Promise<TenantGraphDatabaseProvisionResult> {
  const env = loadGraphStoreEnv();
  const databaseName = tenantDatabaseName(env.GRAPH_STORE_DATABASE_PREFIX, tenantId);
  const roleName = tenantRoleName(tenantId);
  const userName = tenantUserName(tenantId);

  const driver = getAdminDriver();
  const session: Session = driver.session({ database: "system", defaultAccessMode: neo4j.session.WRITE });
  try {
    await ensureServiceRoleAndUser(session, env.GRAPH_STORE_SERVICE_USER, env.GRAPH_STORE_CREDENTIAL_REF);

    const existedBefore = await databaseExists(session, databaseName);
    await runIdempotentDdl(
      session,
      `CREATE DATABASE \`${databaseName}\` IF NOT EXISTS WAIT ${CREATE_DATABASE_WAIT_SECONDS} SECONDS`,
    );

    await runIdempotentDdl(session, `CREATE ROLE ${roleName} IF NOT EXISTS`);
    await runIdempotentDdl(session, `GRANT ACCESS ON DATABASE \`${databaseName}\` TO ${roleName}`);
    await runIdempotentDdl(session, `GRANT ALL GRAPH PRIVILEGES ON GRAPH \`${databaseName}\` TO ${roleName}`);
    await runIdempotentDdl(session, `GRANT CREATE NEW NODE LABEL ON DATABASE \`${databaseName}\` TO ${roleName}`);
    await runIdempotentDdl(session, `GRANT CREATE NEW RELATIONSHIP TYPE ON DATABASE \`${databaseName}\` TO ${roleName}`);
    await runIdempotentDdl(session, `GRANT CREATE NEW PROPERTY NAME ON DATABASE \`${databaseName}\` TO ${roleName}`);

    // The per-tenant user, impersonated-only (never logged into directly) — see
    // this function's own doc comment for why the password is thrown away.
    const throwawayPassword = crypto.randomBytes(24).toString("base64url");
    await runIdempotentDdl(
      session,
      `CREATE USER ${userName} IF NOT EXISTS SET PASSWORD $password CHANGE NOT REQUIRED SET STATUS ACTIVE`,
      { password: throwawayPassword },
    );
    // `CREATE ... IF NOT EXISTS` no-ops the `SET STATUS` clause on a repeat call —
    // this guarantees a pre-existing user is (still) ACTIVE regardless, since
    // Neo4j refuses to impersonate a SUSPENDED user (verified against a real
    // instance: "Cannot impersonate user ..." otherwise).
    await runIdempotentDdl(session, `ALTER USER ${userName} SET STATUS ACTIVE`);
    await runIdempotentDdl(session, `GRANT ROLE ${roleName} TO ${userName}`);

    // The critical grant: the shared service role may impersonate THIS tenant's
    // user, and only this tenant's user — this line is what turns "one shared
    // service credential" into "still one isolated tenant per database" rather
    // than a service account with universal access.
    await runIdempotentDdl(session, `GRANT IMPERSONATE (${userName}) ON DBMS TO ${SERVICE_ROLE_NAME}`);

    await ensureIndexesAndConstraints(driver, databaseName);

    return { databaseName, created: !existedBefore };
  } catch (err) {
    if (isNeo4jErrorLike(err) && err.code.startsWith("Neo.ClientError.Security.")) {
      throw new GraphStoreForbiddenError(err, { tenantId, database: databaseName });
    }
    throw err;
  } finally {
    await session.close();
  }
}

/**
 * Idempotently ensures the one shared service role/user this whole package's
 * `withTenantGraph()` authenticates as. Deliberately does NOT force-align the
 * user's password on a repeat call (`ALTER USER ... SET PASSWORD` to the SAME
 * value Neo4j already has is REJECTED with "new password cannot be the same as
 * the old password" — verified against a real instance) — `CREATE USER ... IF NOT
 * EXISTS` already sets it correctly exactly once, on first creation, and every
 * later call is a true no-op for an existing user, which is the idempotent
 * behavior this package needs.
 */
async function ensureServiceRoleAndUser(session: Session, serviceUser: string, credential: string): Promise<void> {
  await runIdempotentDdl(session, `CREATE ROLE ${SERVICE_ROLE_NAME} IF NOT EXISTS`);
  await runIdempotentDdl(
    session,
    `CREATE USER ${serviceUser} IF NOT EXISTS SET PASSWORD $password CHANGE NOT REQUIRED SET STATUS ACTIVE`,
    { password: credential },
  );
  await runIdempotentDdl(session, `ALTER USER ${serviceUser} SET STATUS ACTIVE`);
  await runIdempotentDdl(session, `GRANT ROLE ${SERVICE_ROLE_NAME} TO ${serviceUser}`);
}

async function databaseExists(session: Session, databaseName: string): Promise<boolean> {
  const result = await session.run("SHOW DATABASES WHERE name = $name", { name: databaseName });
  return result.records.length > 0;
}

/**
 * Creates the indexes/constraints ADR-0018 §5 names, scoped to what the current
 * `GraphNodeRecord` port shape actually supports.
 *
 * **Disclosed narrowing**: LLD §14.4.6's "Indexes/constraints per tenant database"
 * list also names a unique constraint on `(:Entity {generationId, canonicalName})`
 * — `canonicalName` is an entity-resolution/dedup concept that belongs to Phase
 * 7b's ingestion-pipeline design (deterministic + embedding-similarity dedup by
 * canonical name within a generation) and does not exist on this phase's
 * `GraphNodeRecord` (§14.4.6 itself: "Deliberately NO name/summary/text field").
 * This phase creates the constraints/indexes the current port shape supports —
 * unique `(:Entity {id})` (the port's own uniqueness key), an index on
 * `(:Entity {generationId})`, and an index on `(:Entity {aclTags})` — and leaves
 * the `canonicalName` constraint for Phase 7b's own schema-provisioning work to
 * add once that field exists. Per-relationship-type indexes are similarly deferred
 * (which relation types will exist is an ingestion-time decision, not knowable
 * from this phase's port shape).
 */
async function ensureIndexesAndConstraints(driver: ReturnType<typeof getAdminDriver>, databaseName: string): Promise<void> {
  const session = driver.session({ database: databaseName, defaultAccessMode: neo4j.session.WRITE });
  try {
    // `CREATE CONSTRAINT`/`CREATE INDEX ... IF NOT EXISTS` against the same database
    // under genuine concurrency was observed to produce BOTH a
    // `Neo.TransientError.Transaction.DeadlockDetected` (handled by
    // `runIdempotentDdl`'s retry-on-transient-error path) AND a
    // `Neo.ClientError.Schema.EquivalentSchemaRuleAlreadyExists` schema-token race
    // (handled by `ALREADY_SATISFIED_CODES` above, added as a 7b fast-follow after
    // QA's 7a pass found the original version of this comment was wrong to claim
    // only the deadlock case occurs).
    await runIdempotentDdl(session, "CREATE CONSTRAINT entity_id_unique IF NOT EXISTS FOR (n:Entity) REQUIRE n.id IS UNIQUE");
    await runIdempotentDdl(session, "CREATE INDEX entity_generation_idx IF NOT EXISTS FOR (n:Entity) ON (n.generationId)");
    await runIdempotentDdl(session, "CREATE INDEX entity_acltags_idx IF NOT EXISTS FOR (n:Entity) ON (n.aclTags)");
  } finally {
    await session.close();
  }
}

/**
 * The lazy-drop half of ADR-0018 §2.2's tenant database lifecycle ("dropped when
 * its last collection is deleted"). Built now as an idempotent primitive — no call
 * site wires it up yet (that trigger, "on last collection deleted", is real
 * ingestion-pipeline/Phase 7b logic this phase does not build) — so Phase 7b can
 * call it directly without adding any new isolation-relevant code.
 *
 * Drops the tenant's user, role, and database, in FK-safe order (a role/user with
 * live grants on a database must be handled before the database itself is
 * dropped — Neo4j drops the grants automatically when the role is dropped, so the
 * order here is role/user first, database last, purely for a clean/predictable
 * sequence rather than a hard requirement).
 */
export async function dropTenantGraphDatabase(tenantId: string): Promise<void> {
  const env = loadGraphStoreEnv();
  const databaseName = tenantDatabaseName(env.GRAPH_STORE_DATABASE_PREFIX, tenantId);
  const roleName = tenantRoleName(tenantId);
  const userName = tenantUserName(tenantId);

  const driver = getAdminDriver();
  const session: Session = driver.session({ database: "system", defaultAccessMode: neo4j.session.WRITE });
  try {
    await runIdempotentDdl(session, `DROP ROLE ${roleName} IF EXISTS`);
    await runIdempotentDdl(session, `DROP USER ${userName} IF EXISTS`);
    await runIdempotentDdl(session, `DROP DATABASE \`${databaseName}\` IF EXISTS`);
  } catch (err) {
    if (isNeo4jErrorLike(err) && err.code.startsWith("Neo.ClientError.Security.")) {
      throw new GraphStoreForbiddenError(err, { tenantId, database: databaseName });
    }
    throw err;
  } finally {
    await session.close();
  }
}
