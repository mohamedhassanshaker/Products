import { test, expect } from '@playwright/test';
import { ZipFile } from 'yazl';
import { DEMO_TENANTS, DEMO_TENANT_ADMIN_PASSWORD, tenantAuthHeaders, tenantLogin } from './fixtures';

/**
 * Cluster 5 — Exam authoring (migration plan Phase 10, cluster 5): manual ZIP-based Exam Type
 * creation, module/question-count validation, RBAC gating. Mirrors
 * `server/phase4-exam-authoring-routes.integration.test.ts`'s own `buildZip` helper (real `yazl`
 * archives — no checked-in ZIP fixture exists anywhere in this repo), driven here over real HTTP
 * against the live `examland-next` stack instead of in-process Route Handler calls.
 */

/** Builds a real, well-formed ZIP archive via `yazl`. */
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

const validQuestion = (text: string, correct = 'A') =>
  JSON.stringify({ text, options: { A: 'a', B: 'b' }, correctAnswer: correct, explanation: 'exp' });

test.describe('Cluster 5 — Exam authoring', () => {
  test('manual ZIP-based Exam Type creation: a Tenant Admin authors a real, well-formed ZIP into two modules', async ({ request }) => {
    const suffix = Date.now().toString(36);
    const { accessToken } = await tenantLogin(request, DEMO_TENANTS.starter.subdomain, DEMO_TENANTS.starter.adminEmail, DEMO_TENANT_ADMIN_PASSWORD);
    const headers = tenantAuthHeaders(DEMO_TENANTS.starter.subdomain, accessToken);

    const level = await (await request.post('/api/taxonomy/education-levels', { headers, data: { name: `E2E5 Level ${suffix}` } })).json();
    const stage = await (
      await request.post('/api/taxonomy/stages', { headers, data: { educationLevelId: level.id, name: `E2E5 Stage ${suffix}` } })
    ).json();

    const zip = await buildZip({
      'Module A/q1.json': validQuestion('Q1?'),
      'Module A/q2.json': validQuestion('Q2?', 'B'),
      'Module B/q1.json': validQuestion('Q3?'),
    });
    const modules = JSON.stringify([
      { name: 'Module A', questionCount: 2 },
      { name: 'Module B', questionCount: 1 },
    ]);

    const res = await request.post('/api/exam-types/zip', {
      headers,
      multipart: {
        file: { name: 'exam.zip', mimeType: 'application/zip', buffer: zip },
        name: `E2E5 Exam ${suffix}`,
        totalQuestions: '3',
        totalMinutes: '30',
        stageId: String(stage.id),
        modules,
      },
    });
    expect(res.status(), await res.text().catch(() => '')).toBe(201);
    const examType = await res.json();
    expect(examType.origin).toBe('ZipImport');
    expect(examType.totalQuestions).toBe(3);
    expect(examType.modules).toHaveLength(2);
    expect(examType.curriculumLinks).toEqual([]);

    const detail = await (await request.get(`/api/exam-types/${examType.id}`, { headers })).json();
    expect(detail.id).toBe(examType.id);
  });

  test('module/question-count validation: a declared total that does not match the sum of module counts is rejected with the named error, not a generic one', async ({
    request,
  }) => {
    const suffix = Date.now().toString(36);
    const { accessToken } = await tenantLogin(request, DEMO_TENANTS.pro.subdomain, DEMO_TENANTS.pro.adminEmail, DEMO_TENANT_ADMIN_PASSWORD);
    const headers = tenantAuthHeaders(DEMO_TENANTS.pro.subdomain, accessToken);

    const level = await (await request.post('/api/taxonomy/education-levels', { headers, data: { name: `E2E5b Level ${suffix}` } })).json();
    const stage = await (
      await request.post('/api/taxonomy/stages', { headers, data: { educationLevelId: level.id, name: `E2E5b Stage ${suffix}` } })
    ).json();
    const zip = await buildZip({ 'Only Module/q1.json': validQuestion('Q?') });

    // Declares totalQuestions=5 while the single module only declares 1 -> QUESTION_COUNT_MISMATCH,
    // caught before the ZIP is ever parsed (FR-AUTH's own validation ordering).
    const res = await request.post('/api/exam-types/zip', {
      headers,
      multipart: {
        file: { name: 'exam.zip', mimeType: 'application/zip', buffer: zip },
        name: `E2E5b Exam ${suffix}`,
        totalQuestions: '5',
        totalMinutes: '10',
        stageId: String(stage.id),
        modules: JSON.stringify([{ name: 'Only Module', questionCount: 1 }]),
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('QUESTION_COUNT_MISMATCH');
  });

  test('RBAC gating: a Member without exams.create is rejected with 403 FORBIDDEN, never a silent pass-through', async ({ request }) => {
    const suffix = Date.now().toString(36);
    const { accessToken: adminToken } = await tenantLogin(
      request,
      DEMO_TENANTS.enterprise.subdomain,
      DEMO_TENANTS.enterprise.adminEmail,
      DEMO_TENANT_ADMIN_PASSWORD,
    );
    const adminHeaders = tenantAuthHeaders(DEMO_TENANTS.enterprise.subdomain, adminToken);

    const roles = await (await request.get('/api/roles', { headers: adminHeaders })).json();
    const memberRole = (roles as Array<{ id: number; name: string }>).find((r) => r.name === 'Member');
    const memberEmail = `e2e5-member-${suffix}@demo-enterprise.local`;
    const memberPassword = 'Member123!Pass';
    await request.post('/api/users', {
      headers: adminHeaders,
      data: { email: memberEmail, firstName: 'E2E5', lastName: 'Member', password: memberPassword, roleIds: [memberRole!.id] },
    });
    const { accessToken: memberToken } = await tenantLogin(request, DEMO_TENANTS.enterprise.subdomain, memberEmail, memberPassword);
    const memberHeaders = tenantAuthHeaders(DEMO_TENANTS.enterprise.subdomain, memberToken);

    const level = await (await request.post('/api/taxonomy/education-levels', { headers: adminHeaders, data: { name: `E2E5c Level ${suffix}` } })).json();
    const stage = await (
      await request.post('/api/taxonomy/stages', { headers: adminHeaders, data: { educationLevelId: level.id, name: `E2E5c Stage ${suffix}` } })
    ).json();
    const zip = await buildZip({ 'M/q1.json': validQuestion('Q?') });

    const res = await request.post('/api/exam-types/zip', {
      headers: memberHeaders,
      multipart: {
        file: { name: 'exam.zip', mimeType: 'application/zip', buffer: zip },
        name: `E2E5c Exam ${suffix}`,
        totalQuestions: '1',
        totalMinutes: '10',
        stageId: String(stage.id),
        modules: JSON.stringify([{ name: 'M', questionCount: 1 }]),
      },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
  });
});
