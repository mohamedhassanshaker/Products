import neo4j, { type Driver } from "neo4j-driver";
import { loadGraphStoreEnv } from "./config.js";

/**
 * Lazily-created, process-wide `neo4j-driver` `Driver`s — one for the service
 * credential (`withTenantGraph()`'s only caller), one for the admin/bootstrap
 * credential (provisioning only). Mirrors `@nextbot/db/src/pool.ts`'s lazy
 * per-role-pool pattern exactly: "one driver, one credential, one pool" per LLD
 * §14.4.6's driver-specifics list — a `Driver` instance already IS a connection
 * pool internally (the `neo4j-driver` package manages Bolt connection pooling per
 * driver instance), so there is no separate pool wrapper needed the way `pg.Pool`
 * needs one.
 */
let serviceDriver: Driver | undefined;
let adminDriver: Driver | undefined;

/** The service-user driver — used ONLY by `tenant-session.ts`'s `withTenantGraph()`.
 *  Holds no data privileges of its own; every session opened from it MUST pass
 *  `impersonatedUser` (ADR-0018 §2.2). */
export function getServiceDriver(): Driver {
  if (!serviceDriver) {
    const env = loadGraphStoreEnv();
    serviceDriver = neo4j.driver(
      env.GRAPH_STORE_URL,
      neo4j.auth.basic(env.GRAPH_STORE_SERVICE_USER, env.GRAPH_STORE_CREDENTIAL_REF),
    );
  }
  return serviceDriver;
}

/** The admin/bootstrap driver — used ONLY by `provisioning/tenant-database-
 *  provisioner.ts`. Never used to read/write tenant data; only `CREATE DATABASE`/
 *  `CREATE ROLE`/`GRANT`/schema constraint-and-index management. */
export function getAdminDriver(): Driver {
  if (!adminDriver) {
    const env = loadGraphStoreEnv();
    adminDriver = neo4j.driver(
      env.GRAPH_STORE_URL,
      neo4j.auth.basic(env.GRAPH_STORE_ADMIN_USER, env.GRAPH_STORE_ADMIN_CREDENTIAL_REF),
    );
  }
  return adminDriver;
}

/** Test/shutdown helper: closes every driver this process opened. */
export async function closeAllGraphDrivers(): Promise<void> {
  await Promise.all([serviceDriver?.close(), adminDriver?.close()]);
  serviceDriver = undefined;
  adminDriver = undefined;
}
