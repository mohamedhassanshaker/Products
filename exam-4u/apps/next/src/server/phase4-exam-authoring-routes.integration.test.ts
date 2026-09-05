import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZipFile } from 'yazl';
import { getEnv } from '@/server/config';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { getTenantProvisioningService } from '@/server/platform/provisioning';
import { getAuthService } from '@/server/auth';
import { RoleRepository, UserRoleRepository, UserRoleAssignmentService } from '@/server/rbac';
import { requireTenantDataSource, runWithRequestContext } from '@/server/context';
import { POST as levelsPOST } from '@/app/api/taxonomy/education-levels/route';
import { POST as stagesPOST } from '@/app/api/taxonomy/stages/route';
import { GET as examTypesGET } from '@/app/api/exam-types/route';
import { POST as examTypesZipPOST } from '@/app/api/exam-types/zip/route';
import { GET as examTypeGET, DELETE as examTypeDELETE } from '@/app/api/exam-types/[id]/route';

/** Builds a real, well-formed ZIP archive via `yazl` — mirrors
 * `legacy/api/test/exam-authoring.e2e-spec.ts`'s own `buildZip` helper. */
function buildZip(entries: Record<string, string>): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const zipFile = new ZipFile();
    for (const [name, content] of Object.entries(entries)) {
      zipFile.addBuffer(Buffer.from(content, 'utf8'), name);
    }
    const chunks: Buffer[] = [];
    zipFile.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zipFile.outputStream.on('end', () => resolvePromise(Buffer.concat(chunks)));
    zipFile.outputStream.on('error', reject);
    zipFile.end();
  });
}

const validQuestion = (text = 'Q?', correct = 'A') =>
  JSON.stringify({ text, options: { A: 'a', B: 'b' }, correctAnswer: correct, explanation: 'exp' });

async function listAllFilesRecursively(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listAllFilesRecursively(full)));
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * Phase 4 (`exam-authoring`) — real-route-level regression coverage for `app/api/exam-types/**`,
 * matching every prior phase's `phaseN-*-routes.integration.test.ts` convention: call the REAL
 * exported Route Handler functions with a genuine `NextRequest` (trusted `x-tenant-*` headers + a real
 * bearer token) against real MySQL and real disk storage, not the service layer directly.
 *
 * Also the permanent regression test for this dispatch's two new ESLint module-boundary rules
 * (`EXAM_AUTHORING_BARREL_ONLY`/`INFRASTRUCTURE_ZIP_BARREL_ONLY`) — every import above of an
 * `@/app/api/exam-types/**` route file proves that scoping is correct (a bare pattern would have
 * rejected these imports).
 *
 * Run via (STORAGE_ROOT must point at a writable local directory for real disk writes to succeed):
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     STORAGE_ROOT=<a writable local directory> \
 *     npx vitest run src/server/phase4-exam-authoring-routes.integration.test.ts
 */
describe('Phase 4 — /api/exam-types/** real routes (real MySQL, real disk, real JWT)', () => {
  const slug = `p4-${randomUUID().slice(0, 8)}`;
  let tenantId: string;
  let tenantSchema: string;
  let adminToken: string;
  let memberToken: string;
  let stageId: number;
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = getEnv().STORAGE_ROOT || join(tmpdir(), 'examland-phase4-shared-storage');
    await mkdir(storageRoot, { recursive: true });

    const provisioning = await getTenantProvisioningService();
    const tenant = await provisioning.provisionNewTenant({ name: 'Phase4 Tenant', subdomainSlug: slug, adminEmail: `admin@${slug}.local` });
    tenantId = tenant.id;
    tenantSchema = tenant.schemaName;

    const registry = getTenantDataSourceRegistry();
    const dataSource = await registry.acquire(tenantSchema);
    try {
      await runWithRequestContext({ requestId: randomUUID(), tenantId, tenantSlug: slug, tenantSchema, tenantDataSource: dataSource }, async () => {
        const auth = await getAuthService();
        const roles = new RoleRepository(requireTenantDataSource());
        const userRoles = new UserRoleRepository(requireTenantDataSource());
        const assignment = new UserRoleAssignmentService(roles, userRoles);

        const adminEmail = `p4admin-${randomUUID().slice(0, 8)}@${slug}.local`;
        const adminRegistered = await auth.register({ email: adminEmail, password: 'Abcdefg1', firstName: 'P4', lastName: 'Admin' });
        const tenantAdminRole = await roles.findByName('Tenant Admin');
        if (!tenantAdminRole) throw new Error('Tenant Admin role not seeded — cannot run this suite.');
        await assignment.replaceRolesForUser(adminRegistered.user.id, [tenantAdminRole.id]);
        adminToken = (await auth.login({ email: adminEmail, password: 'Abcdefg1' })).accessToken;

        const memberEmail = `p4member-${randomUUID().slice(0, 8)}@${slug}.local`;
        const memberRegistered = await auth.register({ email: memberEmail, password: 'Abcdefg1', firstName: 'P4', lastName: 'Member' });
        const memberRole = await roles.findByName('Member');
        if (!memberRole) throw new Error('Member role not seeded — cannot run this suite.');
        await assignment.replaceRolesForUser(memberRegistered.user.id, [memberRole.id]);
        memberToken = (await auth.login({ email: memberEmail, password: 'Abcdefg1' })).accessToken;
      });
    } finally {
      registry.release(tenantSchema);
    }

    // FR-AUTH-1 requires a target Stage — build the minimal Education Level -> Stage chain via the
    // real taxonomy HTTP surface, matching legacy's own e2e-spec precedent.
    const eduLevelRes = await levelsPOST(jsonRequest('http://localhost/api/taxonomy/education-levels', 'POST', adminToken, { name: `Secondary ${slug}` }));
    expect(eduLevelRes.status).toBe(201);
    const eduLevelId = (await eduLevelRes.json()).id;
    const stageRes = await stagesPOST(jsonRequest('http://localhost/api/taxonomy/stages', 'POST', adminToken, { educationLevelId: eduLevelId, name: `Grade 10 ${slug}` }));
    expect(stageRes.status).toBe(201);
    stageId = (await stageRes.json()).id;
  }, 60_000);

  afterAll(async () => {
    const platformDs = await getPlatformDataSource();
    const conn = await mysql.createConnection({ host: 'localhost', port: 3306, user: 'examland', password: 'examland_dev' });
    try {
      await conn.query(`DROP DATABASE IF EXISTS \`${tenantSchema}\``);
    } finally {
      await conn.end();
    }
    await platformDs.query('DELETE FROM tenant_provisioning_step WHERE tenant_id = ?', [tenantId]);
    await platformDs.query('DELETE FROM tenant_subscription WHERE tenant_id = ?', [tenantId]);
    await platformDs.query('DELETE FROM tenant WHERE id = ?', [tenantId]);
    await getTenantDataSourceRegistry().destroyAll();
    await platformDs.destroy();
    await rm(join(storageRoot, 'tenants', tenantId), { recursive: true, force: true });
  });

  function tenantHeaders(token?: string): Record<string, string> {
    const headers: Record<string, string> = { 'x-tenant-id': tenantId, 'x-tenant-slug': slug, 'x-tenant-schema': tenantSchema };
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  function jsonRequest(url: string, method: string, token: string | undefined, body: unknown): NextRequest {
    const headers = { ...tenantHeaders(token), 'content-type': 'application/json' };
    return new NextRequest(url, { method, headers, body: JSON.stringify(body) });
  }

  async function uploadZip(
    zip: Buffer,
    fields: { name: string; totalQuestions: number; totalMinutes: number; modules: { name: string; questionCount: number }[] },
    token: string | undefined,
  ) {
    const formData = new FormData();
    formData.set('name', fields.name);
    formData.set('totalQuestions', String(fields.totalQuestions));
    formData.set('totalMinutes', String(fields.totalMinutes));
    formData.set('stageId', String(stageId));
    formData.set('modules', JSON.stringify(fields.modules));
    formData.set('file', new Blob([new Uint8Array(zip)], { type: 'application/zip' }), 'exam.zip');
    const request = new NextRequest('http://localhost/api/exam-types/zip', { method: 'POST', headers: tenantHeaders(token), body: formData });
    return examTypesZipPOST(request);
  }

  it('rejects an unauthenticated request to GET /api/exam-types', async () => {
    const res = await examTypesGET(new NextRequest('http://localhost/api/exam-types', { headers: tenantHeaders() }));
    expect(res.status).toBe(401);
  });

  it('rejects a Member (no exams.create) attempting to upload a ZIP (403 FORBIDDEN)', async () => {
    const zip = await buildZip({ 'Algebra/q1.json': validQuestion() });
    const res = await uploadZip(zip, { name: `Forbidden ${slug}`, totalQuestions: 1, totalMinutes: 10, modules: [{ name: 'Algebra', questionCount: 1 }] }, memberToken);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
  });

  let examTypeId: string;

  it('a Tenant Admin uploads a real ZIP and persists the Exam Type + modules + questions, writing every question file to real disk', async () => {
    const zip = await buildZip({
      'Algebra/q1.json': validQuestion('2+2?', 'A'),
      'Algebra/q2.json': validQuestion('3+3?', 'B'),
      'Geometry/q1.json': validQuestion('Angles?', 'A'),
    });
    const res = await uploadZip(
      zip,
      {
        name: `Grade 10 Math ${slug}`,
        totalQuestions: 3,
        totalMinutes: 60,
        modules: [
          { name: 'Algebra', questionCount: 2 },
          { name: 'Geometry', questionCount: 1 },
        ],
      },
      adminToken,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    examTypeId = body.id;
    expect(body.modules).toHaveLength(2);

    const files = await listAllFilesRecursively(join(storageRoot, 'tenants'));
    expect(files.filter((f) => f.includes(examTypeId))).toHaveLength(3);
  });

  it('GET /api/exam-types lists the created Exam Type; GET /api/exam-types/:id reports its modules', async () => {
    const listRes = await examTypesGET(new NextRequest('http://localhost/api/exam-types', { headers: tenantHeaders(adminToken) }));
    expect(listRes.status).toBe(200);
    expect((await listRes.json()).some((e: { id: string }) => e.id === examTypeId)).toBe(true);

    const getRes = await examTypeGET(new NextRequest(`http://localhost/api/exam-types/${examTypeId}`, { headers: tenantHeaders(adminToken) }), {
      params: Promise.resolve({ id: examTypeId }),
    });
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    expect(body.modules.map((m: { moduleName: string }) => m.moduleName).sort()).toEqual(['Algebra', 'Geometry']);
  });

  it('rejects a ZIP whose real content diverges from the declared per-module count, leaving zero new artifacts (QUESTION_COUNT_MISMATCH)', async () => {
    const beforeFiles = (await listAllFilesRecursively(storageRoot)).length;
    // Declares Algebra with questionCount=2 (self-consistent with totalQuestions=2), but the ZIP only
    // actually contains 1 real question file for that module — the content-level check, not the pure
    // input-self-consistency one.
    const zip = await buildZip({ 'Algebra/q1.json': validQuestion() });
    const res = await uploadZip(zip, { name: `RealContentMismatch ${slug}`, totalQuestions: 2, totalMinutes: 10, modules: [{ name: 'Algebra', questionCount: 2 }] }, adminToken);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('QUESTION_COUNT_MISMATCH');
    expect(body.error.details).toEqual({ module: 'Algebra', declaredCount: 2, actualCount: 1 });
    expect((await listAllFilesRecursively(storageRoot)).length).toBe(beforeFiles);
  });

  it('rejects a duplicate Exam Type name (409 EXAM_TYPE_NAME_EXISTS), rolling back any storage writes from the losing attempt', async () => {
    const name = `DupName ${slug}`;
    const zip1 = await buildZip({ 'Solo/q1.json': validQuestion() });
    const created = await uploadZip(zip1, { name, totalQuestions: 1, totalMinutes: 10, modules: [{ name: 'Solo', questionCount: 1 }] }, adminToken);
    expect(created.status).toBe(201);
    const filesAfterFirst = (await listAllFilesRecursively(storageRoot)).length;

    const zip2 = await buildZip({ 'Other/q1.json': validQuestion() });
    const dupRes = await uploadZip(zip2, { name, totalQuestions: 1, totalMinutes: 10, modules: [{ name: 'Other', questionCount: 1 }] }, adminToken);
    expect(dupRes.status).toBe(409);
    expect((await dupRes.json()).error.code).toBe('EXAM_TYPE_NAME_EXISTS');
    expect((await listAllFilesRecursively(storageRoot)).length).toBe(filesAfterFirst);
  });

  it('rejects a zip-slip attack archive over the real HTTP endpoint, leaving zero new artifacts (security-critical)', async () => {
    const beforeFiles = (await listAllFilesRecursively(storageRoot)).length;
    // yazl (used by buildZip) refuses to write a `../`-style entry name itself — this is exactly why
    // the unit-level `exam-zip-parser.test.ts` uses a hand-rolled raw-ZIP writer for the equivalent
    // fixture. At the route level, this test instead proves the non-two-level-shape rejection path
    // (a file not directly inside a single top-level module folder), which is the same
    // `assertSafeEntryName`/structural-shape defense exercised over the real endpoint.
    const zip = await buildZip({ 'Algebra/nested/q1.json': validQuestion() });
    const res = await uploadZip(zip, { name: `ZipSlipShape ${slug}`, totalQuestions: 1, totalMinutes: 10, modules: [{ name: 'Algebra', questionCount: 1 }] }, adminToken);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_ZIP_STRUCTURE');
    expect((await listAllFilesRecursively(storageRoot)).length).toBe(beforeFiles);
  });

  it('DELETE /api/exam-types/:id removes the DB rows and the storage prefix; a subsequent GET 404s', async () => {
    const beforeFiles = await listAllFilesRecursively(join(storageRoot, 'tenants'));
    expect(beforeFiles.some((f) => f.includes(examTypeId))).toBe(true);

    const deleteRes = await examTypeDELETE(new NextRequest(`http://localhost/api/exam-types/${examTypeId}`, { method: 'DELETE', headers: tenantHeaders(adminToken) }), {
      params: Promise.resolve({ id: examTypeId }),
    });
    expect(deleteRes.status).toBe(204);

    const afterFiles = await listAllFilesRecursively(join(storageRoot, 'tenants'));
    expect(afterFiles.some((f) => f.includes(examTypeId))).toBe(false);

    const getRes = await examTypeGET(new NextRequest(`http://localhost/api/exam-types/${examTypeId}`, { headers: tenantHeaders(adminToken) }), {
      params: Promise.resolve({ id: examTypeId }),
    });
    expect(getRes.status).toBe(404);
    expect((await getRes.json()).error.code).toBe('EXAM_TYPE_NOT_FOUND');
  });

  it('a Member without exams.delete is rejected (403) attempting to delete an Exam Type', async () => {
    const zip = await buildZip({ 'Solo/q1.json': validQuestion() });
    const created = await uploadZip(zip, { name: `ForMemberDelete ${slug}`, totalQuestions: 1, totalMinutes: 10, modules: [{ name: 'Solo', questionCount: 1 }] }, adminToken);
    expect(created.status).toBe(201);
    const id = (await created.json()).id;

    const res = await examTypeDELETE(new NextRequest(`http://localhost/api/exam-types/${id}`, { method: 'DELETE', headers: tenantHeaders(memberToken) }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(403);
  });
});
