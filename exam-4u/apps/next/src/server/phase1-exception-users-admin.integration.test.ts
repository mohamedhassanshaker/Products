import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { getTenantProvisioningService } from '@/server/platform/provisioning';
import { BcryptPasswordHasherAdapter } from '@/server/infrastructure/security';
import { GET as usersListGET, POST as usersCreatePOST } from '@/app/api/users/route';
import { GET as userGetGET, PATCH as userPatchPATCH, DELETE as userDeleteDELETE } from '@/app/api/users/[id]/route';
import { PUT as userRolesPUT } from '@/app/api/users/[id]/roles/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as registerPOST } from '@/app/api/auth/register/route';

/**
 * Phase 1 "exception" closure — the migration plan's own instruction (`giggly-exploring-wombat.md`,
 * "Per-phase verification" § Exception) to additionally mine the highest-value business-rule
 * assertions from the legacy e2e suite after Phase 1. Sub-slice 1b did this for `auth`/
 * `tenant-resolution`/`rbac`; 1c's own closing status explicitly flagged `users`/`profile`/`files`/
 * `reliability` as the still-open remainder (`docs/plans/nextjs-rewrite-phase1-plan.md`, "Phase 1
 * overall status"). This file closes that gap for `legacy/api/test/users-admin.e2e-spec.ts`.
 *
 * Unlike `reliability-users-profile-files.integration.test.ts` (1c's own dispatch-scoped proof,
 * which calls `UsersService` directly), this file deliberately calls the REAL exported Route Handler
 * functions (`GET`/`POST`/`PATCH`/`DELETE`/`PUT` from `app/api/users/**`) with a genuine `NextRequest`
 * — the only way to prove the real `withTenantContext` -> `requireTenantUser` -> `requirePermission`
 * -> service call chain each route wires together, not just the service in isolation.
 *
 * Run via:
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     npx vitest run src/server/phase1-exception-users-admin.integration.test.ts
 */
describe('Phase 1 exception closure — users-admin.e2e-spec.ts adapted assertions (real MySQL, real routes)', () => {
  const slug = `pe1-users-${randomUUID().slice(0, 8)}`;
  let tenantId: string;
  let tenantSchema: string;
  let adminToken: string;
  let adminUserId: string;
  let adminEmail: string;
  let memberRoleId: number;

  beforeAll(async () => {
    const provisioning = await getTenantProvisioningService();
    adminEmail = `founder@${slug}.local`;
    const tenant = await provisioning.provisionNewTenant({
      name: 'Phase1 Exception Users Tenant',
      subdomainSlug: slug,
      adminEmail,
    });
    tenantId = tenant.id;
    tenantSchema = tenant.schemaName;

    // The provisioning-seeded admin is invite-only (no password) — set one directly via a real
    // bcrypt hash + raw SQL, the exact technique `legacy/api/test/users-admin.e2e-spec.ts` itself
    // uses, so this suite's "sole Tenant Admin" is the REAL provisioning-seeded admin (not a second,
    // separately-promoted one) — otherwise the tenant would genuinely have two Tenant Admins and
    // every LAST_ADMIN_PROTECTED assertion below would (correctly) never fire.
    const registry = getTenantDataSourceRegistry();
    const dataSource = await registry.acquire(tenantSchema);
    try {
      const hasher = new BcryptPasswordHasherAdapter(4); // low cost factor — this suite's own speed concern only.
      const passwordHash = await hasher.hash('Admin-Password-1');
      await dataSource.query('UPDATE `user` SET password_hash = ? WHERE email = ?', [passwordHash, adminEmail]);
      const roleRows: { id: number; name: string }[] = await dataSource.query('SELECT id, name FROM role');
      memberRoleId = roleRows.find((r) => r.name === 'Member')!.id;
    } finally {
      registry.release(tenantSchema);
    }

    const tenantHeaders: Record<string, string> = { 'x-tenant-id': tenantId, 'x-tenant-slug': slug, 'x-tenant-schema': tenantSchema, 'content-type': 'application/json' };
    const loginRes = await loginPOST(
      new NextRequest('http://localhost/api/auth/login', { method: 'POST', headers: tenantHeaders, body: JSON.stringify({ email: adminEmail, password: 'Admin-Password-1' }) }),
    );
    expect(loginRes.status).toBe(200);
    const loginBody = await loginRes.json();
    adminToken = loginBody.accessToken as string;
    adminUserId = loginBody.user.id as string;
  }, 60_000);

  afterAll(async () => {
    const platformDs = await getPlatformDataSource();
    if (tenantSchema) {
      const conn = await mysql.createConnection({ host: 'localhost', port: 3306, user: 'examland', password: 'examland_dev' });
      try {
        await conn.query(`DROP DATABASE IF EXISTS \`${tenantSchema}\``);
      } finally {
        await conn.end();
      }
    }
    if (tenantId) {
      await platformDs.query('DELETE FROM tenant_provisioning_step WHERE tenant_id = ?', [tenantId]);
      await platformDs.query('DELETE FROM tenant_subscription WHERE tenant_id = ?', [tenantId]);
      await platformDs.query('DELETE FROM tenant WHERE id = ?', [tenantId]);
    }
    await getTenantDataSourceRegistry().destroyAll();
    await platformDs.destroy();
  });

  /** Builds the trusted tenant headers `middleware.ts` would have set, plus an optional bearer token —
   * mirrors `auth-rbac-platform.integration.test.ts`'s identical inline convention. */
  function headers(token?: string): HeadersInit {
    const base: Record<string, string> = { 'x-tenant-id': tenantId, 'x-tenant-slug': slug, 'x-tenant-schema': tenantSchema };
    if (token) base.authorization = `Bearer ${token}`;
    return base;
  }

  function jsonRequest(url: string, method: string, body: unknown, token?: string): NextRequest {
    return new NextRequest(url, { method, headers: { ...headers(token), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }

  function plainRequest(url: string, method: string, token?: string): NextRequest {
    return new NextRequest(url, { method, headers: headers(token) });
  }

  it(
    'permission gating: an authenticated zero-role user is rejected 403 FORBIDDEN (not merely UNAUTHENTICATED) on every ' +
      'admin user-management route, and an unauthenticated request is rejected 401 before any permission check runs ' +
      '(adapts users-admin.e2e-spec.ts\'s "permission gating" describe block)',
    async () => {
      const zeroRoleEmail = `no-roles-${randomUUID().slice(0, 8)}@${slug}.local`;
      const registerReq = jsonRequest(`http://localhost/api/auth/register`, 'POST', {
        email: zeroRoleEmail,
        password: 'Correct-Horse-1',
        firstName: 'No',
        lastName: 'Roles',
      });
      const registerRes = await registerPOST(registerReq);
      expect(registerRes.status).toBe(201);

      const loginRes = await loginPOST(jsonRequest(`http://localhost/api/auth/login`, 'POST', { email: zeroRoleEmail, password: 'Correct-Horse-1' }));
      expect(loginRes.status).toBe(200);
      const zeroRoleToken = (await loginRes.json()).accessToken as string;

      const arbitraryId = randomUUID();
      const zeroRoleChecks: Promise<Response>[] = [
        usersListGET(plainRequest('http://localhost/api/users', 'GET', zeroRoleToken)),
        usersCreatePOST(
          jsonRequest('http://localhost/api/users', 'POST', { email: `x-${randomUUID().slice(0, 6)}@${slug}.local`, firstName: 'X', lastName: 'Y' }, zeroRoleToken),
        ),
        userGetGET(plainRequest(`http://localhost/api/users/${arbitraryId}`, 'GET', zeroRoleToken), { params: Promise.resolve({ id: arbitraryId }) }),
        userPatchPATCH(jsonRequest(`http://localhost/api/users/${arbitraryId}`, 'PATCH', { firstName: 'Z' }, zeroRoleToken), {
          params: Promise.resolve({ id: arbitraryId }),
        }),
        userDeleteDELETE(plainRequest(`http://localhost/api/users/${arbitraryId}`, 'DELETE', zeroRoleToken), { params: Promise.resolve({ id: arbitraryId }) }),
        userRolesPUT(jsonRequest(`http://localhost/api/users/${arbitraryId}/roles`, 'PUT', { roleIds: [] }, zeroRoleToken), {
          params: Promise.resolve({ id: arbitraryId }),
        }),
      ];
      const responses = await Promise.all(zeroRoleChecks);
      for (const res of responses) {
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error.code).toBe('FORBIDDEN');
      }

      // Guard order: no Authorization header at all must reject 401 UNAUTHENTICATED, never reaching the
      // permission check (proven separately from the FORBIDDEN case above).
      const unauthRes = await usersListGET(plainRequest('http://localhost/api/users', 'GET'));
      expect(unauthRes.status).toBe(401);
      expect((await unauthRes.json()).error.code).toBe('UNAUTHENTICATED');
    },
  );

  it(
    'a generated temporary password actually round-trips through a real login — proves the hash genuinely works, ' +
      'not merely that a string was returned (adapts users-admin.e2e-spec.ts\'s create+login happy path)',
    async () => {
      const email = `created-${randomUUID().slice(0, 8)}@${slug}.local`;
      const createRes = await usersCreatePOST(
        jsonRequest('http://localhost/api/users', 'POST', { email, firstName: 'Created', lastName: 'User', roleIds: [memberRoleId] }, adminToken),
      );
      expect(createRes.status).toBe(201);
      const createBody = await createRes.json();
      expect(createBody.temporaryPassword).toBeTruthy();
      expect(createBody.user.roles.map((r: { name: string }) => r.name)).toEqual(['Member']);

      const loginRes = await loginPOST(jsonRequest('http://localhost/api/auth/login', 'POST', { email, password: createBody.temporaryPassword }));
      expect(loginRes.status).toBe(200);
      expect((await loginRes.json()).user.email).toBe(email);
    },
  );

  it(
    'LAST_ADMIN_PROTECTED blocks both hard-delete and role-replacement-away for the sole Tenant Admin, via the real routes ' +
      '(adapts users-admin.e2e-spec.ts\'s two LAST_ADMIN_PROTECTED scenarios)',
    async () => {
      const deleteRes = await userDeleteDELETE(plainRequest(`http://localhost/api/users/${adminUserId}`, 'DELETE', adminToken), {
        params: Promise.resolve({ id: adminUserId }),
      });
      expect(deleteRes.status).toBe(409);
      expect((await deleteRes.json()).error.code).toBe('LAST_ADMIN_PROTECTED');

      const rolesRes = await userRolesPUT(
        jsonRequest(`http://localhost/api/users/${adminUserId}/roles`, 'PUT', { roleIds: [memberRoleId] }, adminToken),
        { params: Promise.resolve({ id: adminUserId }) },
      );
      expect(rolesRes.status).toBe(409);
      expect((await rolesRes.json()).error.code).toBe('LAST_ADMIN_PROTECTED');
    },
  );

  it(
    'hard-deletes a non-protected user via the real route; user_role rows cascade, and the id becomes unresolvable ' +
      '(404 USER_NOT_FOUND) on a subsequent real GET (adapts users-admin.e2e-spec.ts\'s hard-delete + cascade proof)',
    async () => {
      const email = `deleteme-${randomUUID().slice(0, 8)}@${slug}.local`;
      const createRes = await usersCreatePOST(
        jsonRequest('http://localhost/api/users', 'POST', { email, firstName: 'Delete', lastName: 'Me', roleIds: [memberRoleId] }, adminToken),
      );
      expect(createRes.status).toBe(201);
      const userId = (await createRes.json()).user.id as string;

      const registry = getTenantDataSourceRegistry();
      const dataSource = await registry.acquire(tenantSchema);
      try {
        const before: unknown[] = await dataSource.query('SELECT * FROM user_role WHERE user_id = ?', [userId]);
        expect(before).toHaveLength(1);

        const deleteRes = await userDeleteDELETE(plainRequest(`http://localhost/api/users/${userId}`, 'DELETE', adminToken), {
          params: Promise.resolve({ id: userId }),
        });
        expect(deleteRes.status).toBe(204);

        const getRes = await userGetGET(plainRequest(`http://localhost/api/users/${userId}`, 'GET', adminToken), {
          params: Promise.resolve({ id: userId }),
        });
        expect(getRes.status).toBe(404);
        expect((await getRes.json()).error.code).toBe('USER_NOT_FOUND');

        const after: unknown[] = await dataSource.query('SELECT * FROM user_role WHERE user_id = ?', [userId]);
        expect(after).toHaveLength(0);
      } finally {
        registry.release(tenantSchema);
      }
    },
  );
});
