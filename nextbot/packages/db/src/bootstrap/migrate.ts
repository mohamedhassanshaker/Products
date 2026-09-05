import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadDbEnv } from "../config.js";
import { getOwnerPool } from "../pool.js";
import { ensureRoles } from "./ensure-roles.js";
import { runSqlMigrations } from "./run-sql-migrations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Migration entry point (`pnpm db:migrate` / `pnpm --filter @nextbot/db run migrate`,
 * or `run migrate:test` for the compose.test.yml stack). Runs as the schema-owner
 * role: applies every `.sql` file under `migrations/` in order, then idempotently
 * ensures the app/platform roles exist and are granted.
 */
async function main(): Promise<void> {
  const env = loadDbEnv();
  const ownerPool = getOwnerPool();

  const applied = await runSqlMigrations(ownerPool, path.join(__dirname, "..", "..", "migrations"));
  await ensureRoles(ownerPool, {
    appUrl: env.NEXTBOT_DB_APP_URL,
    platformUrl: env.NEXTBOT_DB_PLATFORM_URL,
    gatewayUrl: env.NEXTBOT_DB_GATEWAY_URL,
  });

  await ownerPool.end();
  console.log(`@nextbot/db: applied ${applied.length} migration(s), roles ensured.`, applied);
}

main().catch((err) => {
  console.error("@nextbot/db: migration failed:", err);
  process.exitCode = 1;
});
