/**
 * One-shot platform-schema bootstrap for a FRESH SQL Server instance.
 *
 *   pnpm exec tsx scripts/bootstrap-platform-schema.ts
 *
 * (also wired as `pnpm db:bootstrap-platform`.) Docker Compose's `init` service runs this
 * before `db:seed:iam`/`db:seed:appearance`, once, after `sqlserver` and `ai` report
 * healthy.
 *
 * ## The gap this closes
 *
 * Investigated directly before writing this (not assumed): NOTHING in this codebase, prior
 * to this script, ever creates the `shj3` database, the `platform` schema, or populates
 * `tenant_template`'s own tables from an empty SQL Server instance. Every real, tested path
 * — `SqlStoreProvisioner.create()`, `PrismaMigrationExecutor.applyToPlatform()`/
 * `applyToTenant()`, and `tests/isolation/setup.ts` (which provisions `sewa`/`customs`
 * against real containers every isolation run) — assumes all three already exist:
 * `SqlStoreProvisioner.create()` throws outright ("run the platform migration first, then
 * provision") if `tenant_template` holds zero tables, and a `getPlatformDb()`/
 * `getTenantDb()` connection cannot even be OPENED before the `shj3` database exists at all.
 * `package.json`'s `db:migrate` script (`scripts/migrate-tenants.mjs`) has never existed on
 * disk — confirmed by search — so there was no checked-in mechanism to reach for. This
 * script is that mechanism, scoped as narrowly as the gap actually is.
 *
 * ## What this does NOT do
 *
 * It does not provision any tenant. `scripts/seed-iam-demo-data.ts` already does that (its
 * own `ensureTenantProvisioned()`, calling the real `ProvisionTenant` use case for `sewa`/
 * `customs`/`libraries`/`sharjah`) — this script's only job is making that possible at all,
 * by getting `platform`/`tenant_template` into the state every tenant-provisioning path
 * already assumes. Composition root, not application code, for the same reason
 * `seed-system-skins.ts`'s own doc comment gives: constructing concrete adapters directly is
 * something `application/` code may never do (the swap test, architecture.md §4).
 *
 * ## Does NOT use `PrismaMigrationExecutor.applyToPlatform()` — a real bug found, not routed
 * around silently
 *
 * The obvious design reused that already-tested executor. It fails against a genuinely fresh
 * database: `20260908130800_init/migration.sql` contains ADR-0011's five cross-schema
 * foreign keys, and `migration-executor.ts`'s `platformStatements()` deliberately matches
 * those too (its own doc comment says so). Splitting "all of platform" and "all of
 * tenant_template" into two independently-ordered passes breaks the moment such a statement
 * exists — confirmed directly, not theorised: running `applyToPlatform()` before
 * `tenant_template.RolePermissions` existed failed with real SQL Server error 4902, "Cannot
 * find the object". Full account in `sql-script.ts`'s `platformAndTemplateStatements()` doc
 * comment, including why this is not a defect in `platformStatements()` for the path it is
 * actually tested against (`RunTenantMigrations`'s incremental per-tenant migrations, where
 * both schemas already exist) — flagged there and in `tasks/todo.md` rather than fixed inside
 * that shared, tested production code, which this Docker-packaging pass has no reason to
 * widen the blast radius of.
 *
 * The fix used here instead: `platformAndTemplateStatements()` replays each migration's
 * schema-touching statements in the migration's OWN original order (one function, one pass,
 * per migration) rather than two independently-ordered passes — safe because Prisma's own
 * generation order already puts every `CREATE TABLE`/`CREATE INDEX` (both schemas) before
 * every `ALTER TABLE ... ADD CONSTRAINT` (both schemas), confirmed by reading the real file.
 *
 * ## The three real steps
 *
 * 1. **`shj3` database.** `getPlatformDb()`'s connection string names `database=shj3`
 *    (`tenant-db.ts`) — that database must exist before ANY Prisma client pointed at it can
 *    even open a connection, so this step alone needs a client pointed at `master` instead,
 *    used only for this one statement and disconnected immediately after.
 * 2. **`platform`/`tenant_template` schemas and tables, per migration, in order**, via
 *    `platformAndTemplateStatements()`.
 * 3. **`001_constraints.sql`'s platform section**, via `platformSection()` — the complement
 *    of the `tenantSection()` every tenant-scoped caller already uses. The file's own header
 *    has always described two sections; this is what makes the first one reachable.
 *
 * ## Idempotency
 *
 * `ensureDatabaseExists()` and `001_constraints.sql`'s platform section (via
 * `platformSection()`) are guarded at the SQL level (`IF NOT EXISTS`, or — for the
 * constraints file — the same idempotent-by-construction checks RISK-025 already proved
 * out for the tenant section) and safe to re-run unconditionally.
 *
 * The migration replay (`applyMigration()`) is NOT: Prisma's raw DDL carries no such guards
 * (confirmed directly, not assumed — re-running it against an already-bootstrapped database
 * fails with "There is already an object named ..."). `platformAlreadyBootstrapped()` is the
 * guard that makes the SCRIPT AS A WHOLE safe to re-run regardless: a table count against
 * `platform`, mirroring `SqlStoreProvisioner.create()`'s own established pattern for the
 * identical problem — see that function's own doc comment for why "skip the whole replay
 * once the schema plainly already exists" is the correct level, rather than trying to make
 * every individual Prisma-generated statement independently idempotent.
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PrismaClient as PlatformPrismaClient } from "../prisma/generated/platform-client/index.js";
import { listMigrationNames } from "../apps/web/src/modules/platform/adapters/outbound/sql/migration-executor.js";
import {
  disconnectAllTenantDbs,
  getPlatformDb,
} from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import {
  platformAndTemplateStatements,
  platformSection,
  splitBatches,
} from "../apps/web/src/modules/platform/adapters/outbound/sql/sql-script.js";
import { runWithTenant } from "../apps/web/src/modules/platform/tenancy/tenant-context.js";
import { assertValidSlugShape } from "../apps/web/src/modules/platform/tenancy/tenant-slug.js";

const CONSTRAINTS_SCRIPT_PATH = resolve(process.cwd(), "prisma", "sql", "001_constraints.sql");
const MIGRATIONS_DIR = resolve(process.cwd(), "prisma", "migrations");
const MIGRATION_FILE = "migration.sql";

/** Replace (or insert) a connection string's `database=` parameter, mirroring
 *  `tenant-db.ts`'s private `urlForSchema()` for the one parameter that function
 *  does not touch — needed here, and nowhere else, because this is the only place
 *  in the codebase that must connect BEFORE `shj3` exists. */
function urlForDatabase(url: string, database: string): string {
  const withoutDatabase = url
    .split(";")
    .filter((part) => !/^database=/i.test(part.trim()))
    .join(";");
  const separator = withoutDatabase.endsWith(";") ? "" : ";";
  return `${withoutDatabase}${separator}database=${database}`;
}

/** Step 1: the `shj3` database itself, via a throwaway client pointed at `master`. */
async function ensureDatabaseExists(): Promise<void> {
  const baseUrl = process.env.SHJ3_SQL_URL;
  if (!baseUrl) {
    throw new Error("SHJ3_SQL_URL is not set — cannot bootstrap the platform schema without it.");
  }

  const master = new PlatformPrismaClient({
    datasources: { db: { url: urlForDatabase(baseUrl, "master") } },
  });
  try {
    // CREATE DATABASE must be the sole statement in its batch — sp_executesql's nested
    // batch is the same idiom Prisma's own migration.sql uses for CREATE SCHEMA below.
    await master.$executeRawUnsafe(
      "IF DB_ID(N'shj3') IS NULL EXEC sp_executesql N'CREATE DATABASE [shj3];';",
    );
  } finally {
    await master.$disconnect();
  }
}

async function readMigrationSql(name: string): Promise<string> {
  return readFile(join(MIGRATIONS_DIR, name, MIGRATION_FILE), "utf8");
}

/**
 * Whether `platform` already holds tables — the guard that makes re-running this script
 * against an already-bootstrapped database safe.
 *
 * Prisma's raw migration DDL carries no `IF NOT EXISTS` guards (`sql-store-provisioner.ts`'s
 * own module comment: "Prisma's emitted DDL carries no existence guards"), so a second,
 * unconditional replay of `applyMigration()` would fail outright ("There is already an
 * object named ...") the moment the environment is not genuinely empty — found directly, not
 * theorised: hit exactly this re-running the throwaway isolated test project used to verify
 * this script, after an earlier attempt had partially succeeded.
 *
 * Mirrors `SqlStoreProvisioner.create()`'s own established pattern for the identical
 * problem, one level up (table count, not per-statement guards) rather than inventing a
 * different idempotency mechanism: that class's own doc comment states the house
 * philosophy plainly — "Refusing is the honest answer; guessing is how one entity ends up
 * on a different schema version from the rest." Applied here as "skip the whole replay" —
 * a coarser grain than `SqlStoreProvisioner`'s three-way (empty / fully-populated /
 * partially-populated) verdict, since a partially-bootstrapped `platform` schema after a
 * genuine mid-migration crash is an operator-recovery scenario (RB-07/RB-10, the same one
 * `SqlStoreProvisioner.create()` itself defers to), not something a Compose init step
 * should silently guess its way through either.
 */
async function platformAlreadyBootstrapped(): Promise<boolean> {
  const db = getPlatformDb("platform-schema bootstrap");
  const rows = (await db.$queryRawUnsafe(
    "SELECT COUNT(*) AS value FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'platform'",
  )) as { value: number | bigint }[];
  return Number(rows[0]?.value ?? 0) > 0;
}

/** Step 2: one migration's platform + tenant_template schemas and tables, in the
 *  migration's own original statement order — see `platformAndTemplateStatements()`'s
 *  own doc comment for why order (not "which schema first") is what matters here. */
async function applyMigration(migrationSql: string): Promise<void> {
  const db = getPlatformDb("platform-schema bootstrap");
  for (const statement of platformAndTemplateStatements(migrationSql)) {
    await db.$executeRawUnsafe(statement);
  }
}

/** Step 3: `001_constraints.sql`'s platform section — see `platformSection()`'s doc
 *  comment for why nothing ever called this half before this script. */
async function applyPlatformConstraints(): Promise<void> {
  const db = getPlatformDb("platform-schema bootstrap");
  const source = await readFile(CONSTRAINTS_SCRIPT_PATH, "utf8");
  for (const batch of splitBatches(platformSection(source))) {
    await db.$executeRawUnsafe(batch);
  }
}

async function main(): Promise<void> {
  console.info("[bootstrap-platform-schema] ensuring the shj3 database exists...");
  await ensureDatabaseExists();

  await runWithTenant(
    {
      // Arbitrary and harmless, never read for *which* schema this touches — every call
      // below is platform-scoped, not tenant-scoped. Mirrors tests/isolation/setup.ts's
      // and seed-iam-demo-data.ts's identical `runAsProvisioning`/`runAsBootstrap` reasoning.
      tenant: assertValidSlugShape("sewa"),
      principal: null,
      traceId: "bootstrap-platform-schema",
      platformScope: "provisioning",
    },
    async () => {
      if (await platformAlreadyBootstrapped()) {
        console.info(
          "[bootstrap-platform-schema] platform already has tables — skipping migration " +
            "replay (idempotent no-op); re-applying 001_constraints.sql's platform section " +
            "only, since that half IS guarded and safe to repeat.",
        );
      } else {
        const migrationNames = await listMigrationNames(MIGRATIONS_DIR);
        if (migrationNames.length === 0) {
          throw new Error(`No migrations found under "${MIGRATIONS_DIR}".`);
        }

        for (const name of migrationNames) {
          console.info(`[bootstrap-platform-schema] ${name}: platform + tenant_template...`);
          const migrationSql = await readMigrationSql(name);
          await applyMigration(migrationSql);
        }
      }

      console.info("[bootstrap-platform-schema] 001_constraints.sql platform section...");
      await applyPlatformConstraints();
    },
  );

  await disconnectAllTenantDbs();
  console.info("[bootstrap-platform-schema] done — platform and tenant_template are ready.");
}

main().catch((error: unknown) => {
  console.error("[bootstrap-platform-schema] failed:", error);
  process.exitCode = 1;
});
