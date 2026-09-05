import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

/**
 * Minimal, dependency-free SQL migration runner. Applies every `*.sql` file in
 * `migrationsDir`, in filename-sorted order, exactly once, tracked in a
 * `_migrations_applied` bookkeeping table. Each file runs inside its own transaction.
 *
 * Chosen over `drizzle-orm`'s built-in migrator because that migrator expects
 * drizzle-kit's own generated-migration + journal format, which cannot express the
 * `ENABLE`/`FORCE ROW LEVEL SECURITY` + policy statements this schema requires in the
 * same migration as table creation (LLD §3.2 rule 1) — see `migrations/README.md`.
 */
export async function runSqlMigrations(ownerPool: Pool, migrationsDir: string): Promise<string[]> {
  const client = await ownerPool.connect();
  const applied: string[] = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations_applied (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));

    for (const file of files) {
      const { rows } = await client.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM _migrations_applied WHERE filename = $1) AS exists",
        [file],
      );
      if (rows[0]?.exists) continue;

      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations_applied (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration '${file}' failed: ${(err as Error).message}`, { cause: err });
      }
    }
  } finally {
    client.release();
  }
  return applied;
}
