import pg from "pg";
import { loadDbEnv } from "./config.js";

/**
 * Lazily-created, process-wide `pg.Pool`s, one per Postgres role.
 *
 * ADR-0001 requires connection poolers to run in **transaction pooling mode only**
 * (session pooling would break `SET LOCAL` semantics — a setting from a previous
 * tenant's transaction could leak into the next). `pg.Pool` itself hands out a
 * dedicated physical connection per checked-out client and returns it to the pool on
 * `release()`, which is transaction-pooling-safe as long as callers always wrap their
 * work in BEGIN/COMMIT (or ROLLBACK) before releasing — which `withTenant`/
 * `withPlatform` do unconditionally.
 */
let appPool: pg.Pool | undefined;
let platformPool: pg.Pool | undefined;
let ownerPool: pg.Pool | undefined;
let gatewayPool: pg.Pool | undefined;

/** The non-owner "app" role pool — RLS-enforced, used by `withTenant`. */
export function getAppPool(): pg.Pool {
  if (!appPool) {
    appPool = new pg.Pool({ connectionString: loadDbEnv().NEXTBOT_DB_APP_URL, max: 10 });
  }
  return appPool;
}

/** The BYPASSRLS "platform" role pool — used only by `withPlatform` (two call sites). */
export function getPlatformPool(): pg.Pool {
  if (!platformPool) {
    platformPool = new pg.Pool({
      connectionString: loadDbEnv().NEXTBOT_DB_PLATFORM_URL,
      max: 4,
    });
  }
  return platformPool;
}

/** The schema-owner role pool — migrations and role/grant bootstrap only. */
export function getOwnerPool(): pg.Pool {
  if (!ownerPool) {
    ownerPool = new pg.Pool({ connectionString: loadDbEnv().NEXTBOT_DB_OWNER_URL, max: 2 });
  }
  return ownerPool;
}

/** The non-BYPASSRLS "gateway" role pool (Phase 4/BL-02) — used only inside
 * `apps/gateway`, via `withGatewayTenant`. Same RLS exposure as `getAppPool()`; its
 * only extra privilege is the column-level SELECT grant on `credential.ciphertext`. */
export function getGatewayPool(): pg.Pool {
  if (!gatewayPool) {
    gatewayPool = new pg.Pool({ connectionString: loadDbEnv().NEXTBOT_DB_GATEWAY_URL, max: 10 });
  }
  return gatewayPool;
}

/** Test/shutdown helper: closes every pool this process opened. */
export async function closeAllPools(): Promise<void> {
  await Promise.all([appPool?.end(), platformPool?.end(), ownerPool?.end(), gatewayPool?.end()]);
  appPool = undefined;
  platformPool = undefined;
  ownerPool = undefined;
  gatewayPool = undefined;
}
