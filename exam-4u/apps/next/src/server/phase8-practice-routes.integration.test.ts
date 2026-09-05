import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformDataSource, getTenantDataSourceRegistry, GeneratedQuestionEntity, PdfProcessingSessionEntity } from '@/server/infrastructure/database';
import { getTenantProvisioningService } from '@/server/platform/provisioning';
import { getAuthService } from '@/server/auth';
import { RoleRepository, RolesService, UserRoleRepository, UserRoleAssignmentService, PermissionRepository } from '@/server/rbac';
import { requireTenantDataSource, runWithRequestContext } from '@/server/context';
import { POST as promptPOST } from '@/app/api/practice/prompt/route';
import { POST as lessonPOST } from '@/app/api/practice/lesson/route';
import { GET as sessionGET } from '@/app/api/practice/sessions/[id]/route';
import { POST as answerPOST } from '@/app/api/practice/sessions/[id]/answer/route';
import { POST as fullBankStartPOST } from '@/app/api/practice/full-bank/[curriculumId]/[documentId]/route';
import { POST as levelsPOST } from '@/app/api/taxonomy/education-levels/route';
import { POST as stagesPOST } from '@/app/api/taxonomy/stages/route';
import { POST as subjectsPOST } from '@/app/api/taxonomy/subjects/route';
import { POST as curriculaCreatePOST } from '@/app/api/curricula/route';

/**
 * Phase 8 ("Practice — prompt/lesson/full-bank") — real-route-level regression coverage for
 * `app/api/practice/**`, matching every prior phase's `phaseN-*-routes.integration.test.ts`
 * convention: call the REAL exported Route Handler functions with a genuine `NextRequest`, against
 * real MySQL, not the service layer directly.
 *
 * Also the permanent regression test for this dispatch's new `PRACTICE_BARREL_ONLY` ESLint
 * module-boundary rule — importing `@/app/api/practice/**` route files above proves that scope is
 * correct (a bare `**\/practice/**` pattern would have incorrectly rejected these).
 *
 * **AI-disabled environment**: this environment has `AI_ENABLED=false`/no live OpenRouter key
 * (re-confirmed this dispatch, matching every AI-consuming phase since Phase 5's own standard) — so
 * this suite proves everything up to the real network-call boundary: validation ordering, RBAC,
 * ownership, the bank-only (no-shortfall-needed) Lesson Practice path against real, directly-inserted
 * `generated_question` rows (both subject-scoped and curriculum-scoped, the latter proving the new
 * `findPackagedForDocument`/`findPackagedForCurriculum` joins through `pdf_processing_session`), the
 * real `practice_session`/`practice_question` migration DDL, and the real `503 AI_DISABLED` outcome a
 * genuine shortfall produces when the AI service is unavailable — exactly the standard `Phase 5`'s own
 * plan doc establishes.
 *
 * Run via:
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     EMBEDDINGS_PROVIDER=null npx vitest run src/server/phase8-practice-routes.integration.test.ts
 */
describe('Phase 8 — /api/practice/** real routes (real MySQL, real JWT)', () => {
  const slug = `p8-${randomUUID().slice(0, 8)}`;
  let tenantId: string;
  let tenantSchema: string;
  let adminToken: string;
  let memberToken: string;
  let memberUserId: string;
  let noPermissionToken: string;
  let stageId: number;
  let subjectId: number;
  let curriculumId: string;

  beforeAll(async () => {
    const provisioning = await getTenantProvisioningService();
    const tenant = await provisioning.provisionNewTenant({ name: 'Phase8 Tenant', subdomainSlug: slug, adminEmail: `admin@${slug}.local` });
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
        const rolesService = new RolesService(roles, new PermissionRepository(requireTenantDataSource()), userRoles);

        const adminEmail = `p8admin-${randomUUID().slice(0, 8)}@${slug}.local`;
        const adminRegistered = await auth.register({ email: adminEmail, password: 'Abcdefg1', firstName: 'P8', lastName: 'Admin' });
        const tenantAdminRole = await roles.findByName('Tenant Admin');
        if (!tenantAdminRole) throw new Error('Tenant Admin role not seeded.');
        await assignment.replaceRolesForUser(adminRegistered.user.id, [tenantAdminRole.id]);
        adminToken = (await auth.login({ email: adminEmail, password: 'Abcdefg1' })).accessToken;

        const memberEmail = `p8member-${randomUUID().slice(0, 8)}@${slug}.local`;
        const memberRegistered = await auth.register({ email: memberEmail, password: 'Abcdefg1', firstName: 'P8', lastName: 'Member' });
        memberUserId = memberRegistered.user.id;
        const memberRole = await roles.findByName('Member');
        if (!memberRole) throw new Error('Member role not seeded.');
        await assignment.replaceRolesForUser(memberUserId, [memberRole.id]);
        memberToken = (await auth.login({ email: memberEmail, password: 'Abcdefg1' })).accessToken;

        const emptyRole = await rolesService.create({ name: `NoPerms-${slug}`, description: 'no permissions', permissionIds: [] });
        const noPermEmail = `p8noperm-${randomUUID().slice(0, 8)}@${slug}.local`;
        const noPermRegistered = await auth.register({ email: noPermEmail, password: 'Abcdefg1', firstName: 'P8', lastName: 'NoPerm' });
        await assignment.replaceRolesForUser(noPermRegistered.user.id, [emptyRole.id]);
        noPermissionToken = (await auth.login({ email: noPermEmail, password: 'Abcdefg1' })).accessToken;
      });
    } finally {
      registry.release(tenantSchema);
    }

    // Real taxonomy hierarchy + Curriculum via the real routes (Phase 3), not raw inserts.
    const levelRes = await levelsPOST(req('http://localhost/api/taxonomy/education-levels', 'POST', adminToken, { name: `Secondary ${slug}` }));
    expect(levelRes.status).toBe(201);
    const educationLevelId = (await levelRes.json()).id as number;

    const stageRes = await stagesPOST(req('http://localhost/api/taxonomy/stages', 'POST', adminToken, { name: `Grade ${slug}`, educationLevelId }));
    expect(stageRes.status).toBe(201);
    stageId = (await stageRes.json()).id as number;

    const subjectRes = await subjectsPOST(req('http://localhost/api/taxonomy/subjects', 'POST', adminToken, { name: `Math ${slug}`, stageId }));
    expect(subjectRes.status).toBe(201);
    subjectId = (await subjectRes.json()).id as number;

    const curriculumRes = await curriculaCreatePOST(req('http://localhost/api/curricula', 'POST', memberToken, { name: `Curriculum ${slug}`, subjectId }));
    expect(curriculumRes.status).toBe(201);
    curriculumId = (await curriculumRes.json()).id as string;
  }, 90_000);

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
  });

  function req(url: string, method: string, token: string | undefined, body: unknown): NextRequest {
    const headers: Record<string, string> = { 'x-tenant-id': tenantId, 'x-tenant-slug': slug, 'x-tenant-schema': tenantSchema };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    return new NextRequest(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }

  it('information_schema: practice_session/practice_question exist with the expected FK, and pdf_processing_session carries the new full-bank columns', async () => {
    const platformDs = await getPlatformDataSource();
    const tables = (await platformDs.query(
      `SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = ? AND table_name IN ('practice_session','practice_question')`,
      [tenantSchema],
    )) as { TABLE_NAME: string }[];
    expect(tables.map((t) => t.TABLE_NAME).sort()).toEqual(['practice_question', 'practice_session']);

    const fks = (await platformDs.query(
      `SELECT CONSTRAINT_NAME FROM information_schema.table_constraints WHERE table_schema = ? AND table_name = 'practice_question' AND constraint_type = 'FOREIGN KEY'`,
      [tenantSchema],
    )) as { CONSTRAINT_NAME: string }[];
    expect(fks.map((f) => f.CONSTRAINT_NAME)).toEqual(['fk_pq_session']);

    const cols = (await platformDs.query(
      `SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = ? AND table_name = 'pdf_processing_session' AND COLUMN_NAME IN ('session_kind','target_question_count','target_total_minutes')`,
      [tenantSchema],
    )) as { COLUMN_NAME: string }[];
    expect(cols.map((c) => c.COLUMN_NAME).sort()).toEqual(['session_kind', 'target_question_count', 'target_total_minutes']);
  });

  it('rejects an unauthenticated request to POST /api/practice/prompt', async () => {
    const res = await promptPOST(req('http://localhost/api/practice/prompt', 'POST', undefined, { curriculumId, prompt: 'x', count: 1 }));
    expect(res.status).toBe(401);
  });

  it('400 EMPTY_PROMPT for a whitespace-only prompt', async () => {
    const res = await promptPOST(req('http://localhost/api/practice/prompt', 'POST', memberToken, { curriculumId, prompt: '   ', count: 5 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('EMPTY_PROMPT');
  });

  it('400 INVALID_QUESTION_COUNT for count outside [1,30]', async () => {
    const res = await promptPOST(req('http://localhost/api/practice/prompt', 'POST', memberToken, { curriculumId, prompt: 'topic', count: 0 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_QUESTION_COUNT');
  });

  it('404 CURRICULUM_NOT_FOUND for a genuinely unknown curriculum id', async () => {
    const res = await promptPOST(req('http://localhost/api/practice/prompt', 'POST', memberToken, { curriculumId: randomUUID(), prompt: 'topic', count: 5 }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('CURRICULUM_NOT_FOUND');
  });

  it('503 AI_DISABLED when a genuine generation request reaches the (env-disabled) AI service', async () => {
    const res = await promptPOST(req('http://localhost/api/practice/prompt', 'POST', memberToken, { curriculumId, prompt: 'topic', count: 3 }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('AI_DISABLED');
  });

  it('400 INVALID_QUESTION_COUNT for Lesson Practice, and 422 EMPTY_QUESTION_BANK when the resolved bank is genuinely empty', async () => {
    const badCount = await lessonPOST(req('http://localhost/api/practice/lesson', 'POST', memberToken, { stageId, subjectId, count: 0 }));
    expect(badCount.status).toBe(400);

    const emptyBank = await lessonPOST(req('http://localhost/api/practice/lesson', 'POST', memberToken, { stageId, subjectId, count: 2 }));
    expect(emptyBank.status).toBe(422);
    expect((await emptyBank.json()).error.code).toBe('EMPTY_QUESTION_BANK');
  });

  it('subject-scoped Lesson Practice: bank-only (no shortfall), real diversity-selected, real persisted practice_session/practice_question, then real answer', async () => {
    // Insert real, already-finalized generated_question rows directly (mirrors how Finalize/Append
    // would have produced them) — two questions is exactly `count`, so no AI shortfall-fill call is
    // ever attempted (this environment's AI is disabled, so this is the only path fully provable here).
    const registry = getTenantDataSourceRegistry();
    const dataSource = await registry.acquire(tenantSchema);
    try {
      // `generated_question.processing_session_id` is FK-bound to a real `pdf_processing_session` row
      // (`fk_gq_session`) — two minimal, already-`Completed` sessions stand in for what
      // Finalize/Append would have produced.
      const sessionRepo = dataSource.getRepository<PdfProcessingSessionEntity>('pdf_processing_session');
      const backingSessionIds = [randomUUID(), randomUUID()];
      await sessionRepo.insert(
        backingSessionIds.map(
          (id) =>
            ({
              id,
              initiatedByUserId: memberUserId,
              sourceFileName: 'doc.pdf',
              contentTypeHint: null,
              contentType: 'Lesson',
              status: 'Completed',
              errorMessage: null,
              errorCode: null,
              totalQuestions: 1,
              successfulQuestions: 1,
              detectedTopics: null,
              estimatedQuestionsPerPage: null,
              storageKeyPrefix: `tenants/${tenantId}/pdf/${id}/`,
              sourceStorageKey: 'k',
              subjectId,
              curriculumId: null,
              curriculumDocumentId: null,
              fileHash: randomUUID(),
              forceReprocess: false,
              reusedFromSessionId: null,
              pageCount: 1,
              tokensUsed: 0,
              totalCost: 0,
              budgetExhausted: false,
              lastCompletedPage: 1,
              coveredConcepts: null,
              resumeAttempts: 0,
              workerId: null,
              heartbeatAt: null,
              completedAt: new Date(),
            }) as PdfProcessingSessionEntity,
        ),
      );

      const repo = dataSource.getRepository<GeneratedQuestionEntity>('generated_question');
      const rows = [1, 2].map(
        (n) =>
          ({
            id: randomUUID(),
            processingSessionId: backingSessionIds[n - 1],
            subjectId,
            questionText: `Subject-scoped Q${n}`,
            optionsJson: { A: 'a', B: 'b' },
            correctAnswer: 'A',
            explanation: `exp ${n}`,
            questionType: 'multiple_choice',
            bloomsLevel: 2,
            sourcePageRange: null,
            sourceSection: null,
            answerSource: null,
            confidenceScore: 0.9,
            generationMethod: 'lesson_generation',
            isAutoGenerated: true,
            isHumanEdited: false,
            isReviewFlagged: false,
            notes: null,
            linkedExamTypeId: randomUUID(), // "already finalized"
            batchIndex: 0,
          }) as unknown as GeneratedQuestionEntity,
      );
      await repo.insert(rows);
    } finally {
      registry.release(tenantSchema);
    }

    const genRes = await lessonPOST(req('http://localhost/api/practice/lesson', 'POST', memberToken, { stageId, subjectId, count: 2 }));
    expect(genRes.status).toBe(200);
    const generated = await genRes.json();
    expect(generated.status).toBe('completed');
    expect(generated.questions).toHaveLength(2);
    const sessionId = generated.sessionId as string;

    const sessionRes = await sessionGET(req(`http://localhost/api/practice/sessions/${sessionId}`, 'GET', memberToken, undefined), {
      params: Promise.resolve({ id: sessionId }),
    } as never);
    expect(sessionRes.status).toBe(200);
    expect((await sessionRes.json()).questions).toHaveLength(2);

    const answerRes = await answerPOST(
      req(`http://localhost/api/practice/sessions/${sessionId}/answer`, 'POST', memberToken, { position: 0, selectedOption: 'A' }),
      { params: Promise.resolve({ id: sessionId }) } as never,
    );
    expect(answerRes.status).toBe(200);
    const answered = await answerRes.json();
    expect(answered.isCorrect).toBe(true);
  });

  it('curriculum-scoped Lesson Practice joins through pdf_processing_session.curriculum_document_id/curriculum_id (real multi-document-synthesis query)', async () => {
    const registry = getTenantDataSourceRegistry();
    const dataSource = await registry.acquire(tenantSchema);
    try {
      const sessionRepo = dataSource.getRepository<PdfProcessingSessionEntity>('pdf_processing_session');
      const sessionId = randomUUID();
      await sessionRepo.insert({
        id: sessionId,
        initiatedByUserId: memberUserId,
        sourceFileName: 'doc.pdf',
        contentTypeHint: null,
        contentType: 'Lesson',
        status: 'Completed',
        errorMessage: null,
        errorCode: null,
        totalQuestions: 1,
        successfulQuestions: 1,
        detectedTopics: null,
        estimatedQuestionsPerPage: null,
        storageKeyPrefix: `tenants/${tenantId}/pdf/${sessionId}/`,
        sourceStorageKey: 'k',
        subjectId,
        curriculumId,
        curriculumDocumentId: null,
        fileHash: randomUUID(),
        forceReprocess: false,
        reusedFromSessionId: null,
        pageCount: 1,
        tokensUsed: 0,
        totalCost: 0,
        budgetExhausted: false,
        lastCompletedPage: 1,
        coveredConcepts: null,
        resumeAttempts: 0,
        workerId: null,
        heartbeatAt: null,
        completedAt: new Date(),
      } as PdfProcessingSessionEntity);

      const questionRepo = dataSource.getRepository<GeneratedQuestionEntity>('generated_question');
      await questionRepo.insert({
        id: randomUUID(),
        processingSessionId: sessionId,
        subjectId: null,
        questionText: 'Curriculum-scoped Q1',
        optionsJson: { A: 'a', B: 'b' },
        correctAnswer: 'B',
        explanation: 'exp',
        questionType: 'multiple_choice',
        bloomsLevel: 3,
        sourcePageRange: null,
        sourceSection: null,
        answerSource: null,
        confidenceScore: 0.9,
        generationMethod: 'full_bank_assessment',
        isAutoGenerated: true,
        isHumanEdited: false,
        isReviewFlagged: false,
        notes: null,
        linkedExamTypeId: randomUUID(),
        batchIndex: 0,
      } as unknown as GeneratedQuestionEntity);
    } finally {
      registry.release(tenantSchema);
    }

    const res = await lessonPOST(req('http://localhost/api/practice/lesson', 'POST', memberToken, { stageId, subjectId, curriculumId, count: 1 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.questions).toHaveLength(1);
    expect(body.questions[0].questionText).toBe('Curriculum-scoped Q1');
  });

  it('403 FORBIDDEN for a zero-permission role attempting POST /api/practice/full-bank/:curriculumId/:documentId', async () => {
    const res = await fullBankStartPOST(
      req(`http://localhost/api/practice/full-bank/${curriculumId}/${randomUUID()}`, 'POST', noPermissionToken, {}),
      { params: Promise.resolve({ curriculumId, documentId: randomUUID() }) } as never,
    );
    expect(res.status).toBe(403);
  });

  it('404 DOCUMENT_NOT_FOUND for POST /api/practice/full-bank/:curriculumId/:documentId naming a nonexistent document', async () => {
    const documentId = randomUUID();
    const res = await fullBankStartPOST(req(`http://localhost/api/practice/full-bank/${curriculumId}/${documentId}`, 'POST', memberToken, {}), {
      params: Promise.resolve({ curriculumId, documentId }),
    } as never);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('DOCUMENT_NOT_FOUND');
  });
});
