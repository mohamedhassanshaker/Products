/**
 * Locates `prisma/sql/` and `prisma/migrations/` — the repo-root Prisma artefacts
 * `SqlStoreProvisioner` and `PrismaMigrationExecutor` both replay DDL from — without
 * depending on `process.cwd()`.
 *
 * ## The bug this replaces
 *
 * Both adapters used to default to `resolve(process.cwd(), "prisma", "sql"/"migrations")`.
 * That is only correct when the process's cwd happens to be the repo root — true for
 * every `scripts/*.ts` entry point (`pnpm exec tsx scripts/...` is always run from the
 * repo root), which is the only way either adapter had ever been exercised before the
 * platform-admin console shipped the first UI-driven provisioning path. `next dev`/`next
 * start` (`apps/web/package.json`'s own `dev`/`start` scripts) run with cwd `apps/web` —
 * a pnpm workspace package, not the repo root — so the same default silently resolved to
 * `apps/web/prisma/sql`, which does not exist. Found for real: `ProvisionTenant` failing
 * every tenant creation attempted from `/tenants` with `ENOENT: ... apps/web/prisma/sql/
 * 000_tenant_schema.sql`, not by reasoning about `next dev`'s cwd from documentation.
 *
 * ## Why `fileURLToPath(import.meta.url)`, not `import.meta.dirname`
 *
 * Both adapters are imported by a `"use server"` Server Action file, so — exactly like
 * `local-brand-asset-storage.ts`'s own `BRAND_ASSET_BASE_DIR` (see that module's doc
 * comment for the two webpack gotchas found the same way, by an actual `next dev` run,
 * not assumed) — they are bundled into the RSC server build, not loaded as plain Node
 * ESM the way `next.config.ts` is. This file follows that same precedent exactly: derive
 * the directory from the un-wrapped `import.meta.url` string via `fileURLToPath`, never
 * `import.meta.dirname` (unpopulated for a bundled module under this webpack version)
 * and never `new URL(".", import.meta.url)` (webpack statically intercepts that literal
 * syntactic pattern as an asset reference and fails to resolve it as a module).
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The repo root — eight levels up from this file's own directory
 * (`apps/web/src/modules/platform/adapters/outbound/sql/`: sql -> outbound ->
 * adapters -> platform -> modules -> src -> web -> apps -> repo root).
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../../../..");

export const PRISMA_SQL_DIR = resolve(REPO_ROOT, "prisma", "sql");
export const PRISMA_MIGRATIONS_DIR = resolve(REPO_ROOT, "prisma", "migrations");
