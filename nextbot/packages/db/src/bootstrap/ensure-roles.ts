import type { Pool } from "pg";

interface RoleSpec {
  name: string;
  password: string;
  bypassRls: boolean;
}

/** Parses a Postgres connection string into the role name/password it authenticates as. */
function roleFromUrl(url: string): { name: string; password: string } {
  const parsed = new URL(url);
  return { name: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password) };
}

/**
 * Idempotently creates the two non-owner Postgres roles ADR-0001's isolation model
 * depends on, and grants them table-level access (RLS/FORCE RLS policies control the
 * *row* visibility from there; without CONNECT/USAGE/SELECT grants the roles could not
 * reach the tables at all).
 *
 *  - "app" role: ordinary grants, no BYPASSRLS. Used by `withTenant`.
 *  - "platform" role: same grants PLUS `BYPASSRLS`. Used by `withPlatform`.
 *
 * Must be run with a connection authenticated as the schema **owner** (the role that
 * created the tables), since only the owner/superuser can `ALTER DEFAULT PRIVILEGES`
 * and `CREATE ROLE`.
 *
 * **Gotcha (why every real call site must always pass `gatewayUrl`):** the per-role
 * loop's blanket `GRANT SELECT ... ON ALL TABLES` re-grants table-wide `SELECT` on
 * `credential` to the "app" role on every call, unconditionally — and the
 * column-restriction step that narrows it back down only runs when `gatewayUrl` is
 * supplied. Omitting `gatewayUrl` on a call made after `credential` already exists
 * therefore silently reintroduces the exact vulnerability the restriction exists to
 * prevent. `migrate.ts` always passes all three URLs; test call sites that invoke
 * `ensureRoles()` directly must do the same (see the regression test in
 * `bootstrap.int.test.ts` proving this exact break/repair cycle).
 */
export async function ensureRoles(
  ownerPool: Pool,
  opts: { appUrl: string; platformUrl: string; gatewayUrl?: string },
): Promise<void> {
  const app = roleFromUrl(opts.appUrl);
  const platform = roleFromUrl(opts.platformUrl);
  const gateway = opts.gatewayUrl ? roleFromUrl(opts.gatewayUrl) : undefined;

  const specs: RoleSpec[] = [
    { name: app.name, password: app.password, bypassRls: false },
    { name: platform.name, password: platform.password, bypassRls: true },
    // Phase 4 (BL-02): a fourth, non-BYPASSRLS role for apps/gateway. Same RLS
    // exposure as "app" — the extra privilege it needs (SELECT on
    // `credential.ciphertext`) is granted narrowly below, not via BYPASSRLS.
    ...(gateway ? [{ name: gateway.name, password: gateway.password, bypassRls: false }] : []),
  ];

  const client = await ownerPool.connect();
  try {
    for (const spec of specs) {
      const { rows } = await client.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists",
        [spec.name],
      );
      // Role names/bypassRls come from server-side config, not user input, but
      // Postgres DDL cannot parameterize identifiers regardless — quote_ident via
      // a tightly-scoped allowlisted character set as defense in depth. Validated
      // unconditionally (not just in the create branch) since it also guards the
      // ALTER ROLE reconciliation below.
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(spec.name)) {
        throw new Error(`ensureRoles: refusing unsafe role name ${JSON.stringify(spec.name)}`);
      }

      if (!rows[0]?.exists) {
        // Postgres DDL statements (CREATE ROLE included) cannot take bind parameters
        // at all -- there is no server-side prepared-statement path for DDL. The
        // password is therefore escaped client-side via `pg`'s own literal-escaping
        // (equivalent to `quote_literal`) rather than string-interpolated raw.
        const escapedPassword = client.escapeLiteral(spec.password);
        await client.query(
          `CREATE ROLE "${spec.name}" LOGIN PASSWORD ${escapedPassword} NOSUPERUSER NOCREATEDB NOCREATEROLE ${
            spec.bypassRls ? "BYPASSRLS" : "NOBYPASSRLS"
          }`,
        );
      }

      // QA Defect 1 fix: BYPASSRLS/NOBYPASSRLS must be reconciled on *every* run,
      // not only at first CREATE ROLE. ADR-0001's entire isolation model rests on
      // the "app" role never holding BYPASSRLS; if that attribute drifted after
      // creation (e.g. an operator ran `ALTER ROLE ... BYPASSRLS` directly, or a
      // future migration/tooling change flipped it), a bootstrap run that only
      // grants privileges would silently leave the drifted, isolation-breaking
      // attribute in place. Running this unconditionally makes every `migrate`/
      // `migrate:test` invocation self-healing against that drift.
      await client.query(
        `ALTER ROLE "${spec.name}" ${spec.bypassRls ? "BYPASSRLS" : "NOBYPASSRLS"}`,
      );

      await client.query(`GRANT USAGE ON SCHEMA public TO "${spec.name}"`);
      await client.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${spec.name}"`,
      );
      await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${spec.name}"`);
      // Ensures tables created by a *future* migration are automatically granted too,
      // so a phase that adds a table never has to remember to re-run this bootstrap.
      await client.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${spec.name}"`,
      );
    }

    // Phase 4 (BL-02, FR-SEC-02): restrict `credential.ciphertext`/`dek_ref` so only
    // the gateway role can ever SELECT them — the blanket `GRANT SELECT ON ALL
    // TABLES` above gives every role (incl. "app" AND "platform") table-wide SELECT,
    // which in Postgres's privilege model overrides any column-level REVOKE (a
    // table-wide grant lets a role `SELECT *` regardless of a narrower column
    // revoke). The only way to actually restrict a column is to *not* hold
    // table-wide SELECT on that table at all for the restricted role, then grant a
    // column list explicitly.
    // Runs only once `credential` exists (Phase 4's own migration), so Phase 0-3
    // bootstrap runs are unaffected.
    //
    // QA Defect B1 fix: the original version of this block only ever narrowed the
    // "app" role's grant — "platform" (BYPASSRLS) kept the blanket per-role-loop
    // grant above and could therefore `SELECT ciphertext, dek_ref FROM credential`
    // directly, with BYPASSRLS meaning even tenant scoping didn't apply. Decryption
    // only ever happens gateway-side (LLD §3.5); "platform" has no legitimate reason
    // to read either secret column, so it is restricted the same way "app" is —
    // granted only the non-secret column list, never ciphertext/dek_ref.
    //
    // Deliberately NOT restricted to *zero* columns (an earlier version of this fix
    // tried that): "platform" is also the role tenant deprovisioning runs as
    // (`withPlatform`, `deleteFixtureTenant`'s production analogue), which issues
    // `DELETE FROM credential WHERE tenant_id = $1` across every tenant-scoped
    // table — and Postgres requires SELECT on any column referenced in a DELETE's
    // WHERE clause, not just the DELETE privilege itself. Zero column access broke
    // that real, legitimate administrative path (caught by re-running the full
    // integration suite after the first attempt at this fix, not merely assumed
    // fine). The non-secret column list covers both needs at once.
    const { rows: credentialExists } = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.credential') IS NOT NULL AS exists",
    );
    if (credentialExists[0]?.exists && gateway) {
      const nonSecretColumns =
        "id, tenant_id, label, type, vault_ref, masked_hint, last_rotated_at, expires_at, revoked_at";
      await client.query(`REVOKE SELECT ON credential FROM "${app.name}"`);
      await client.query(`GRANT SELECT (${nonSecretColumns}) ON credential TO "${app.name}"`);
      await client.query(`REVOKE SELECT ON credential FROM "${platform.name}"`);
      await client.query(`GRANT SELECT (${nonSecretColumns}) ON credential TO "${platform.name}"`);
      await client.query(`GRANT SELECT ON credential TO "${gateway.name}"`);
    }

    // Phase 17 (BL-10, FR-ADM-03/NFR-5): `audit_log_entry` must be genuinely
    // append-only — an app or platform role that could UPDATE/DELETE a row would
    // defeat the entire audit guarantee (a compromised app process could cover its
    // tracks). The per-role loop above unconditionally re-grants UPDATE/DELETE on
    // *every* table (including this one) on every bootstrap run, so — exactly like
    // the `credential` column restriction above — the narrowing REVOKE must be
    // re-applied here, after the loop, on every run, not just once at table
    // creation. `INSERT`/`SELECT` remain granted (writers still append rows and the
    // Audit Log Viewer still reads them); only `UPDATE`/`DELETE` are revoked.
    const { rows: auditTableExists } = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.audit_log_entry') IS NOT NULL AS exists",
    );
    if (auditTableExists[0]?.exists) {
      await client.query(`REVOKE UPDATE, DELETE ON audit_log_entry FROM "${app.name}"`);
      await client.query(`REVOKE UPDATE, DELETE ON audit_log_entry FROM "${platform.name}"`);
      if (gateway) {
        await client.query(`REVOKE UPDATE, DELETE ON audit_log_entry FROM "${gateway.name}"`);
      }
    }

    // Platform Manager console Phase 1 (NFR-11): `platform_audit_log_entry` needs the
    // exact same append-only hardening as `audit_log_entry` above, re-applied on every
    // bootstrap run for the identical reason (the per-role loop's blanket
    // `GRANT ... UPDATE, DELETE ON ALL TABLES` re-grants both on every run). Only
    // "app"/"platform" are revoked here (this table has no gateway-role writer at
    // all — apps/gateway never touches it).
    const { rows: platformAuditTableExists } = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.platform_audit_log_entry') IS NOT NULL AS exists",
    );
    if (platformAuditTableExists[0]?.exists) {
      await client.query(`REVOKE UPDATE, DELETE ON platform_audit_log_entry FROM "${app.name}"`);
      await client.query(`REVOKE UPDATE, DELETE ON platform_audit_log_entry FROM "${platform.name}"`);
    }
  } finally {
    client.release();
  }
}
