import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEnv } from '@/server/config';
import { getPlatformDataSource } from '@/server/infrastructure/database';
import { getTenantProvisioningService } from '@/server/platform/provisioning';
import { findResolvableTenantBySlugRaw } from './raw-tenant-lookup';

/**
 * Real-MySQL proof of {@link findResolvableTenantBySlugRaw} — the **actual** production code path
 * `middleware.ts` uses (via `resolveTenantForRequest`), deliberately entity-free (see this function's
 * own doc comment for the cross-webpack-bundle bug this exists to avoid — found and fixed during this
 * dispatch's own real-HTTP exit-gate verification, not merely assumed safe from the pattern).
 *
 * Run via the same env vars as this module's sibling integration tests.
 */
describe('findResolvableTenantBySlugRaw (real MySQL, no TypeORM entities)', () => {
  const slug = `it-rawlookup-${randomUUID().slice(0, 8)}`;
  let tenantId: string;
  let tenantSchema: string;

  beforeAll(async () => {
    const provisioning = await getTenantProvisioningService();
    const tenant = await provisioning.provisionNewTenant({
      name: 'Raw Lookup Integration Tenant',
      subdomainSlug: slug,
      adminEmail: `admin@${slug}.local`,
    });
    tenantId = tenant.id;
    tenantSchema = tenant.schemaName;
  });

  afterAll(async () => {
    const platformDs = await getPlatformDataSource();
    const env = { host: 'localhost', port: 3306, user: 'examland', password: 'examland_dev' };
    const conn = await mysql.createConnection(env);
    try {
      await conn.query(`DROP DATABASE IF EXISTS \`${tenantSchema}\``);
    } finally {
      await conn.end();
    }
    await platformDs.query('DELETE FROM tenant_provisioning_step WHERE tenant_id = ?', [tenantId]);
    await platformDs.query('DELETE FROM tenant_subscription WHERE tenant_id = ?', [tenantId]);
    await platformDs.query('DELETE FROM tenant WHERE id = ?', [tenantId]);
    await platformDs.destroy();
  });

  it('resolves a real, freshly-provisioned tenant by slug using only raw SQL', async () => {
    const resolved = await findResolvableTenantBySlugRaw(slug, getEnv());
    expect(resolved).toEqual({ id: tenantId, subdomainSlug: slug, schemaName: tenantSchema, status: 'Active' });
  });

  it('returns null for a nonexistent slug', async () => {
    await expect(findResolvableTenantBySlugRaw('no-such-slug-at-all', getEnv())).resolves.toBeNull();
  });

  it('returns null for a soft-deleted tenant (deleted_at IS NOT NULL)', async () => {
    const platformDs = await getPlatformDataSource();
    await platformDs.query('UPDATE tenant SET deleted_at = NOW(3) WHERE id = ?', [tenantId]);
    try {
      await expect(findResolvableTenantBySlugRaw(slug, getEnv())).resolves.toBeNull();
    } finally {
      await platformDs.query('UPDATE tenant SET deleted_at = NULL WHERE id = ?', [tenantId]);
    }
  });
});
