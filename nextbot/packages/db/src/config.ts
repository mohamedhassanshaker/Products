import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/**
 * Environment configuration for `@nextbot/db`, validated with TypeBox at first use
 * (LLD §1: "TypeBox everywhere"; LLD §11.10: fail at startup, never at request time).
 *
 * Three distinct connection strings model ADR-0001's role separation:
 *  - `NEXTBOT_DB_OWNER_URL`    — schema owner, used only for migrations (drizzle-kit).
 *  - `NEXTBOT_DB_APP_URL`      — the non-owner "app" role. `withTenant()` connects with
 *                                this role and is the ONLY path allowed to read/write
 *                                tenant-scoped tables (RLS-enforced).
 *  - `NEXTBOT_DB_PLATFORM_URL` — a distinct, BYPASSRLS-capable role. `withPlatform()`
 *                                connects with this role. Callable only from the two
 *                                call sites named in LLD §3.2 rule 4 (enforced by
 *                                dependency-cruiser, see .dependency-cruiser.cjs).
 *
 * In local/CI test runs (`NEXTBOT_DB_ENV=test`) the equivalent `*_TEST_URL` variables
 * are used instead, pointed at compose.test.yml's ephemeral Postgres.
 */
const EnvSchema = Type.Object({
  NEXTBOT_DB_OWNER_URL: Type.String({ minLength: 1 }),
  NEXTBOT_DB_APP_URL: Type.String({ minLength: 1 }),
  NEXTBOT_DB_PLATFORM_URL: Type.String({ minLength: 1 }),
  // Phase 4 (BL-02): a fourth, distinct, non-BYPASSRLS role used only by
  // apps/gateway. RLS still applies to it like the "app" role — the isolation
  // guarantee is identical — but it additionally holds a column-level SELECT grant on
  // `credential.ciphertext` that the "app" role does not (LLD §3.5: "SELECT on this
  // column is granted only to the gateway DB role"). See ensure-roles.ts.
  NEXTBOT_DB_GATEWAY_URL: Type.String({ minLength: 1 }),
});

export type DbEnv = Static<typeof EnvSchema>;

let cached: DbEnv | undefined;

/**
 * Reads and validates the process environment for the three connection strings this
 * package needs. Throws synchronously (a startup failure, per LLD §11.10) rather than
 * deferring the problem to the first query.
 */
export function loadDbEnv(): DbEnv {
  if (cached) return cached;

  const isTest = process.env.NEXTBOT_DB_ENV === "test";
  const raw = {
    NEXTBOT_DB_OWNER_URL: isTest
      ? process.env.NEXTBOT_DB_OWNER_TEST_URL
      : process.env.NEXTBOT_DB_OWNER_URL,
    NEXTBOT_DB_APP_URL: isTest
      ? process.env.NEXTBOT_DB_APP_TEST_URL
      : process.env.NEXTBOT_DB_APP_URL,
    NEXTBOT_DB_PLATFORM_URL: isTest
      ? process.env.NEXTBOT_DB_PLATFORM_TEST_URL
      : process.env.NEXTBOT_DB_PLATFORM_URL,
    NEXTBOT_DB_GATEWAY_URL: isTest
      ? process.env.NEXTBOT_DB_GATEWAY_TEST_URL
      : process.env.NEXTBOT_DB_GATEWAY_URL,
  };

  if (!Value.Check(EnvSchema, raw)) {
    const errors = [...Value.Errors(EnvSchema, raw)].map((e) => `${e.path}: ${e.message}`);
    throw new Error(
      `@nextbot/db: invalid/missing database configuration:\n${errors.join("\n")}`,
    );
  }

  cached = raw;
  return cached;
}

/** Test-only: clears the cached env so a test can re-load with different values. */
export function _resetDbEnvCacheForTests(): void {
  cached = undefined;
}
