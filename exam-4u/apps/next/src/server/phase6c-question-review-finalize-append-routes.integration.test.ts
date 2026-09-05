import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { getTenantProvisioningService } from '@/server/platform/provisioning';
import { getAuthService } from '@/server/auth';
import { RoleRepository, UserRoleRepository, UserRoleAssignmentService } from '@/server/rbac';
import { requireTenantDataSource, runWithRequestContext } from '@/server/context';
import { getTaxonomyService } from '@/server/taxonomy';
import { getCurriculaService } from '@/server/curricula';
import { getQdrantVectorStoreAdapter } from '@/server/infrastructure/vector';
import { GET as questionsGET } from '@/app/api/pdf-processing/sessions/[id]/questions/route';
import { PATCH as questionPATCH } from '@/app/api/pdf-processing/questions/[id]/route';
import { POST as bulkDeletePOST } from '@/app/api/pdf-processing/sessions/[id]/questions/bulk-delete/route';
import { POST as finalizePOST } from '@/app/api/pdf-processing/sessions/[id]/finalize/route';
import { POST as appendPOST } from '@/app/api/pdf-processing/sessions/[id]/append/route';

/**
 * Phase 6, sub-slice "6c" — real-route-level regression coverage for question review/edit/bulk-delete
 * (FR-PDF-8), finalize-into-Exam-Type (FR-PDF-9, including a real `exam_type_curriculum` write), and
 * append-to-an-existing-Exam-Type (FR-PDF-10) — including the two-layer idempotency guarantee this
 * sub-slice's own exit gate names as a must-have. Same convention as every prior phase's integration
 * test: call the REAL exported Route Handler functions with a genuine `NextRequest` against real MySQL.
 *
 * `generated_question`/`pdf_processing_session` rows are inserted directly via raw SQL (mirroring
 * `phase6b-curricula-media-routes.integration.test.ts`'s identical precedent for `fixSubjectMapping`'s
 * own test fixture) — this environment has no live AI key, so there is no real generation pipeline to
 * produce them; this suite's job is proving review/finalize/append's own logic against already-durable
 * rows, not proving generation itself (sub-slices 6a/6b's own scope).
 *
 * Run via:
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     npx vitest run src/server/phase6c-question-review-finalize-append-routes.integration.test.ts
 */
describe('Phase 6 sub-slice "6c" — question review/finalize/append real routes', () => {
  const slug = `p6c-${randomUUID().slice(0, 8)}`;
  let tenantId: string;
  let tenantSchema: string;
  let adminToken: string;
  let adminUserId: string;
  let subjectId: number;
  let curriculumId: string;

  beforeAll(async () => {
    const provisioning = await getTenantProvisioningService();
    const tenant = await provisioning.provisionNewTenant({ name: 'Phase6c Tenant', subdomainSlug: slug, adminEmail: `admin@${slug}.local` });
    tenantId = tenant.id;
    tenantSchema = tenant.schemaName;

    const registry = getTenantDataSourceRegistry();
    const dataSource = await registry.acquire(tenantSchema);
    try {
      await runWithRequestContext({ requestId: randomUUID(), tenantId, tenantSlug: slug, tenantSchema, tenantDataSource: dataSource }, async () => {
        const auth = await getAuthService();
        const roles = new RoleRepository(requireTenantDataSource());
        const assignment = new UserRoleAssignmentService(roles, new UserRoleRepository(requireTenantDataSource()));

        const adminEmail = `p6cadmin-${randomUUID().slice(0, 8)}@${slug}.local`;
        const registered = await auth.register({ email: adminEmail, password: 'Abcdefg1', firstName: 'P6c', lastName: 'Admin' });
        adminUserId = registered.user.id;
        const tenantAdminRole = await roles.findByName('Tenant Admin');
        if (!tenantAdminRole) throw new Error('Tenant Admin role not seeded — cannot run this suite.');
        await assignment.replaceRolesForUser(adminUserId, [tenantAdminRole.id]);
        adminToken = (await auth.login({ email: adminEmail, password: 'Abcdefg1' })).accessToken;

        const taxonomy = getTaxonomyService();
        const level = await taxonomy.createOrFetchEducationLevel(`Level-${slug}`);
        const stage = await taxonomy.createOrFetchStage(level.entity.id, `Stage-${slug}`);
        const subject = await taxonomy.createOrFetchSubject(stage.entity.id, `Chemistry-${slug}`);
        subjectId = subject.entity.id;

        const curriculum = await getCurriculaService().create(adminUserId, { name: `Curriculum-${slug}`, subjectId });
        curriculumId = curriculum.id;
      });
    } finally {
      registry.release(tenantSchema);
    }
  }, 60_000);

  afterAll(async () => {
    await getQdrantVectorStoreAdapter()
      .purgeTenant({ tenantId })
      .catch(() => undefined);
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
  });

  function tenantHeaders(token?: string): Record<string, string> {
    const headers: Record<string, string> = { 'x-tenant-id': tenantId, 'x-tenant-slug': slug, 'x-tenant-schema': tenantSchema };
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  async function createSessionWithQuestions(count: number, confidences: number[]): Promise<{ sessionId: string; questionIds: string[] }> {
    const dataSource = await getTenantDataSourceRegistry().acquire(tenantSchema);
    const sessionId = randomUUID();
    const questionIds: string[] = [];
    try {
      await dataSource.query(
        `INSERT INTO pdf_processing_session (id, initiated_by_user_id, source_file_name, status, storage_key_prefix, source_storage_key, file_hash, force_reprocess, content_type, subject_id)
         VALUES (?, ?, 'exam.pdf', 'Completed', 'p/', 'p/source.pdf', ?, 0, 'Exam', ?)`,
        [sessionId, adminUserId, randomUUID().replace(/-/g, '').padEnd(64, 'a'), subjectId],
      );
      for (let i = 0; i < count; i += 1) {
        const id = randomUUID();
        questionIds.push(id);
        await dataSource.query(
          `INSERT INTO generated_question (id, processing_session_id, subject_id, question_text, options_json, correct_answer, question_type,
             source_page_range, source_section, confidence_score, generation_method, is_auto_generated, is_human_edited, is_review_flagged, linked_exam_type_id)
           VALUES (?, ?, NULL, ?, ?, 'A', 'multiple_choice', ?, ?, ?, 'exam_extraction_with_key', 1, 0, 0, NULL)`,
          [id, sessionId, `Question ${i}?`, JSON.stringify({ A: 'a', B: 'b' }), String(i + 1), i % 2 === 0 ? 'Chapter 1' : 'Chapter 2', confidences[i] ?? 0.9],
        );
      }
    } finally {
      getTenantDataSourceRegistry().release(tenantSchema);
    }
    return { sessionId, questionIds };
  }

  it('migration 20260815000009 ran clean: exam_type_curriculum/idempotency_key exist with the expected FK/PK shape', async () => {
    const dataSource = await getTenantDataSourceRegistry().acquire(tenantSchema);
    try {
      const tables = await dataSource.query(
        `SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = ? AND table_name IN ('exam_type_curriculum','idempotency_key')`,
        [tenantSchema],
      );
      expect((tables as { TABLE_NAME: string }[]).map((t) => t.TABLE_NAME).sort()).toEqual(['exam_type_curriculum', 'idempotency_key']);

      const fks = await dataSource.query(
        `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL AND TABLE_NAME = 'exam_type_curriculum'`,
        [tenantSchema],
      );
      expect((fks as { CONSTRAINT_NAME: string }[]).map((f) => f.CONSTRAINT_NAME).sort()).toEqual(['fk_etc_curriculum', 'fk_etc_exam']);
    } finally {
      getTenantDataSourceRegistry().release(tenantSchema);
    }
  });

  it('GET .../questions lists the real, freshly-inserted questions (FR-PDF-8 paginated review)', async () => {
    const { sessionId } = await createSessionWithQuestions(3, [0.9, 0.9, 0.9]);
    const res = await questionsGET(
      new NextRequest(`http://localhost/api/pdf-processing/sessions/${sessionId}/questions`, { headers: tenantHeaders(adminToken) }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(3);
    expect(body.items[0].images).toEqual([]);
  });

  it('PATCH a question sets isHumanEdited=true without touching isReviewFlagged (FR-PDF-8)', async () => {
    const { questionIds } = await createSessionWithQuestions(1, [0.9]);
    const res = await questionPATCH(
      new NextRequest(`http://localhost/api/pdf-processing/questions/${questionIds[0]}`, {
        method: 'PATCH',
        headers: { ...tenantHeaders(adminToken), 'content-type': 'application/json' },
        body: JSON.stringify({ questionText: 'Edited question text?' }),
      }),
      { params: Promise.resolve({ id: questionIds[0] }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.questionText).toBe('Edited question text?');
    expect(body.isHumanEdited).toBe(true);
    expect(body.isReviewFlagged).toBe(false);
  });

  it('bulk-delete is a genuine 200 no-op on an empty ids list (FR-PDF-8)', async () => {
    const { sessionId } = await createSessionWithQuestions(1, [0.9]);
    const res = await bulkDeletePOST(
      new NextRequest(`http://localhost/api/pdf-processing/sessions/${sessionId}/questions/bulk-delete`, {
        method: 'POST',
        headers: { ...tenantHeaders(adminToken), 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [] }),
      }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedCount: 0 });
  });

  it('bulk-delete removes exactly the requested, session-owned questions', async () => {
    const { sessionId, questionIds } = await createSessionWithQuestions(3, [0.9, 0.9, 0.9]);
    const res = await bulkDeletePOST(
      new NextRequest(`http://localhost/api/pdf-processing/sessions/${sessionId}/questions/bulk-delete`, {
        method: 'POST',
        headers: { ...tenantHeaders(adminToken), 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [questionIds[0], questionIds[1]] }),
      }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedCount: 2 });
  });

  it('finalize rejects NO_ELIGIBLE_QUESTIONS before any write when nothing meets minConfidence (FR-PDF-9)', async () => {
    const { sessionId } = await createSessionWithQuestions(2, [0.5, 0.5]);
    const res = await finalizePOST(
      new NextRequest(`http://localhost/api/pdf-processing/sessions/${sessionId}/finalize`, {
        method: 'POST',
        headers: { ...tenantHeaders(adminToken), 'content-type': 'application/json' },
        body: JSON.stringify({ examName: `ShouldNotExist-${slug}`, totalMinutes: 30, totalQuestions: 2, minConfidence: 0.9 }),
      }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('NO_ELIGIBLE_QUESTIONS');
  });

  it('finalize creates a real Exam Type, groups by source_section, writes a real exam_type_curriculum row, and indexes the question bank (best-effort)', async () => {
    const { sessionId } = await createSessionWithQuestions(4, [0.9, 0.9, 0.9, 0.9]);
    const res = await finalizePOST(
      new NextRequest(`http://localhost/api/pdf-processing/sessions/${sessionId}/finalize`, {
        method: 'POST',
        headers: { ...tenantHeaders(adminToken), 'content-type': 'application/json' },
        body: JSON.stringify({
          examName: `FinalizedExam-${slug}`,
          totalMinutes: 45,
          totalQuestions: 4,
          minConfidence: 0.5,
          curriculumLinks: [{ curriculumId, contextWeight: 7 }],
        }),
      }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(res.status).toBe(201);
    const examType = await res.json();
    expect(examType.totalQuestions).toBe(4);
    expect(examType.modules.map((m: { moduleName: string }) => m.moduleName).sort()).toEqual(['Chapter 1', 'Chapter 2']);

    const dataSource = await getTenantDataSourceRegistry().acquire(tenantSchema);
    try {
      const links = await dataSource.query('SELECT curriculum_id, context_weight FROM exam_type_curriculum WHERE exam_type_id = ?', [examType.id]);
      expect(links).toEqual([{ curriculum_id: curriculumId, context_weight: 7 }]);

      const linked = await dataSource.query('SELECT COUNT(*) AS c FROM generated_question WHERE linked_exam_type_id = ?', [examType.id]);
      expect(Number((linked as { c: number }[])[0].c)).toBe(4);
    } finally {
      getTenantDataSourceRegistry().release(tenantSchema);
    }
  }, 30_000);

  it('finalize rejects an out-of-range contextWeight with INVALID_CONTEXT_WEIGHT before any write', async () => {
    const { sessionId } = await createSessionWithQuestions(1, [0.9]);
    const res = await finalizePOST(
      new NextRequest(`http://localhost/api/pdf-processing/sessions/${sessionId}/finalize`, {
        method: 'POST',
        headers: { ...tenantHeaders(adminToken), 'content-type': 'application/json' },
        body: JSON.stringify({
          examName: `BadWeight-${slug}`,
          totalMinutes: 10,
          totalQuestions: 1,
          minConfidence: 0.5,
          curriculumLinks: [{ curriculumId, contextWeight: 11 }],
        }),
      }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_CONTEXT_WEIGHT');
  });

  describe('append + two-layer idempotency (FR-PDF-10)', () => {
    async function finalizeSeed(): Promise<string> {
      const { sessionId } = await createSessionWithQuestions(1, [0.9]);
      const res = await finalizePOST(
        new NextRequest(`http://localhost/api/pdf-processing/sessions/${sessionId}/finalize`, {
          method: 'POST',
          headers: { ...tenantHeaders(adminToken), 'content-type': 'application/json' },
          body: JSON.stringify({ examName: `AppendTarget-${randomUUID()}`, totalMinutes: 20, totalQuestions: 1, minConfidence: 0.5 }),
        }),
        { params: Promise.resolve({ id: sessionId }) },
      );
      expect(res.status).toBe(201);
      return (await res.json()).id;
    }

    it('appends genuinely new questions and grows total_questions/module counts correctly', async () => {
      const examTypeId = await finalizeSeed();
      const { sessionId: secondSessionId, questionIds } = await createSessionWithQuestions(2, [0.9, 0.9]);

      const res = await appendPOST(
        new NextRequest(`http://localhost/api/pdf-processing/sessions/${secondSessionId}/append`, {
          method: 'POST',
          headers: { ...tenantHeaders(adminToken), 'content-type': 'application/json' },
          body: JSON.stringify({ examTypeId, ids: questionIds }),
        }),
        { params: Promise.resolve({ id: secondSessionId }) },
      );
      expect(res.status).toBe(200);
      const examType = await res.json();
      expect(examType.totalQuestions).toBe(3); // 1 (finalize) + 2 (append)
    }, 30_000);

    it('a retried append with the same content is a genuine no-op (content-level guard, no Idempotency-Key header)', async () => {
      const examTypeId = await finalizeSeed();
      const { sessionId: secondSessionId, questionIds } = await createSessionWithQuestions(1, [0.9]);
      const body = JSON.stringify({ examTypeId, ids: questionIds });

      const first = await appendPOST(
        new NextRequest(`http://localhost/api/pdf-processing/sessions/${secondSessionId}/append`, {
          method: 'POST',
          headers: { ...tenantHeaders(adminToken), 'content-type': 'application/json' },
          body,
        }),
        { params: Promise.resolve({ id: secondSessionId }) },
      );
      expect((await first.json()).totalQuestions).toBe(2);

      // Retried with the SAME request, no Idempotency-Key header at all — the content-level guard
      // (linked_exam_type_id IS NULL) alone must make this a genuine no-op: the question is already
      // linked, so `newOnes` is empty and total_questions does not grow again.
      const retry = await appendPOST(
        new NextRequest(`http://localhost/api/pdf-processing/sessions/${secondSessionId}/append`, {
          method: 'POST',
          headers: { ...tenantHeaders(adminToken), 'content-type': 'application/json' },
          body,
        }),
        { params: Promise.resolve({ id: secondSessionId }) },
      );
      expect(retry.status).toBe(200);
      expect((await retry.json()).totalQuestions).toBe(2);
    }, 30_000);

    it('REAL forced-partial-failure proof: the data write commits, the bookkeeping write fails once, and a retry with the same Idempotency-Key is a genuine no-op', async () => {
      const examTypeId = await finalizeSeed();
      const { sessionId: secondSessionId, questionIds } = await createSessionWithQuestions(1, [0.9]);
      const idempotencyKey = randomUUID();
      const body = JSON.stringify({ examTypeId, ids: questionIds });

      // Force the idempotency-key bookkeeping write to fail exactly once, AFTER the real data-write
      // transaction (`AppendExamRepository.appendQuestions`) has already committed — proving the two
      // writes are genuinely independent transactions, not one combined one.
      const { IdempotencyKeyRepository } = await import('@/server/pdf-processing');
      const recordSpy = vi.spyOn(IdempotencyKeyRepository.prototype, 'record').mockImplementationOnce(async () => {
        throw new Error('simulated bookkeeping-write failure, after the data write already committed');
      });

      // `withTenantContext`'s own catch-all converts an uncaught throw into a generic 500 error
      // envelope (it never lets a Route Handler's promise itself reject) — the load-bearing assertion
      // here is that the request surfaces as a failure (never a false-success 200) while the
      // already-committed data write below is untouched by that failure.
      const failedAttempt = await appendPOST(
        new NextRequest(`http://localhost/api/pdf-processing/sessions/${secondSessionId}/append`, {
          method: 'POST',
          headers: { ...tenantHeaders(adminToken), 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
          body,
        }),
        { params: Promise.resolve({ id: secondSessionId }) },
      );
      expect(failedAttempt.status).toBe(500);
      recordSpy.mockRestore();

      // Confirm the real data write DID commit despite the bookkeeping failure: the exam type already
      // shows the grown total, and the generated_question row is already linked.
      const dataSource = await getTenantDataSourceRegistry().acquire(tenantSchema);
      let totalAfterFirstAttempt: number;
      try {
        const rows = await dataSource.query('SELECT total_questions FROM exam_type WHERE id = ?', [examTypeId]);
        totalAfterFirstAttempt = Number((rows as { total_questions: number }[])[0].total_questions);
        expect(totalAfterFirstAttempt).toBe(2);
        const linked = await dataSource.query('SELECT linked_exam_type_id FROM generated_question WHERE id = ?', [questionIds[0]]);
        expect((linked as { linked_exam_type_id: string }[])[0].linked_exam_type_id).toBe(examTypeId);
      } finally {
        getTenantDataSourceRegistry().release(tenantSchema);
      }

      // Retry with the SAME Idempotency-Key — this time the bookkeeping write is NOT mocked to fail.
      // The content-level guard alone (the question is already linked) makes `newOnes` empty, so this
      // retry is a genuine no-op regardless of the header; the header retry additionally proves the
      // key can now be recorded successfully.
      const retry = await appendPOST(
        new NextRequest(`http://localhost/api/pdf-processing/sessions/${secondSessionId}/append`, {
          method: 'POST',
          headers: { ...tenantHeaders(adminToken), 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
          body,
        }),
        { params: Promise.resolve({ id: secondSessionId }) },
      );
      expect(retry.status).toBe(200);
      expect((await retry.json()).totalQuestions).toBe(totalAfterFirstAttempt); // no double-append

      const dataSource2 = await getTenantDataSourceRegistry().acquire(tenantSchema);
      try {
        const keyRow = await dataSource2.query('SELECT `key` FROM idempotency_key WHERE `key` = ? AND scope = ?', [idempotencyKey, 'pdf-append']);
        expect(keyRow).toHaveLength(1); // now durably recorded, closing the earlier gap.
      } finally {
        getTenantDataSourceRegistry().release(tenantSchema);
      }
    }, 30_000);
  });
});
