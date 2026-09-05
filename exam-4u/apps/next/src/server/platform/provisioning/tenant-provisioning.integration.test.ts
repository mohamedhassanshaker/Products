import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { afterAll, describe, expect, it } from 'vitest';
import { getPlatformDataSource } from '@/server/infrastructure/database';
import { getTenantProvisioningService } from './index';

/**
 * Real-MySQL end-to-end proof of the full tenant-provisioning workflow (migration plan exit gate
 * item 5: "provision one real tenant through the actual `TenantProvisioningService`... against real
 * MySQL, and confirm: tenant schema created, migrations applied to it, a subscription row created
 * via `CreateSubscriptionStep` referencing the seeded `starter` package, and the provisioning-step
 * table shows every step completed"). This is the vitest-native counterpart to
 * `scripts/provision-demo-tenant.ts` (that script is the operator-facing convenience; this test is
 * what actually asserts every documented postcondition and contributes to this dispatch's coverage
 * requirement across the whole provisioning/tenants/billing/mail module graph it exercises).
 *
 * Uses a unique subdomain slug per run (`it-<random>`) rather than a fixed one, and cleans up the
 * tenant schema + platform rows it creates in `afterAll` — this is a real MySQL side effect and
 * should not accumulate garbage across repeated test runs the way `provision-demo-tenant.ts`'s fixed
 * `demo-next` slug intentionally does (that script is meant to leave a durable, reusable demo tenant
 * behind; this test is not).
 *
 * Run via the same env vars as `platform-migrations.integration.test.ts` — requires that test's
 * migrations to have already run (or run this one after it; a fresh schema also works since
 * `getPlatformDataSource()` runs against whatever `DB_PLATFORM_SCHEMA` points at, but the *tables*
 * must exist — this test does not run migrations itself):
 *
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     npx vitest run src/server/platform/provisioning/tenant-provisioning.integration.test.ts
 */
describe('TenantProvisioningService (real MySQL, real tenant schema)', () => {
  const slug = `it-${randomUUID().slice(0, 8)}`;
  let createdTenantId: string | undefined;
  let createdSchemaName: string | undefined;

  afterAll(async () => {
    const ds = await getPlatformDataSource();
    if (createdSchemaName) {
      // Drop the throwaway tenant schema directly via a raw connection (mirrors
      // `ensureSchemaExists`'s own "bootstrap connection with no default database" pattern) — the
      // platform DataSource has no tenant-schema DDL privileges scope of its own to reuse here.
      const env = { host: 'localhost', port: 3306, user: 'examland', password: 'examland_dev' };
      const conn = await mysql.createConnection(env);
      try {
        await conn.query(`DROP DATABASE IF EXISTS \`${createdSchemaName}\``);
      } finally {
        await conn.end();
      }
    }
    if (createdTenantId) {
      await ds.query('DELETE FROM tenant_provisioning_step WHERE tenant_id = ?', [createdTenantId]);
      await ds.query('DELETE FROM tenant_subscription WHERE tenant_id = ?', [createdTenantId]);
      await ds.query('DELETE FROM tenant WHERE id = ?', [createdTenantId]);
    }
    await ds.destroy();
  });

  it('provisions a tenant end-to-end: schema created, migrations applied, subscription created, every step Completed', async () => {
    const provisioning = await getTenantProvisioningService();

    const result = await provisioning.provisionNewTenant({
      name: 'Integration Test Tenant',
      subdomainSlug: slug,
      adminEmail: 'admin@integration-test.local',
    });
    createdTenantId = result.id;
    createdSchemaName = result.schemaName;

    expect(result.status).toBe('Active');
    expect(result.schemaName).toMatch(/^t_it_/);

    const ds = await getPlatformDataSource();

    // Every provisioning step recorded Completed, attempts = 1 (first-ever run, no retry needed).
    const steps: { step: string; status: string; attempts: number }[] = await ds.query(
      'SELECT step, status, attempts FROM tenant_provisioning_step WHERE tenant_id = ? ORDER BY step',
      [result.id],
    );
    expect(steps).toHaveLength(6);
    expect(steps.every((s) => s.status === 'Completed')).toBe(true);
    expect(steps.every((s) => Number(s.attempts) === 1)).toBe(true);

    // A subscription row referencing the seeded 'starter' package.
    const [subscription]: { status: string; key: string }[] = await ds.query(
      `SELECT ts.status AS status, p.\`key\` AS \`key\`
       FROM tenant_subscription ts JOIN \`package\` p ON p.id = ts.package_id
       WHERE ts.tenant_id = ?`,
      [result.id],
    );
    expect(subscription).toEqual({ status: 'ACTIVE', key: 'starter' });

    // The tenant schema itself: created, migrated (RBAC tables present), admin user seeded with no
    // password, Tenant Admin role granted.
    const tenantConn = await mysql.createConnection({
      host: 'localhost',
      port: 3306,
      user: 'examland',
      password: 'examland_dev',
      database: result.schemaName,
    });
    try {
      const [migrationRows] = (await tenantConn.query('SELECT name FROM migrations')) as unknown as [{ name: string }[]];
      expect(migrationRows.map((m) => m.name)).toContain('CreateRbacTables20260815000001');

      const [userRows] = (await tenantConn.query(
        'SELECT email, password_hash FROM `user` WHERE email = ?',
        ['admin@integration-test.local'],
      )) as unknown as [{ email: string; password_hash: string | null }[]];
      expect(userRows).toHaveLength(1);
      expect(userRows[0].password_hash).toBeNull();

      const [roleGrantRows] = (await tenantConn.query(
        `SELECT r.name FROM user_role ur JOIN role r ON r.id = ur.role_id
         JOIN \`user\` u ON u.id = ur.user_id WHERE u.email = ?`,
        ['admin@integration-test.local'],
      )) as unknown as [{ name: string }[]];
      expect(roleGrantRows.map((r) => r.name)).toContain('Tenant Admin');
    } finally {
      await tenantConn.end();
    }
  }, 30_000);
  // Timeout raised from vitest's 5000ms default (found while adding this Phase 1 "exception closure"
  // dispatch's own four new integration test files — see `docs/plans/nextjs-rewrite-phase1-plan.md`'s
  // "Phase 1 exception closure" section): this test passes comfortably in isolation (~1.3s) but the
  // real schema-create + 7-migration-apply + RBAC-seed workflow it drives against a real, shared
  // MySQL instance intermittently exceeded 5s once run alongside the full suite's other ~50
  // concurrent real-MySQL test files, especially under `--coverage`'s instrumentation overhead — a
  // pre-existing test-robustness gap (every sibling integration test in this app already sets an
  // explicit, more generous timeout; this file was the one exception), not a defect in the
  // provisioning workflow itself.

  it('retry() on an already-Active tenant is rejected with INVALID_TENANT_STATE', async () => {
    const provisioning = await getTenantProvisioningService();
    await expect(provisioning.retry(createdTenantId as string)).rejects.toMatchObject({ code: 'INVALID_TENANT_STATE' });
  });
});
