import neo4j, { type ManagedTransaction, type Result, type Session } from "neo4j-driver";
import { getServiceDriver } from "./driver.js";
import { loadGraphStoreEnv } from "./config.js";
import { assertValidTenantId, tenantDatabaseName, tenantUserName } from "./naming.js";
import { GraphStoreForbiddenError, GraphStoreUnavailableError, isNeo4jErrorLike } from "./errors.js";

/** The transaction handle a `withTenantGraph()` callback receives — a thin alias so
 *  callers never need to import `neo4j-driver` types directly (LLD §14.4.6's
 *  `GraphTx`). */
export type GraphTx = ManagedTransaction;

/**
 * **`withTenantGraph(tenantId, fn)`** — ADR-0018 §2.2's single primitive, the exact
 * analogue of `@nextbot/db`'s `withTenant()`. This is the ONLY place in this
 * package (and, because `neo4j-driver` is dependency-cruiser-restricted to this
 * package, in the entire codebase) that ever calls `driver.session(...)`.
 *
 * Opens a session against the tenant's own database
 * (`{ database: 't-<hex>', impersonatedUser: 'u-<hex>' }`) on the shared
 * **service** driver — never a per-tenant credential (ADR-0018 §2.2's whole point:
 * one pool, one credential, and the engine still refuses a cross-database read).
 *
 * Guarantees:
 *  - Throws `GraphStoreInvalidIdentifierError` synchronously if `tenantId` is not a
 *    well-formed UUID — no session is opened.
 *  - `fn`'s return value is only produced after the transaction function
 *    (`executeRead`/`executeWrite`) resolves successfully — retries on a transient
 *    cluster-leader-switch error are the driver's own responsibility (LLD §14.4.6:
 *    "Transaction functions, not autocommit").
 *  - A `Neo.ClientError.Security.Forbidden`/`.Unauthorized` response is NEVER
 *    swallowed into an empty result — it is re-thrown as `GraphStoreForbiddenError`,
 *    a hard signal that something attempted to cross the tenant isolation boundary.
 *  - A connectivity failure is re-thrown as `GraphStoreUnavailableError` (maps to
 *    ADR-0018 §2.8's degradation path upstream).
 *  - The session is always closed, even on error.
 *
 * @param tenantId the tenant whose database this session is scoped to.
 * @param fn callback receiving a Neo4j managed-transaction handle.
 * @param mode `"READ"` uses `executeRead` (read replicas eligible in a cluster);
 *             `"WRITE"` (default) uses `executeWrite`.
 * @throws {GraphStoreInvalidIdentifierError} when `tenantId` is malformed.
 * @throws {GraphStoreForbiddenError} on any engine-level authorization rejection.
 * @throws {GraphStoreUnavailableError} when Neo4j is unreachable.
 */
export async function withTenantGraph<T>(
  tenantId: string,
  fn: (tx: GraphTx) => Promise<T>,
  mode: "READ" | "WRITE" = "WRITE",
): Promise<T> {
  assertValidTenantId(tenantId);
  const env = loadGraphStoreEnv();
  const database = tenantDatabaseName(env.GRAPH_STORE_DATABASE_PREFIX, tenantId);
  const impersonatedUser = tenantUserName(tenantId);

  const driver = getServiceDriver();
  const session: Session = driver.session({
    database,
    impersonatedUser,
    defaultAccessMode: mode === "READ" ? neo4j.session.READ : neo4j.session.WRITE,
  });

  try {
    if (mode === "READ") {
      return await session.executeRead(fn);
    }
    return await session.executeWrite(fn);
  } catch (err) {
    throw mapGraphStoreError(err, { tenantId, database });
  } finally {
    await session.close();
  }
}

/** Minimal structural surface `withTenantGraphAutoCommit()`'s callback needs — a
 *  real `neo4j-driver` `Session` satisfies this. Kept narrow so callers can't
 *  accidentally call `session.close()`/`beginTransaction()` themselves from inside
 *  the callback (this file is the only place that manages the session lifecycle). */
export interface GraphAutoCommitContext {
  run(query: string, params?: Record<string, unknown>): Result;
}

/**
 * **`withTenantGraphAutoCommit(tenantId, fn)`** — the one deliberate, disclosed
 * exception to "transaction functions, not autocommit" (LLD §14.4.6). Verified
 * empirically against a real Neo4j 5 Enterprise instance during this phase's
 * implementation: a query containing `CALL {...} IN TRANSACTIONS` is REJECTED by
 * the server with `Neo.DatabaseError.Transaction.TransactionStartFailed` when run
 * inside an explicit transaction (`session.executeWrite`/`executeRead`) — Neo4j
 * requires that clause to run in an implicit ("auto-commit") transaction via plain
 * `session.run()`. `dropGeneration()`'s batched delete is the ONLY port method that
 * needs this; every other method uses the driver's own transaction-function retry
 * via `withTenantGraph()` above.
 *
 * Because auto-commit queries lose the transaction function's built-in retry, this
 * wraps `session.run()` in a small bounded retry loop using the driver's own
 * `neo4j.isRetriableError()` classifier (the same check `executeWrite` uses
 * internally) — a transient leader-switch mid-batch is safe to just retry, since
 * `dropGeneration`'s underlying Cypher is idempotent by construction (re-running it
 * only deletes whatever of the generation's label still matches; it never
 * duplicates or corrupts state).
 *
 * Opens the session exactly the same way `withTenantGraph()` does (same database/
 * impersonatedUser resolution, same error mapping, same guaranteed close) — this is
 * still the same "one place opens a session" primitive, just a second calling
 * convention for the one Cypher construct that cannot use the first.
 */
export async function withTenantGraphAutoCommit<T>(
  tenantId: string,
  fn: (ctx: GraphAutoCommitContext) => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  assertValidTenantId(tenantId);
  const env = loadGraphStoreEnv();
  const database = tenantDatabaseName(env.GRAPH_STORE_DATABASE_PREFIX, tenantId);
  const impersonatedUser = tenantUserName(tenantId);

  const driver = getServiceDriver();
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const session: Session = driver.session({
      database,
      impersonatedUser,
      defaultAccessMode: neo4j.session.WRITE,
    });
    try {
      return await fn(session);
    } catch (err) {
      const mapped = mapGraphStoreError(err, { tenantId, database });
      if (!neo4j.isRetriableError(err) || attempt >= maxAttempts) {
        throw mapped;
      }
      lastError = mapped;
      // fall through to retry — the failed session is still closed below first.
    } finally {
      await session.close();
    }
  }
  // Unreachable in practice (the loop above always returns or throws on its final
  // attempt), but keeps TypeScript's control-flow analysis happy without an `any`
  // cast, and gives a sane error if it somehow is reached.
  throw lastError ?? new GraphStoreUnavailableError("withTenantGraphAutoCommit exhausted retries");
}

/**
 * Maps a raw driver error to this package's typed errors (LLD §14.4.6's "Failure
 * mapping"). `Neo.ClientError.Security.*` becomes `GraphStoreForbiddenError` — a
 * hard alert, never treated as "no data" — and connectivity failures become
 * `GraphStoreUnavailableError`. Every other error passes through unchanged (a
 * genuine query/programming bug should surface with its own real stack, not be
 * relabeled).
 */
export function mapGraphStoreError(err: unknown, context: { tenantId?: string; database?: string }): unknown {
  if (isNeo4jErrorLike(err)) {
    if (err.code.startsWith("Neo.ClientError.Security.")) {
      const forbidden = new GraphStoreForbiddenError(err, context);
      // No file-sink logger exists yet in this codebase (same disclosed state as
      // `packages/modules/authz/src/application/evaluate-or-deny.ts`'s own catch
      // path) — `console.error` is the same-severity "alert, don't swallow"
      // signal every other module's fail-closed path already uses.
      console.error("[graph-store] SECURITY ALERT — Neo4j rejected an operation as a security violation", {
        tenantId: context.tenantId,
        database: context.database,
        code: err.code,
      });
      return forbidden;
    }
    // Connectivity errors (LLD §14.4.6: "Connectivity errors map to
    // GRAPH_STORE_UNAVAILABLE (503) and the ADR-0018 §2.8 degradation path") — a
    // genuinely different failure mode from a security rejection, so it must not
    // share the alert-worthy Forbidden path above.
    if (err.code === "ServiceUnavailable" || err.code === "SessionExpired") {
      return new GraphStoreUnavailableError(err);
    }
  }
  return err;
}
