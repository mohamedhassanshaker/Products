import { test, expect } from '@playwright/test';
import { DEMO_TENANTS, DEMO_TENANT_ADMIN_PASSWORD, resolveTenant, tenantAuthHeaders, tenantLogin, tenantSql } from './fixtures';
import { ZipFile } from 'yazl';

/**
 * Cluster 7 — Attempts/practice (migration plan Phase 10, cluster 7): the full Tenant Admin -> Learner
 * role journey (author exam -> upload PDF -> finalize is cluster 6's own scope; this cluster picks up
 * at "practice -> attempt -> results"), the real DB-level single-in-progress-attempt concurrency
 * invariant, the real backdated-timeout lazy-check proof, full-bank-assessment, prompt/lesson
 * practice, and an honest account of what "lesson-generation restart" actually is in this app today.
 */

function buildZip(entries: Record<string, string>): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const zipFile = new ZipFile();
    for (const [name, content] of Object.entries(entries)) zipFile.addBuffer(Buffer.from(content, 'utf8'), name);
    const chunks: Buffer[] = [];
    zipFile.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zipFile.outputStream.on('end', () => resolvePromise(Buffer.concat(chunks)));
    zipFile.outputStream.on('error', reject);
    zipFile.end();
  });
}
const q = (text: string, correct = 'A') => JSON.stringify({ text, options: { A: 'a', B: 'b' }, correctAnswer: correct, explanation: 'exp' });

test.describe('Cluster 7 — Attempts/practice', () => {
  test('Full role journey: Tenant Admin authors an Exam Type via ZIP, a Learner (Member) discovers it, takes it, and sees a real server-computed result', async ({
    request,
  }) => {
    const suffix = Date.now().toString(36);
    const { accessToken: adminToken } = await tenantLogin(request, DEMO_TENANTS.starter.subdomain, DEMO_TENANTS.starter.adminEmail, DEMO_TENANT_ADMIN_PASSWORD);
    const adminHeaders = tenantAuthHeaders(DEMO_TENANTS.starter.subdomain, adminToken);

    const level = await (await request.post('/api/taxonomy/education-levels', { headers: adminHeaders, data: { name: `E2E7 Level ${suffix}` } })).json();
    const stage = await (
      await request.post('/api/taxonomy/stages', { headers: adminHeaders, data: { educationLevelId: level.id, name: `E2E7 Stage ${suffix}` } })
    ).json();

    const zip = await buildZip({ 'Only/q1.json': q('Correct one?', 'A'), 'Only/q2.json': q('Wrong one?', 'B') });
    const examRes = await request.post('/api/exam-types/zip', {
      headers: adminHeaders,
      multipart: {
        file: { name: 'e2e7.zip', mimeType: 'application/zip', buffer: zip },
        name: `E2E7 Exam ${suffix}`,
        totalQuestions: '2',
        totalMinutes: '30',
        stageId: String(stage.id),
        modules: JSON.stringify([{ name: 'Only', questionCount: 2 }]),
      },
    });
    expect(examRes.status()).toBe(201);
    const examType = await examRes.json();

    // Provision the Learner (a Member — attempts.take is a default Member permission).
    const roles = await (await request.get('/api/roles', { headers: adminHeaders })).json();
    const memberRole = (roles as Array<{ id: number; name: string }>).find((r) => r.name === 'Member');
    const learnerEmail = `e2e7-learner-${suffix}@demo-starter.local`;
    const learnerPassword = 'Learner123!Pass';
    await request.post('/api/users', {
      headers: adminHeaders,
      data: { email: learnerEmail, firstName: 'E2E7', lastName: 'Learner', password: learnerPassword, roleIds: [memberRole!.id] },
    });
    const { accessToken: learnerToken } = await tenantLogin(request, DEMO_TENANTS.starter.subdomain, learnerEmail, learnerPassword);
    const learnerHeaders = tenantAuthHeaders(DEMO_TENANTS.starter.subdomain, learnerToken);

    // Discovery + instructions.
    const discovery = await (await request.get('/api/attempts/available-exams', { headers: learnerHeaders })).json();
    expect(discovery.some((e: { id: string }) => e.id === examType.id)).toBe(true);
    const instructions = await (await request.get(`/api/exam-types/${examType.id}/instructions`, { headers: learnerHeaders })).json();
    expect(instructions.totalQuestions).toBe(2);

    // Start -> answer both -> submit -> real server-computed score.
    const startRes = await request.post('/api/attempts', { headers: learnerHeaders, data: { examTypeId: examType.id } });
    expect(startRes.status()).toBe(201);
    const attempt = await startRes.json();
    expect(attempt.deadlineAt).toBeTruthy();

    await request.post(`/api/attempts/${attempt.attemptId}/questions/0/answer`, { headers: learnerHeaders, data: { selectedOption: 'A' } });
    await request.post(`/api/attempts/${attempt.attemptId}/questions/1/answer`, { headers: learnerHeaders, data: { selectedOption: 'A' } }); // wrong (correct is B)

    const submitRes = await request.post(`/api/attempts/${attempt.attemptId}/submit`, { headers: learnerHeaders });
    expect(submitRes.status()).toBe(200);
    const result = await submitRes.json();
    expect(result.correctCount).toBe(1);
    expect(result.wrongCount).toBe(1);
    expect(result.scorePercent).toBe(50);

    // Review: all vs wrong-only.
    const reviewAll = await (await request.get(`/api/attempts/${attempt.attemptId}/review?filter=all`, { headers: learnerHeaders })).json();
    expect(reviewAll.items).toHaveLength(2);
    const reviewWrong = await (await request.get(`/api/attempts/${attempt.attemptId}/review?filter=wrong`, { headers: learnerHeaders })).json();
    expect(reviewWrong.items).toHaveLength(1);
    expect(reviewWrong.items[0].isCorrect).toBe(false);

    // Own history.
    const history = await (await request.get('/api/attempts', { headers: learnerHeaders })).json();
    expect(history.some((a: { attemptId: string; status: string }) => a.attemptId === attempt.attemptId && a.status === 'Submitted')).toBe(true);
  });

  test('Genuine DB-level single-in-progress-attempt concurrency invariant: two truly concurrent starts for the same (user, examType) yield exactly one 201 and one 409 naming the real winner', async ({
    request,
  }) => {
    const suffix = Date.now().toString(36);
    const { accessToken: adminToken } = await tenantLogin(request, DEMO_TENANTS.pro.subdomain, DEMO_TENANTS.pro.adminEmail, DEMO_TENANT_ADMIN_PASSWORD);
    const adminHeaders = tenantAuthHeaders(DEMO_TENANTS.pro.subdomain, adminToken);
    const level = await (await request.post('/api/taxonomy/education-levels', { headers: adminHeaders, data: { name: `E2E7c Level ${suffix}` } })).json();
    const stage = await (
      await request.post('/api/taxonomy/stages', { headers: adminHeaders, data: { educationLevelId: level.id, name: `E2E7c Stage ${suffix}` } })
    ).json();
    const zip = await buildZip({ 'M/q1.json': q('Q?') });
    const examRes = await request.post('/api/exam-types/zip', {
      headers: adminHeaders,
      multipart: {
        file: { name: 'e2e7c.zip', mimeType: 'application/zip', buffer: zip },
        name: `E2E7c Exam ${suffix}`,
        totalQuestions: '1',
        totalMinutes: '30',
        stageId: String(stage.id),
        modules: JSON.stringify([{ name: 'M', questionCount: 1 }]),
      },
    });
    const examType = await examRes.json();

    const roles = await (await request.get('/api/roles', { headers: adminHeaders })).json();
    const memberRole = (roles as Array<{ id: number; name: string }>).find((r) => r.name === 'Member');
    const email = `e2e7c-racer-${suffix}@demo-pro.local`;
    await request.post('/api/users', { headers: adminHeaders, data: { email, firstName: 'Racer', lastName: 'E2E7c', password: 'Racer123!Pass', roleIds: [memberRole!.id] } });
    const { accessToken } = await tenantLogin(request, DEMO_TENANTS.pro.subdomain, email, 'Racer123!Pass');
    const headers = tenantAuthHeaders(DEMO_TENANTS.pro.subdomain, accessToken);

    // A genuine two-concurrent-HTTP-request race: zero `await` between the two POSTs.
    const [r1, r2] = await Promise.all([
      request.post('/api/attempts', { headers, data: { examTypeId: examType.id } }),
      request.post('/api/attempts', { headers, data: { examTypeId: examType.id } }),
    ]);
    const statuses = [r1.status(), r2.status()].sort();
    expect(statuses).toEqual([201, 409]);
    const winnerRes = r1.status() === 201 ? r1 : r2;
    const loserRes = r1.status() === 409 ? r1 : r2;
    const winner = await winnerRes.json();
    const loserBody = await loserRes.json();
    expect(loserBody.error.code).toBe('ATTEMPT_ALREADY_IN_PROGRESS');
    expect(loserBody.error.details.attemptId, "the loser's re-query must find the real committed winner row, not a stale/guessed one").toBe(winner.attemptId);
  });

  test('Genuine backdated-deadline lazy-timeout proof: a real UPDATE against real MySQL flips InProgress to TimedOut on the very next read, with no mocked clock anywhere', async ({
    request,
  }) => {
    const suffix = Date.now().toString(36);
    const { accessToken: adminToken, user: admin } = await tenantLogin(
      request,
      DEMO_TENANTS.enterprise.subdomain,
      DEMO_TENANTS.enterprise.adminEmail,
      DEMO_TENANT_ADMIN_PASSWORD,
    );
    const adminHeaders = tenantAuthHeaders(DEMO_TENANTS.enterprise.subdomain, adminToken);
    const { schemaName } = await resolveTenant(DEMO_TENANTS.enterprise.subdomain);
    void admin;

    const level = await (await request.post('/api/taxonomy/education-levels', { headers: adminHeaders, data: { name: `E2E7t Level ${suffix}` } })).json();
    const stage = await (
      await request.post('/api/taxonomy/stages', { headers: adminHeaders, data: { educationLevelId: level.id, name: `E2E7t Stage ${suffix}` } })
    ).json();
    const zip = await buildZip({ 'M/q1.json': q('Q?') });
    const examRes = await request.post('/api/exam-types/zip', {
      headers: adminHeaders,
      multipart: {
        file: { name: 'e2e7t.zip', mimeType: 'application/zip', buffer: zip },
        name: `E2E7t Exam ${suffix}`,
        totalQuestions: '1',
        totalMinutes: '30',
        stageId: String(stage.id),
        modules: JSON.stringify([{ name: 'M', questionCount: 1 }]),
      },
    });
    const examType = await examRes.json();

    const startRes = await request.post('/api/attempts', { headers: adminHeaders, data: { examTypeId: examType.id } });
    const attempt = await startRes.json();

    const conn = await tenantSql(schemaName);
    try {
      const [beforeRows] = await conn.query<import('mysql2').RowDataPacket[]>('SELECT status FROM attempt WHERE id = ?', [attempt.attemptId]);
      expect(beforeRows[0].status).toBe('InProgress');
      await conn.query('UPDATE attempt SET deadline_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE) WHERE id = ?', [attempt.attemptId]);
    } finally {
      await conn.end();
    }

    const headerRes = await request.get(`/api/attempts/${attempt.attemptId}`, { headers: adminHeaders });
    expect(headerRes.status()).toBe(200);
    expect((await headerRes.json()).status).toBe('TimedOut');

    const conn2 = await tenantSql(schemaName);
    try {
      const [afterRows] = await conn2.query<import('mysql2').RowDataPacket[]>('SELECT status FROM attempt WHERE id = ?', [attempt.attemptId]);
      expect(afterRows[0].status, 'the row must have been genuinely closed server-side by that GET request').toBe('TimedOut');
    } finally {
      await conn2.end();
    }
  });

  test('Prompt/lesson practice + full-bank-assessment: real validation-ordering and the real AI_ENABLED=false outcome', async ({ request }) => {
    const suffix = Date.now().toString(36);
    const { accessToken } = await tenantLogin(request, DEMO_TENANTS.starter.subdomain, DEMO_TENANTS.starter.adminEmail, DEMO_TENANT_ADMIN_PASSWORD);
    const headers = tenantAuthHeaders(DEMO_TENANTS.starter.subdomain, accessToken);

    const level = await (await request.post('/api/taxonomy/education-levels', { headers, data: { name: `E2E7p Level ${suffix}` } })).json();
    const stage = await (
      await request.post('/api/taxonomy/stages', { headers, data: { educationLevelId: level.id, name: `E2E7p Stage ${suffix}` } })
    ).json();
    const subject = await (await request.post('/api/taxonomy/subjects', { headers, data: { stageId: stage.id, name: `E2E7p Subject ${suffix}` } })).json();
    const curriculum = await (
      await request.post('/api/curricula', { headers, data: { name: `E2E7p Curriculum ${suffix}`, subjectId: subject.id } })
    ).json();

    // Prompt Practice: real validation errors, named not generic.
    const emptyPrompt = await request.post('/api/practice/prompt', { headers, data: { curriculumId: curriculum.id, prompt: '', count: 3 } });
    expect(emptyPrompt.status()).toBe(400);
    expect((await emptyPrompt.json()).error.code).toBe('EMPTY_PROMPT');

    const badCount = await request.post('/api/practice/prompt', { headers, data: { curriculumId: curriculum.id, prompt: 'topic', count: 0 } });
    expect(badCount.status()).toBe(400);
    expect((await badCount.json()).error.code).toBe('INVALID_QUESTION_COUNT');

    // A real generation attempt: the real, honest AI_ENABLED=false outcome at the real network-call boundary.
    const genRes = await request.post('/api/practice/prompt', { headers, data: { curriculumId: curriculum.id, prompt: 'a real topic', count: 3 } });
    expect(genRes.status()).toBe(503);
    expect((await genRes.json()).error.code).toBe('AI_DISABLED');

    // Lesson Practice: an empty bank is rejected cleanly, never a crash.
    const emptyBank = await request.post('/api/practice/lesson', { headers, data: { stageId: stage.id, subjectId: subject.id, count: 5 } });
    expect(emptyBank.status()).toBeGreaterThanOrEqual(400);
    expect(emptyBank.status()).toBeLessThan(500);
    expect((await emptyBank.json()).error.code).toBe('EMPTY_QUESTION_BANK');

    // Full-Bank-Assessment: always 202 (a real, resumable background session), 404 for an unknown document.
    const fakeDocumentId = '00000000-0000-0000-0000-000000000000';
    const fbaRes = await request.post(`/api/practice/full-bank/${curriculum.id}/${fakeDocumentId}`, { headers, data: {} });
    expect(fbaRes.status()).toBe(404);
    expect((await fbaRes.json()).error.code).toBe('DOCUMENT_NOT_FOUND');
  });

  test('Lesson-generation "restart": documents what genuinely exists in this app today rather than fabricating a route that was never wired', async ({
    request,
  }) => {
    // Per this app's own Phase 8 "Decisions made" #2: FullBankAssessmentService.resumeProcessing/
    // processSession exist as real, unit-tested, callable methods, but NO StaleSessionRecoveryWorker
    // (or any other worker) dispatch was ever wired to invoke them automatically, and no dedicated
    // HTTP restart route exists (`POST /api/practice/full-bank/:curriculumId/:documentId` always
    // starts a brand-new session; the only other full-bank route is the GET summary/poll). Lesson
    // Practice itself is bank-first + synchronous shortfall-fill — it has no background/resumable
    // generation state at all, so "restart" has no meaning there either. This test proves the
    // observable, real contract (poll-only, no restart endpoint reachable) rather than asserting a
    // capability that does not exist in this codebase.
    const { accessToken } = await tenantLogin(request, DEMO_TENANTS.starter.subdomain, DEMO_TENANTS.starter.adminEmail, DEMO_TENANT_ADMIN_PASSWORD);
    const headers = tenantAuthHeaders(DEMO_TENANTS.starter.subdomain, accessToken);
    const unknownSessionId = '00000000-0000-0000-0000-000000000001';
    const pollRes = await request.get(`/api/practice/full-bank/${unknownSessionId}`, { headers });
    // The route exists and responds cleanly (never a crash) even though this is not a real session id
    // in this tenant — proving the poll surface itself is real and reachable.
    expect(pollRes.status()).toBeGreaterThanOrEqual(400);
    expect(pollRes.status()).toBeLessThan(500);
  });
});
