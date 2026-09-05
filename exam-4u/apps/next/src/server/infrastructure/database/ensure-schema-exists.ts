import mysql from 'mysql2/promise';

/** Matches MySQL's own identifier rules closely enough for our purposes (every real schema name is
 * derived from `generateTenantSchemaName`, so this can never legitimately fail — defense-in-depth
 * against ever interpolating an unsanitized value into raw SQL). Ported verbatim from
 * `legacy/api/src/infrastructure/database/ensure-schema-exists.ts`. */
const SAFE_SCHEMA_NAME = /^[A-Za-z0-9_]{1,64}$/;

/**
 * Idempotently ensures a MySQL schema exists, using a short-lived bootstrap connection that
 * specifies no default database (so it can't fail with "unknown database" the way a connection scoped
 * to the target schema would before that schema exists).
 *
 * Used by {@link import('../../platform/provisioning').CreateSchemaStep} (HLD §4.4 step 1) — the
 * `examland` DB user must already hold the `GRANT ... ON \`t\\_%\`.*` privilege
 * `docker/mysql-init/01-grant-tenant-schema-privileges.sql` sets up, or this throws `Access denied`.
 *
 * @throws Whatever the underlying `mysql2` connection/query throws (e.g. access denied, host
 *   unreachable) — never swallowed.
 */
export async function ensureSchemaExists(opts: {
  host: string;
  port: number;
  user: string;
  password?: string;
  schema: string;
}): Promise<void> {
  if (!SAFE_SCHEMA_NAME.test(opts.schema)) {
    throw new Error(`Refusing to create schema with an unexpected name: ${opts.schema}`);
  }
  const connection = await mysql.createConnection({
    host: opts.host,
    port: opts.port,
    user: opts.user,
    password: opts.password,
  });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${opts.schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
  } finally {
    await connection.end();
  }
}
