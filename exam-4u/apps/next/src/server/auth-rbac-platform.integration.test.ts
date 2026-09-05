import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEnv } from '@/server/config';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { getTenantProvisioningService } from '@/server/platform/provisioning';
import { PlatformTenantRepository } from '@/server/platform/tenants';
import { runWithRequestContext, withPlatformAuth, withTenantContext } from '@/server/context';
import { resolveTenantBySlug, TenantResolutionCache, TenantSuspendedError, TenantUnavailableError } from '@/server/tenancy';
import { getAuthService, requireTenantUser } from '@/server/auth';
import { getRolesService, getUserRoleAssignmentService, getPermissionsCrudService, getPermissionResolutionService, requirePermission } from '@/server/rbac';
import { JwtPlatformTokenAdapter, BcryptPasswordHasherAdapter } from '@/server/infrastructure/security';
import { PlatformAdminRepository, PlatformAdminAuthService, getPlatformAdminAuthService, runPlatformAdminBootstrap } from '@/server/platform/auth';
import { ForbiddenDomainError } from '@/server/common/errors/domain-error';

/**
 * Real-MySQL, real-JWT integration proof of Phase 1 sub-slice 1b's core invariants — the vitest-
 * native counterpart to (and a coverage-contributing complement of) this dispatch's separate real-HTTP
 * smoke pass (`docs/plans/nextjs-rewrite-phase1-plan.md`'s exit gate item 5). Exercises the real
 * composition roots (`getAuthService`/`getRolesService`/`getPlatformAdminAuthService`), the real
 * `withTenantContext`/`withPlatformAuth` wrappers (constructed with a genuine Fetch `NextRequest`, not
 * a mock), the real tenant `DataSource` registry, and real bcrypt/`jose` round trips — everything
 * short of an actual TCP socket to the running Next.js server (which the separate smoke script proves
 * instead, since `middleware.ts`'s own `Host`-header/`NODE_ENV` gating can't be meaningfully exercised
 * from inside this shared vitest process — see this file's own tenant-resolution test below for why).
 *
 * Uses a unique subdomain slug per run and cleans up its own tenant schema + platform rows in
 * `afterAll`, matching `tenant-provisioning.integration.test.ts`'s precedent.
 *
 * Run via:
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     npx vitest run src/server/auth-rbac-platform.integration.test.ts
 */
describe('Phase 1 sub-slice 1b — auth/rbac/platform-auth (real MySQL, real JWT)', () => {
  const slug = `it-authz-${randomUUID().slice(0, 8)}`;
  const platformAdminEmail = `it-admin-${randomUUID().slice(0, 8)}@integration-test.local`;
  let tenantId: string;
  let tenantSchema: string;
  let platformAdminId: string | undefined;

  beforeAll(async () => {
    const provisioning = await getTenantProvisioningService();
    const tenant = await provisioning.provisionNewTenant({
      name: 'Authz Integration Tenant',
      subdomainSlug: slug,
      adminEmail: `admin@${slug}.local`,
    });
    tenantId = tenant.id;
    tenantSchema = tenant.schemaName;
  });

  afterAll(async () => {
    const platformDs = await getPlatformDataSource();
    if (platformAdminId) {
      await platformDs.query('DELETE FROM platform_admin WHERE id = ?', [platformAdminId]);
    }
    if (tenantSchema) {
      const env = { host: 'localhost', port: 3306, user: 'examland', password: 'examland_dev' };
      const conn = await mysql.createConnection(env);
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

  /** Builds a real ALS context matching what `withTenantContext` would establish, without going
   * through an actual `NextRequest`/header round trip — used by tests that need the tenant scope but
   * aren't specifically testing the wrapper itself. */
  async function withRealTenantScope<T>(fn: () => Promise<T>): Promise<T> {
    const registry = getTenantDataSourceRegistry();
    const dataSource = await registry.acquire(tenantSchema);
    try {
      return await runWithRequestContext(
        { requestId: randomUUID(), tenantId, tenantSlug: slug, tenantSchema, tenantDataSource: dataSource },
        fn,
      );
    } finally {
      registry.release(tenantSchema);
    }
  }

  it('resolveTenantBySlug resolves the real, freshly-provisioned Active tenant against real MySQL', async () => {
    const platformDs = await getPlatformDataSource();
    const repo = new PlatformTenantRepository(platformDs);
    const cache = new TenantResolutionCache(60_000, 15_000);
    try {
      const resolved = await resolveTenantBySlug(slug, { repo, cache, env: getEnv() });
      expect(resolved).toMatchObject({ id: tenantId, subdomainSlug: slug, schemaName: tenantSchema, status: 'Active' });
    } finally {
      cache.destroy();
    }
  });

  it('resolveTenantBySlug rejects a real Suspended tenant, then a real Reactivated one resolves again', async () => {
    const platformDs = await getPlatformDataSource();
    await platformDs.query('UPDATE tenant SET status = ? WHERE id = ?', ['Suspended', tenantId]);
    try {
      const repo = new PlatformTenantRepository(platformDs);
      const cache = new TenantResolutionCache(60_000, 15_000);
      try {
        await expect(resolveTenantBySlug(slug, { repo, cache, env: getEnv() })).rejects.toThrow(TenantSuspendedError);
      } finally {
        cache.destroy();
      }
    } finally {
      await platformDs.query('UPDATE tenant SET status = ? WHERE id = ?', ['Active', tenantId]);
    }
  });

  it('resolveTenantBySlug rejects a real Failed tenant as TenantUnavailableError', async () => {
    const platformDs = await getPlatformDataSource();
    await platformDs.query('UPDATE tenant SET status = ? WHERE id = ?', ['Failed', tenantId]);
    try {
      const repo = new PlatformTenantRepository(platformDs);
      const cache = new TenantResolutionCache(60_000, 15_000);
      try {
        await expect(resolveTenantBySlug(slug, { repo, cache, env: getEnv() })).rejects.toThrow(TenantUnavailableError);
      } finally {
        cache.destroy();
      }
    } finally {
      await platformDs.query('UPDATE tenant SET status = ? WHERE id = ?', ['Active', tenantId]);
    }
  });

  it('registers and logs in a real tenant user, issuing a real jose-signed JWT accepted by requireTenantUser', async () => {
    const email = `member-${randomUUID().slice(0, 8)}@${slug}.local`;

    const registerResult = await withRealTenantScope(async () => {
      const auth = await getAuthService();
      return auth.register({ email, password: 'Abcdefg1', firstName: 'Real', lastName: 'User' });
    });
    expect(registerResult.user.email).toBe(email);

    const loginResult = await withRealTenantScope(async () => {
      const auth = await getAuthService();
      return auth.login({ email, password: 'Abcdefg1' });
    });
    expect(loginResult.accessToken).toEqual(expect.any(String));

    // Build a genuine Fetch NextRequest carrying the trusted tenant headers `middleware.ts` would set
    // plus the real bearer token — proves requireTenantUser's full verify+cross-tenant-check path.
    const request = new NextRequest('http://localhost/api/auth/me', {
      headers: { authorization: `Bearer ${loginResult.accessToken}`, 'x-tenant-id': tenantId, 'x-tenant-slug': slug, 'x-tenant-schema': tenantSchema },
    });

    const response = await withTenantContext(request, async () => {
      const principal = await requireTenantUser(request);
      expect(principal.tenantId).toBe(tenantId);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    expect(response.status).toBe(200);
  });

  it('rejects a tenant-user token replayed against a DIFFERENT tenant (cross-tenant replay barrier, real JWTs)', async () => {
    const email = `member2-${randomUUID().slice(0, 8)}@${slug}.local`;
    const loginResult = await withRealTenantScope(async () => {
      const auth = await getAuthService();
      await auth.register({ email, password: 'Abcdefg1', firstName: 'Real', lastName: 'User2' });
      return auth.login({ email, password: 'Abcdefg1' });
    });

    const otherTenantId = randomUUID();
    const request = new NextRequest('http://localhost/api/auth/me', {
      headers: {
        authorization: `Bearer ${loginResult.accessToken}`,
        'x-tenant-id': otherTenantId,
        'x-tenant-slug': 'someone-else',
        'x-tenant-schema': tenantSchema, // deliberately reuse a real, connectable schema so the
        // wrapper's own acquire() succeeds — the REJECTION under test must come from
        // requireTenantUser's tenantId comparison, not from a DataSource acquisition failure.
      },
    });

    const response = await withTenantContext(request, async () => {
      await requireTenantUser(request);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('RBAC default-deny: a user with only the Member role is denied a Tenant-Admin-only permission (real DB-backed)', async () => {
    const email = `member3-${randomUUID().slice(0, 8)}@${slug}.local`;

    await withRealTenantScope(async () => {
      const auth = await getAuthService();
      const { user } = await auth.register({ email, password: 'Abcdefg1', firstName: 'Real', lastName: 'Member' });

      const roles = getRolesService();
      const allRoles = await roles.list();
      const memberRole = allRoles.find((r) => r.name === 'Member');
      expect(memberRole).toBeDefined();

      const assignment = getUserRoleAssignmentService();
      await assignment.replaceRolesForUser(user.id, [memberRole!.id]);

      // Member does NOT include roles.read — real default-deny proof against a real permission
      // resolution query.
      await expect(requirePermission(user.id, 'roles.read')).rejects.toThrow(ForbiddenDomainError);
      // But it DOES include exams.read (per SeedRbacStep's seeded grant) — proves this isn't a
      // blanket deny, only a real, specific missing-grant rejection.
      await expect(requirePermission(user.id, 'exams.read')).resolves.toBeUndefined();
    });
  });

  it('rbac barrel composition roots (getPermissionsCrudService/getPermissionResolutionService) resolve real, working instances', async () => {
    await withRealTenantScope(async () => {
      const permissionsCrud = getPermissionsCrudService();
      const permissions = await permissionsCrud.list();
      expect(permissions.length).toBeGreaterThanOrEqual(30); // the full seeded catalog

      const permissionResolution = getPermissionResolutionService();
      await expect(permissionResolution.getEffectivePermissions(randomUUID())).resolves.toEqual(new Set());
    });
  });

  it('RBAC allow: a user promoted to Tenant Admin passes the same permission check', async () => {
    const email = `admin2-${randomUUID().slice(0, 8)}@${slug}.local`;

    await withRealTenantScope(async () => {
      const auth = await getAuthService();
      const { user } = await auth.register({ email, password: 'Abcdefg1', firstName: 'Real', lastName: 'Admin2' });

      const roles = getRolesService();
      const adminRole = (await roles.list()).find((r) => r.name === 'Tenant Admin');
      const assignment = getUserRoleAssignmentService();
      await assignment.replaceRolesForUser(user.id, [adminRole!.id]);

      await expect(requirePermission(user.id, 'roles.read')).resolves.toBeUndefined();
    });
  });

  it('a real HTTP-shaped 403 is produced end to end when a Route-Handler-style closure denies via requirePermission', async () => {
    const email = `member4-${randomUUID().slice(0, 8)}@${slug}.local`;

    const loginResult = await withRealTenantScope(async () => {
      const auth = await getAuthService();
      const { user } = await auth.register({ email, password: 'Abcdefg1', firstName: 'Real', lastName: 'Member4' });
      const roles = getRolesService();
      const memberRole = (await roles.list()).find((r) => r.name === 'Member');
      await getUserRoleAssignmentService().replaceRolesForUser(user.id, [memberRole!.id]);
      return auth.login({ email, password: 'Abcdefg1' });
    });

    const request = new NextRequest('http://localhost/api/roles', {
      headers: { authorization: `Bearer ${loginResult.accessToken}`, 'x-tenant-id': tenantId, 'x-tenant-slug': slug, 'x-tenant-schema': tenantSchema },
    });

    const response = await withTenantContext(request, async () => {
      const principal = await requireTenantUser(request);
      await requirePermission(principal.userId, 'roles.read'); // Member lacks this — must reject.
      return new Response(JSON.stringify(await getRolesService().list()));
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toMatch(/roles\.read/);
  });

  it('full real role CRUD round trip (create/update/replacePermissions/delete) against real MySQL', async () => {
    await withRealTenantScope(async () => {
      const roles = getRolesService();
      const permissionsCrud = getPermissionsCrudService();
      const catalog = await permissionsCrud.list();
      const examsRead = catalog.find((p) => p.name === 'exams.read')!;

      const created = await roles.create({ name: `IT Custom Role ${randomUUID().slice(0, 8)}`, description: 'A throwaway role', permissionIds: [examsRead.id] });
      expect(created.permissions.map((p) => p.name)).toEqual(['exams.read']);

      const updated = await roles.update(created.id, { description: 'Updated description' });
      expect(updated.description).toBe('Updated description');

      const replaced = await roles.replacePermissions(created.id, []);
      expect(replaced.permissions).toEqual([]);

      await roles.delete(created.id);
      await expect(roles.get(created.id)).rejects.toMatchObject({ code: 'ROLE_NOT_FOUND' });
    });
  });

  it('platform-admin realm: a real bcrypt/jose login round trip works via withPlatformAuth, with no tenant concept at all', async () => {
    const platformDs = await getPlatformDataSource();
    const env = getEnv();
    const hasher = new BcryptPasswordHasherAdapter(4); // low cost factor — this test's own speed concern only
    const admins = new PlatformAdminRepository(platformDs);
    const passwordHash = await hasher.hash('RealAdminPass1');
    const inserted = await admins.insert({
      id: randomUUID(),
      email: platformAdminEmail,
      passwordHash,
      name: 'Integration Test Admin',
      isActive: true,
      lastLoginAt: null,
    });
    platformAdminId = inserted.id;

    const authService = new PlatformAdminAuthService(admins, hasher, new JwtPlatformTokenAdapter(env.JWT_PLATFORM_SECRET, env.JWT_PLATFORM_TTL));
    const loginResult = await authService.login({ email: platformAdminEmail, password: 'RealAdminPass1' });
    expect(loginResult.accessToken).toEqual(expect.any(String));

    const request = new NextRequest('http://localhost/api/platform/auth/me', {
      headers: { authorization: `Bearer ${loginResult.accessToken}` },
    });
    const response = await withPlatformAuth(request, async (principal) => {
      expect(principal.adminId).toBe(inserted.id);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    expect(response.status).toBe(200);
  });

  it('the composition-root getPlatformAdminAuthService() resolves a working, real service instance', async () => {
    const service = await getPlatformAdminAuthService();
    // getById is a harmless read — proves the composition root actually wired a real, connectable
    // PlatformAdminRepository (bound to the real platform DataSource) without needing to know about
    // any specific admin row.
    await expect(service.getById(randomUUID())).resolves.toBeNull();
  });

  it('runPlatformAdminBootstrap() is safe to call for real against the live platform schema (no-ops when the bootstrap env vars are unset in this test process)', async () => {
    await expect(runPlatformAdminBootstrap()).resolves.toBeUndefined();
  });

  it('platform-admin realm rejects a genuine tenant-user token (realm-separation barrier, real JWTs)', async () => {
    const email = `member5-${randomUUID().slice(0, 8)}@${slug}.local`;
    const loginResult = await withRealTenantScope(async () => {
      const auth = await getAuthService();
      await auth.register({ email, password: 'Abcdefg1', firstName: 'Real', lastName: 'Member5' });
      return auth.login({ email, password: 'Abcdefg1' });
    });

    const request = new NextRequest('http://localhost/api/platform/auth/me', {
      headers: { authorization: `Bearer ${loginResult.accessToken}` },
    });
    const response = await withPlatformAuth(request, async () => new Response(JSON.stringify({ ok: true })));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });
});
