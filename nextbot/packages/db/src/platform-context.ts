import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { getPlatformPool } from "./pool.js";
import * as schema from "./schema/index.js";

/** The Drizzle handle yielded to `withPlatform` callbacks — BYPASSRLS, unscoped. */
export type PlatformClient = NodePgDatabase<typeof schema>;

/**
 * Opens a transaction on the BYPASSRLS "platform" Postgres role — the one primitive
 * that can see across every tenant. Per LLD §3.2 rule 4 it is callable from exactly
 * two places:
 *   1. `packages/modules/tenancy` (provisioning) — a tenant necessarily has no
 *      `TenantContext` yet at the moment it is being created.
 *   2. `apps/web/app/api/internal/ops/**` (NFR-11 internal operator console).
 *
 * This file is kept separate from `tenant-context.ts` specifically so that
 * `.dependency-cruiser.cjs`'s `no-platform-outside-allowed-callers` rule can restrict
 * *this module* to those two importers — a restriction ESLint's package-level
 * boundaries plugin cannot express, since both call sites otherwise have every right
 * to import `@nextbot/db`.
 *
 * Every call site is expected to write an audit trail entry itself (this primitive
 * does not do it implicitly, since "operator bypassed tenant isolation for reason X"
 * is a domain-level fact the caller knows and this package does not).
 */
export async function withPlatform<T>(fn: (db: PlatformClient) => Promise<T>): Promise<T> {
  const pool = getPlatformPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
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
