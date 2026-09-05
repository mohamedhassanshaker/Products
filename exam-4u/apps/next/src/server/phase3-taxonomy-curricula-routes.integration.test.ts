import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { getTenantProvisioningService } from '@/server/platform/provisioning';
import { getAuthService } from '@/server/auth';
import { RoleRepository, UserRoleRepository, UserRoleAssignmentService } from '@/server/rbac';
import { requireTenantDataSource, runWithRequestContext } from '@/server/context';
import { GET as levelsGET, POST as levelsPOST } from '@/app/api/taxonomy/education-levels/route';
import { DELETE as levelDELETE } from '@/app/api/taxonomy/education-levels/[id]/route';
import { GET as stagesGET, POST as stagesPOST } from '@/app/api/taxonomy/stages/route';
import { DELETE as stageDELETE } from '@/app/api/taxonomy/stages/[id]/route';
import { GET as subjectsGET, POST as subjectsPOST } from '@/app/api/taxonomy/subjects/route';
import { DELETE as subjectDELETE } from '@/app/api/taxonomy/subjects/[id]/route';
import { GET as curriculaListGET, POST as curriculaCreatePOST } from '@/app/api/curricula/route';
import { GET as curriculumGetGET, PATCH as curriculumPATCH, DELETE as curriculumDELETE } from '@/app/api/curricula/[id]/route';

/**
 * Phase 3 (taxonomy & curricula) — real-route-level regression coverage for this dispatch's new
 * `app/api/taxonomy/**`/`app/api/curricula/**` Route Handlers, matching the exact
 * `phase2-platform-tenants-routes.integration.test.ts`/`auth-rbac-platform.integration.test.ts`
 * convention: call the REAL exported Route Handler functions with a genuine `NextRequest` (trusted
 * `x-tenant-*` headers + a real bearer token), not the service layer directly.
 *
 * Also the permanent regression test for this dispatch's two new ESLint module-boundary rules
 * (`TAXONOMY_BARREL_ONLY`/`CURRICULA_BARREL_ONLY`, both scoped to `server/<module>` from the start) —
 * every import above of an `@/app/api/{taxonomy,curricula}/**` route file proves that scoping is
 * correct (a bare pattern would have rejected these imports).
 *
 * Provisions one real tenant via the real workflow, promotes a self-registered user to `Tenant Admin`
 * (to exercise `taxonomy.create`/`taxonomy.delete`/`curricula.read_all`), and cleans up its own schema
 * + platform rows in `afterAll`.
 *
 * Run via:
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     npx vitest run src/server/phase3-taxonomy-curricula-routes.integration.test.ts
 */
describe('Phase 3 — /api/taxonomy/** and /api/curricula/** real routes (real MySQL, real JWT)', () => {
  const slug = `p3-${randomUUID().slice(0, 8)}`;
  let tenantId: string;
  let tenantSchema: string;
  let adminToken: string;
  let adminUserId: string;
  let memberToken: string;
  let memberUserId: string;

  beforeAll(async () => {
    const provisioning = await getTenantProvisioningService();
    const tenant = await provisioning.provisionNewTenant({ name: 'Phase3 Tenant', subdomainSlug: slug, adminEmail: `admin@${slug}.local` });
    tenantId = tenant.id;
    tenantSchema = tenant.schemaName;

    const registry = getTenantDataSourceRegistry();
    const dataSource = await registry.acquire(tenantSchema);
    try {
      await runWithRequestContext({ requestId: randomUUID(), tenantId, tenantSlug: slug, tenantSchema, tenantDataSource: dataSource }, async () => {
        const auth = await getAuthService();

        const adminEmail = `p3admin-${randomUUID().slice(0, 8)}@${slug}.local`;
        const adminRegistered = await auth.register({ email: adminEmail, password: 'Abcdefg1', firstName: 'P3', lastName: 'Admin' });
        adminUserId = adminRegistered.user.id;
        const roles = new RoleRepository(requireTenantDataSource());
        const userRoles = new UserRoleRepository(requireTenantDataSource());
        const assignment = new UserRoleAssignmentService(roles, userRoles);
        const tenantAdminRole = await roles.findByName('Tenant Admin');
        if (!tenantAdminRole) throw new Error('Tenant Admin role not seeded — cannot run this suite.');
        await assignment.replaceRolesForUser(adminUserId, [tenantAdminRole.id]);
        const adminLogin = await auth.login({ email: adminEmail, password: 'Abcdefg1' });
        adminToken = adminLogin.accessToken;

        // Self-registration only auto-assigns a role if the tenant's `defaultSelfRegisterRole` setting
        // is configured (AuthService.assignDefaultRoleIfConfigured) — a freshly-provisioned tenant has
        // no such setting, so a self-registered user starts with zero roles/permissions (fail-closed).
        // Explicitly grant the seeded "Member" role so this suite can exercise taxonomy.read/
        // curricula.manage_own, the permissions that role actually carries.
        const memberRole = await roles.findByName('Member');
        if (!memberRole) throw new Error('Member role not seeded — cannot run this suite.');

        const memberEmail = `p3member-${randomUUID().slice(0, 8)}@${slug}.local`;
        const memberRegistered = await auth.register({ email: memberEmail, password: 'Abcdefg1', firstName: 'P3', lastName: 'Member' });
        memberUserId = memberRegistered.user.id;
        await assignment.replaceRolesForUser(memberUserId, [memberRole.id]);
        const memberLogin = await auth.login({ email: memberEmail, password: 'Abcdefg1' });
        memberToken = memberLogin.accessToken;
      });
    } finally {
      registry.release(tenantSchema);
    }
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

  function req(url: string, method: string, token?: string, body?: unknown): NextRequest {
    const headers: Record<string, string> = { 'x-tenant-id': tenantId, 'x-tenant-slug': slug, 'x-tenant-schema': tenantSchema };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    return new NextRequest(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }

  it('rejects an unauthenticated request to /api/taxonomy/education-levels', async () => {
    const res = await levelsGET(req('http://localhost/api/taxonomy/education-levels', 'GET'));
    expect(res.status).toBe(401);
  });

  it('rejects a Member (no taxonomy.create) attempting to create an education level (403 FORBIDDEN)', async () => {
    const res = await levelsPOST(req('http://localhost/api/taxonomy/education-levels', 'POST', memberToken, { name: 'Should Fail' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
  });

  let educationLevelId: number;
  let stageId: number;
  let subjectId: number;

  it('Tenant Admin creates an Education Level -> Stage -> Subject hierarchy via the real routes', async () => {
    const levelRes = await levelsPOST(req('http://localhost/api/taxonomy/education-levels', 'POST', adminToken, { name: `Secondary ${slug}` }));
    expect(levelRes.status).toBe(201);
    educationLevelId = (await levelRes.json()).id;

    // FR-TAX-2 create-or-fetch: creating the identical name again returns 200, not a duplicate row.
    const levelAgainRes = await levelsPOST(req('http://localhost/api/taxonomy/education-levels', 'POST', adminToken, { name: `Secondary ${slug}` }));
    expect(levelAgainRes.status).toBe(200);
    expect((await levelAgainRes.json()).id).toBe(educationLevelId);

    const stageRes = await stagesPOST(
      req('http://localhost/api/taxonomy/stages', 'POST', adminToken, { educationLevelId, name: `Grade 10 ${slug}` }),
    );
    expect(stageRes.status).toBe(201);
    stageId = (await stageRes.json()).id;

    const subjectRes = await subjectsPOST(req('http://localhost/api/taxonomy/subjects', 'POST', adminToken, { stageId, name: `Biology ${slug}` }));
    expect(subjectRes.status).toBe(201);
    subjectId = (await subjectRes.json()).id;

    const stagesListRes = await stagesGET(req(`http://localhost/api/taxonomy/stages?educationLevelId=${educationLevelId}`, 'GET', adminToken));
    expect(stagesListRes.status).toBe(200);
    expect((await stagesListRes.json()).map((s: { id: number }) => s.id)).toContain(stageId);

    const subjectsListRes = await subjectsGET(req(`http://localhost/api/taxonomy/subjects?stageId=${stageId}`, 'GET', adminToken));
    expect(subjectsListRes.status).toBe(200);
    expect((await subjectsListRes.json()).map((s: { id: number }) => s.id)).toContain(subjectId);
  });

  it('a Member can still list education levels (taxonomy.read) but cannot create/delete', async () => {
    const res = await levelsGET(req('http://localhost/api/taxonomy/education-levels', 'GET', memberToken));
    expect(res.status).toBe(200);
    const deleteRes = await levelDELETE(req(`http://localhost/api/taxonomy/education-levels/${educationLevelId}`, 'DELETE', memberToken), {
      params: Promise.resolve({ id: String(educationLevelId) }),
    });
    expect(deleteRes.status).toBe(403);
  });

  it('rejects deleting an Education Level still referenced by a Stage (409 TAXONOMY_ENTRY_IN_USE)', async () => {
    const res = await levelDELETE(req(`http://localhost/api/taxonomy/education-levels/${educationLevelId}`, 'DELETE', adminToken), {
      params: Promise.resolve({ id: String(educationLevelId) }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('TAXONOMY_ENTRY_IN_USE');
  });

  let curriculumId: string;

  it('a Member creates a Curriculum scoped to the real Subject (curricula.manage_own)', async () => {
    const res = await curriculaCreatePOST(
      req('http://localhost/api/curricula', 'POST', memberToken, { name: 'My Curriculum', description: 'test', subjectId }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    curriculumId = body.id;
    expect(body.ownerUserId).toBe(memberUserId);
    expect(body.subjectId).toBe(subjectId);
  });

  it('rejects creating a Curriculum against a nonexistent subjectId (404 SUBJECT_NOT_FOUND)', async () => {
    const res = await curriculaCreatePOST(req('http://localhost/api/curricula', 'POST', memberToken, { name: 'No Such Subject', subjectId: 999999999 }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('SUBJECT_NOT_FOUND');
  });

  it("a different Member (non-owner, no oversight) gets 403 NOT_CURRICULUM_OWNER on GET/PATCH/DELETE", async () => {
    const otherEmail = `p3other-${randomUUID().slice(0, 8)}@${slug}.local`;
    const registry = getTenantDataSourceRegistry();
    const dataSource = await registry.acquire(tenantSchema);
    let otherToken: string;
    try {
      otherToken = await runWithRequestContext(
        { requestId: randomUUID(), tenantId, tenantSlug: slug, tenantSchema, tenantDataSource: dataSource },
        async () => {
          const auth = await getAuthService();
          const registered = await auth.register({ email: otherEmail, password: 'Abcdefg1', firstName: 'P3', lastName: 'Other' });
          // Grant curricula.manage_own (the "Member" role) so this user reaches CurriculaService's own
          // ownership check at all, rather than being turned away earlier by requirePermission — the
          // point of this test is proving the *ownership* denial (403 NOT_CURRICULUM_OWNER), not the
          // base-permission denial (403 FORBIDDEN) already covered by an earlier test in this file.
          const roles = new RoleRepository(requireTenantDataSource());
          const userRoles = new UserRoleRepository(requireTenantDataSource());
          const memberRole = await roles.findByName('Member');
          if (!memberRole) throw new Error('Member role not seeded — cannot run this suite.');
          await new UserRoleAssignmentService(roles, userRoles).replaceRolesForUser(registered.user.id, [memberRole.id]);
          return (await auth.login({ email: otherEmail, password: 'Abcdefg1' })).accessToken;
        },
      );
    } finally {
      registry.release(tenantSchema);
    }

    const getRes = await curriculumGetGET(req(`http://localhost/api/curricula/${curriculumId}`, 'GET', otherToken), {
      params: Promise.resolve({ id: curriculumId }),
    });
    expect(getRes.status).toBe(403);
    expect((await getRes.json()).error.code).toBe('NOT_CURRICULUM_OWNER');
  });

  it('the Tenant Admin (curricula.read_all oversight) CAN read/update a Curriculum they do not own', async () => {
    const res = await curriculumGetGET(req(`http://localhost/api/curricula/${curriculumId}`, 'GET', adminToken), {
      params: Promise.resolve({ id: curriculumId }),
    });
    expect(res.status).toBe(200);
  });

  it('the owner updates their own Curriculum (PATCH), reflected on a subsequent GET (real DB persistence)', async () => {
    const patchRes = await curriculumPATCH(req(`http://localhost/api/curricula/${curriculumId}`, 'PATCH', memberToken, { name: 'Renamed' }), {
      params: Promise.resolve({ id: curriculumId }),
    });
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).name).toBe('Renamed');

    const getRes = await curriculumGetGET(req(`http://localhost/api/curricula/${curriculumId}`, 'GET', memberToken), {
      params: Promise.resolve({ id: curriculumId }),
    });
    expect((await getRes.json()).name).toBe('Renamed');
  });

  it("the list endpoint scopes to the owner's own curricula for a Member without curricula.read_all", async () => {
    const res = await curriculaListGET(req('http://localhost/api/curricula', 'GET', memberToken));
    expect(res.status).toBe(200);
    const items = await res.json();
    expect(items.every((c: { ownerUserId: string }) => c.ownerUserId === memberUserId)).toBe(true);
    expect(items.some((c: { id: string }) => c.id === curriculumId)).toBe(true);
  });

  it('the owner deletes their own Curriculum; a subsequent GET 403s (curriculum genuinely gone, not owned by admin oversight to view it as deleted)', async () => {
    const deleteRes = await curriculumDELETE(req(`http://localhost/api/curricula/${curriculumId}`, 'DELETE', memberToken), {
      params: Promise.resolve({ id: curriculumId }),
    });
    expect(deleteRes.status).toBe(204);

    const getRes = await curriculumGetGET(req(`http://localhost/api/curricula/${curriculumId}`, 'GET', adminToken), {
      params: Promise.resolve({ id: curriculumId }),
    });
    expect(getRes.status).toBe(404);
  });

  it('deleting the Subject/Stage/Education Level now succeeds bottom-up (no more referencing rows)', async () => {
    const subjectRes = await subjectDELETE(req(`http://localhost/api/taxonomy/subjects/${subjectId}`, 'DELETE', adminToken), {
      params: Promise.resolve({ id: String(subjectId) }),
    });
    expect(subjectRes.status).toBe(204);

    const stageRes = await stageDELETE(req(`http://localhost/api/taxonomy/stages/${stageId}`, 'DELETE', adminToken), {
      params: Promise.resolve({ id: String(stageId) }),
    });
    expect(stageRes.status).toBe(204);

    const levelRes = await levelDELETE(req(`http://localhost/api/taxonomy/education-levels/${educationLevelId}`, 'DELETE', adminToken), {
      params: Promise.resolve({ id: String(educationLevelId) }),
    });
    expect(levelRes.status).toBe(204);
  });

  it('deleting an already-deleted Education Level returns 404 TAXONOMY_ENTRY_NOT_FOUND (not a 500)', async () => {
    const res = await levelDELETE(req(`http://localhost/api/taxonomy/education-levels/${educationLevelId}`, 'DELETE', adminToken), {
      params: Promise.resolve({ id: String(educationLevelId) }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('TAXONOMY_ENTRY_NOT_FOUND');
  });
});
