import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEnv } from '@/server/config';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { BcryptPasswordHasherAdapter, JwtPlatformTokenAdapter } from '@/server/infrastructure/security';
import { PlatformAdminRepository } from '@/server/platform/auth';
import { GET as tenantsListGET, POST as tenantsCreatePOST } from '@/app/api/platform/tenants/route';
import { GET as tenantGetGET } from '@/app/api/platform/tenants/[id]/route';
import { POST as tenantSuspendPOST } from '@/app/api/platform/tenants/[id]/suspend/route';
import { POST as tenantActivatePOST } from '@/app/api/platform/tenants/[id]/activate/route';
import { POST as tenantSoftDeletePOST } from '@/app/api/platform/tenants/[id]/soft-delete/route';
import { POST as tenantRetryPOST } from '@/app/api/platform/tenants/[id]/provisioning/retry/route';
import { PATCH as tenantRegistrationSettingsPATCH } from '@/app/api/platform/tenants/[id]/registration-settings/route';

/**
 * Phase 2 sub-slice "2a" (platform console + tenants CRUD UI) — real-route-level regression coverage
 * for this dispatch's new `app/api/platform/tenants/**` Route Handlers, matching the exact convention
 * `phase1-exception-users-admin.integration.test.ts`/`phase1-exception-profile.integration.test.ts`
 * established: call the REAL exported Route Handler functions with a genuine `NextRequest`, not the
 * service layer directly, so the real `withPlatformAuth` -> service call chain each route wires
 * together is actually proven (the same "a unit test calling the service directly structurally cannot
 * catch a routing/wiring mistake" rationale those files document).
 *
 * Also serves as the permanent regression test for this dispatch's own ESLint module-boundary fix
 * (`.eslintrc.cjs`'s `PLATFORM_TENANTS_BARREL_ONLY`, narrowed from a bare `**\/platform/tenants/**` to
 * `**\/server/platform/tenants/**`) — every import above of an `@/app/api/platform/tenants/**` route
 * file would have been rejected by the pre-fix pattern.
 *
 * Run via:
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     npx vitest run src/server/phase2-platform-tenants-routes.integration.test.ts
 */
describe('Phase 2 (2a) — /api/platform/tenants/** real routes (real MySQL, real JWT)', () => {
  const slugPrefix = `p2t-${randomUUID().slice(0, 8)}`;
  let adminToken: string;
  let platformAdminId: string;
  const createdTenantIds: string[] = [];
  const createdTenantSchemas: string[] = [];

  beforeAll(async () => {
    const env = getEnv();
    const platformDs = await getPlatformDataSource();
    const admins = new PlatformAdminRepository(platformDs);
    const hasher = new BcryptPasswordHasherAdapter(4); // low cost factor — this suite's own speed concern only.
    const passwordHash = await hasher.hash('Real-Admin-Pass-1');
    const inserted = await admins.insert({
      id: randomUUID(),
      email: `${slugPrefix}-admin@integration-test.local`,
      passwordHash,
      name: 'Phase2 Test Admin',
      isActive: true,
      lastLoginAt: null,
    });
    platformAdminId = inserted.id;

    const tokens = new JwtPlatformTokenAdapter(env.JWT_PLATFORM_SECRET, env.JWT_PLATFORM_TTL);
    adminToken = (await tokens.issue({ adminId: platformAdminId })).token;
  }, 60_000);

  afterAll(async () => {
    const platformDs = await getPlatformDataSource();
    for (const schema of createdTenantSchemas) {
      const conn = await mysql.createConnection({ host: 'localhost', port: 3306, user: 'examland', password: 'examland_dev' });
      try {
        await conn.query(`DROP DATABASE IF EXISTS \`${schema}\``);
      } finally {
        await conn.end();
      }
    }
    for (const id of createdTenantIds) {
      await platformDs.query('DELETE FROM tenant_provisioning_step WHERE tenant_id = ?', [id]);
      await platformDs.query('DELETE FROM tenant_subscription WHERE tenant_id = ?', [id]);
      await platformDs.query('DELETE FROM tenant WHERE id = ?', [id]);
    }
    if (platformAdminId) {
      await platformDs.query('DELETE FROM platform_admin WHERE id = ?', [platformAdminId]);
    }
    await getTenantDataSourceRegistry().destroyAll();
    await platformDs.destroy();
  });

  function plainRequest(url: string, method: string, token?: string): NextRequest {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    return new NextRequest(url, { method, headers });
  }

  function jsonRequest(url: string, method: string, body: unknown, token?: string): NextRequest {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    return new NextRequest(url, { method, headers, body: JSON.stringify(body) });
  }

  it('rejects an unauthenticated request 401 UNAUTHENTICATED before any tenant logic runs', async () => {
    const res = await tenantsListGET(plainRequest('http://localhost/api/platform/tenants', 'GET'));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
  });

  it('creates a tenant via the real provisioning workflow (POST), lists it, and fetches its detail', async () => {
    const slug = `${slugPrefix}-a`;
    const createRes = await tenantsCreatePOST(
      jsonRequest('http://localhost/api/platform/tenants', 'POST', { name: 'Phase2 Tenant A', subdomainSlug: slug, adminEmail: `admin@${slug}.local` }, adminToken),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.status).toBe('Active');
    createdTenantIds.push(created.id);
    createdTenantSchemas.push(created.schemaName);

    const getRes = await tenantGetGET(plainRequest(`http://localhost/api/platform/tenants/${created.id}`, 'GET', adminToken), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).subdomainSlug).toBe(slug);

    const listRes = await tenantsListGET(plainRequest(`http://localhost/api/platform/tenants?status=Active`, 'GET', adminToken));
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.items.some((t: { id: string }) => t.id === created.id)).toBe(true);
  }, 60_000);

  it('hard-rejects an invalid create request (400 TENANT_NAME_REQUIRED) — nothing is created', async () => {
    const res = await tenantsCreatePOST(
      jsonRequest('http://localhost/api/platform/tenants', 'POST', { name: '', subdomainSlug: `${slugPrefix}-b`, adminEmail: `x@${slugPrefix}-b.local` }, adminToken),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('TENANT_NAME_REQUIRED');
  });

  it('suspends then reactivates a tenant via the real routes; rejects a mismatched-status transition 409 INVALID_TENANT_STATE', async () => {
    const slug = `${slugPrefix}-c`;
    const createRes = await tenantsCreatePOST(
      jsonRequest('http://localhost/api/platform/tenants', 'POST', { name: 'Phase2 Tenant C', subdomainSlug: slug, adminEmail: `admin@${slug}.local` }, adminToken),
    );
    const created = await createRes.json();
    createdTenantIds.push(created.id);
    createdTenantSchemas.push(created.schemaName);

    // Reactivate before ever suspending — the tenant is Active, so this must fail.
    const badActivateRes = await tenantActivatePOST(plainRequest(`http://localhost/api/platform/tenants/${created.id}/activate`, 'POST', adminToken), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(badActivateRes.status).toBe(409);
    expect((await badActivateRes.json()).error.code).toBe('INVALID_TENANT_STATE');

    const suspendRes = await tenantSuspendPOST(plainRequest(`http://localhost/api/platform/tenants/${created.id}/suspend`, 'POST', adminToken), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(suspendRes.status).toBe(200);
    expect((await suspendRes.json()).status).toBe('Suspended');

    const activateRes = await tenantActivatePOST(plainRequest(`http://localhost/api/platform/tenants/${created.id}/activate`, 'POST', adminToken), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(activateRes.status).toBe(200);
    expect((await activateRes.json()).status).toBe('Active');
  }, 60_000);

  it('updates registration settings via PATCH, leaving an unsupplied field unchanged', async () => {
    const slug = `${slugPrefix}-d`;
    const createRes = await tenantsCreatePOST(
      jsonRequest('http://localhost/api/platform/tenants', 'POST', { name: 'Phase2 Tenant D', subdomainSlug: slug, adminEmail: `admin@${slug}.local` }, adminToken),
    );
    const created = await createRes.json();
    createdTenantIds.push(created.id);
    createdTenantSchemas.push(created.schemaName);
    expect(created.allowEmailRegistration).toBe(true);
    expect(created.allowGoogleSignIn).toBe(false);

    const patchRes = await tenantRegistrationSettingsPATCH(
      jsonRequest(`http://localhost/api/platform/tenants/${created.id}/registration-settings`, 'PATCH', { allowGoogleSignIn: true }, adminToken),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.allowGoogleSignIn).toBe(true);
    expect(patched.allowEmailRegistration).toBe(true); // unsupplied field left unchanged.
  }, 60_000);

  it('soft-deletes a tenant via POST .../soft-delete; a second delete on the same id is TENANT_NOT_FOUND (idempotency safety)', async () => {
    const slug = `${slugPrefix}-e`;
    const createRes = await tenantsCreatePOST(
      jsonRequest('http://localhost/api/platform/tenants', 'POST', { name: 'Phase2 Tenant E', subdomainSlug: slug, adminEmail: `admin@${slug}.local` }, adminToken),
    );
    const created = await createRes.json();
    createdTenantIds.push(created.id);
    createdTenantSchemas.push(created.schemaName);

    const deleteRes = await tenantSoftDeletePOST(plainRequest(`http://localhost/api/platform/tenants/${created.id}/soft-delete`, 'POST', adminToken), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(deleteRes.status).toBe(200);
    const deleted = await deleteRes.json();
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.purgeAfterAt).not.toBeNull();

    // The row still resolves by id (soft-delete, not a hard delete) — get still works.
    const getRes = await tenantGetGET(plainRequest(`http://localhost/api/platform/tenants/${created.id}`, 'GET', adminToken), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(getRes.status).toBe(200);

    const secondDeleteRes = await tenantSoftDeletePOST(plainRequest(`http://localhost/api/platform/tenants/${created.id}/soft-delete`, 'POST', adminToken), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(secondDeleteRes.status).toBe(404);
    expect((await secondDeleteRes.json()).error.code).toBe('TENANT_NOT_FOUND');
  }, 60_000);

  it('retry-provisioning on an already-Active tenant is a real, benign 409 INVALID_TENANT_STATE race, via the real route', async () => {
    const slug = `${slugPrefix}-f`;
    const createRes = await tenantsCreatePOST(
      jsonRequest('http://localhost/api/platform/tenants', 'POST', { name: 'Phase2 Tenant F', subdomainSlug: slug, adminEmail: `admin@${slug}.local` }, adminToken),
    );
    const created = await createRes.json();
    createdTenantIds.push(created.id);
    createdTenantSchemas.push(created.schemaName);

    const retryRes = await tenantRetryPOST(plainRequest(`http://localhost/api/platform/tenants/${created.id}/provisioning/retry`, 'POST', adminToken), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(retryRes.status).toBe(409);
    expect((await retryRes.json()).error.code).toBe('INVALID_TENANT_STATE');
  }, 60_000);
});
