import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/**
 * Environment configuration for `@nextbot/graph-store` (LLD §14.4.6's env list),
 * validated with TypeBox at first use (LLD §1: "TypeBox everywhere"; LLD §11.10:
 * fail at startup, never at request time).
 *
 * Two distinct credential pairs model ADR-0018 §2.2's role separation, the graph-side
 * analogue of `@nextbot/db`'s owner/app split:
 *  - `GRAPH_STORE_ADMIN_*`   — a Neo4j user holding real DBMS-admin privileges
 *                              (`CREATE DATABASE`, `CREATE ROLE`, `GRANT`, schema
 *                              constraint/index management). Used ONLY by
 *                              `provisioning/tenant-database-provisioner.ts` — never
 *                              by `withTenantGraph()` or any port method. This is the
 *                              graph-side analogue of `NEXTBOT_DB_OWNER_URL`.
 *  - `GRAPH_STORE_SERVICE_*` — the service user `withTenantGraph()` connects as. It
 *                              holds **no data privileges of its own** — only
 *                              `IMPERSONATE` on the per-tenant users provisioning
 *                              creates (ADR-0018 §2.2). This is the graph-side
 *                              analogue of `NEXTBOT_DB_APP_URL`.
 *
 * `GRAPH_STORE_CREDENTIAL_REF`/`GRAPH_STORE_ADMIN_CREDENTIAL_REF` are named per LLD
 * §14.4.6's env list. For this build they resolve to a literal password value read
 * directly from the process environment — the same convention `NEXTBOT_DB_APP_URL`
 * already uses for the Postgres "app" role's password (embedded directly in the
 * connection-string env var, not routed through `@nextbot/secrets`'s tenant-owned
 * credential vault, which is a distinct concern: tenant-supplied third-party
 * credentials, not the platform's own infra-role credentials). The `_REF` naming
 * is deliberately kept exactly as the LLD wrote it so a future production
 * deployment can swap this env var's value for a real KMS/secret-manager reference
 * without any interface change here.
 *
 * In local/CI test runs (`NEXTBOT_DB_ENV=test`, the same repo-wide flag
 * `@nextbot/db/src/config.ts` already uses) the `*_TEST_*` variables are used
 * instead, pointed at `compose.test.yml`'s ephemeral Neo4j container.
 */
const EnvSchema = Type.Object({
  /** Only "neo4j" is implemented this phase — the in-memory adapter LLD §14.4.6
   *  describes ("packages/testing so every knowledge unit test runs without a
   *  database") has no consumer yet (no ingestion pipeline exists before Phase 7b)
   *  and is deliberately deferred to that phase rather than built with nothing to
   *  exercise it. */
  GRAPH_STORE_PROVIDER: Type.Literal("neo4j"),
  /** Bolt connection URI, e.g. `bolt://localhost:7687` (dev) / `neo4j://` or
   *  `bolt+s://` for a real cluster/TLS deployment (LLD §14.4.6). */
  GRAPH_STORE_URL: Type.String({ minLength: 1 }),
  GRAPH_STORE_SERVICE_USER: Type.String({ minLength: 1 }),
  GRAPH_STORE_CREDENTIAL_REF: Type.String({ minLength: 1 }),
  GRAPH_STORE_ADMIN_USER: Type.String({ minLength: 1 }),
  GRAPH_STORE_ADMIN_CREDENTIAL_REF: Type.String({ minLength: 1 }),
  /** Prefix for a tenant's database name (`<prefix>-<hex(tenantId)>`). Neo4j
   *  database names may contain only ASCII letters/digits/dots/dashes (NOT
   *  underscore) — see `naming.ts`'s doc comment for the real constraint this was
   *  validated against. Defaults to `t` if unset. */
  GRAPH_STORE_DATABASE_PREFIX: Type.String({ minLength: 1 }),
});

export type GraphStoreEnv = Static<typeof EnvSchema>;

let cached: GraphStoreEnv | undefined;

/**
 * Reads and validates the process environment for `@nextbot/graph-store`. Throws
 * synchronously (a startup failure, per LLD §11.10) rather than deferring the
 * problem to the first query.
 */
export function loadGraphStoreEnv(): GraphStoreEnv {
  if (cached) return cached;

  const isTest = process.env.NEXTBOT_DB_ENV === "test";
  const raw = {
    GRAPH_STORE_PROVIDER: process.env.GRAPH_STORE_PROVIDER ?? "neo4j",
    GRAPH_STORE_URL: isTest ? process.env.GRAPH_STORE_TEST_URL : process.env.GRAPH_STORE_URL,
    GRAPH_STORE_SERVICE_USER: isTest
      ? process.env.GRAPH_STORE_SERVICE_USER_TEST
      : process.env.GRAPH_STORE_SERVICE_USER,
    GRAPH_STORE_CREDENTIAL_REF: isTest
      ? process.env.GRAPH_STORE_CREDENTIAL_REF_TEST
      : process.env.GRAPH_STORE_CREDENTIAL_REF,
    GRAPH_STORE_ADMIN_USER: isTest
      ? process.env.GRAPH_STORE_ADMIN_USER_TEST
      : process.env.GRAPH_STORE_ADMIN_USER,
    GRAPH_STORE_ADMIN_CREDENTIAL_REF: isTest
      ? process.env.GRAPH_STORE_ADMIN_CREDENTIAL_REF_TEST
      : process.env.GRAPH_STORE_ADMIN_CREDENTIAL_REF,
    GRAPH_STORE_DATABASE_PREFIX: process.env.GRAPH_STORE_DATABASE_PREFIX ?? "t",
  };

  if (!Value.Check(EnvSchema, raw)) {
    const errors = [...Value.Errors(EnvSchema, raw)].map((e) => `${e.path}: ${e.message}`);
    throw new Error(`@nextbot/graph-store: invalid/missing configuration:\n${errors.join("\n")}`);
  }

  cached = raw;
  return cached;
}

/** Test-only: clears the cached env so a test can re-load with different values. */
export function _resetGraphStoreEnvCacheForTests(): void {
  cached = undefined;
}
