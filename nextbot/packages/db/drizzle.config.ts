import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config. `generate` produces plain-column migrations from the schema;
 * RLS (`ENABLE/FORCE ROW LEVEL SECURITY` + policy) and role/grant statements are NOT
 * expressible in the Drizzle schema DSL, so they live in hand-authored SQL files in
 * `migrations/` alongside the generated ones (see `migrations/0001_rls_tenancy.sql`).
 * `pnpm test:isolation` asserts every tenant-scoped table has RLS+FORCE+policy by
 * querying `information_schema`/`pg_policies` directly, independent of how the
 * migration got there.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.NEXTBOT_DB_OWNER_URL ?? "postgres://nextbot:nextbot_dev_password@localhost:5432/nextbot",
  },
  verbose: true,
  strict: true,
});
