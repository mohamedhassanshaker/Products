import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { getTenantProvisioningService } from '@/server/platform/provisioning';
import { getAuthService } from '@/server/auth';
import { RoleRepository, RolesService, UserRoleRepository, UserRoleAssignmentService, PermissionRepository } from '@/server/rbac';
import { requireTenantDataSource, runWithRequestContext } from '@/server/context';
import { ExamAuthoringRepository, type ExamTypeInsert } from '@/server/exam-authoring';
import { POST as startPOST, GET as historyGET } from '@/app/api/attempts/route';
import { GET as headerGET } from '@/app/api/attempts/[id]/route';
import { GET as questionGET } from '@/app/api/attempts/[id]/questions/[index]/route';
import { POST as answerPOST } from '@/app/api/attempts/[id]/questions/[index]/answer/route';
import { POST as submitPOST } from '@/app/api/attempts/[id]/submit/route';
import { GET as reviewGET } from '@/app/api/attempts/[id]/review/route';
import { GET as instructionsGET } from '@/app/api/exam-types/[id]/instructions/route';
import { GET as availableExamsGET } from '@/app/api/attempts/available-exams/route';
import { runAttemptTimeoutSweep } from '@/server/workers/attempt-timeout-sweeper';

/**
 * Phase 7 ("Attempts") — real-route-level regression coverage for `app/api/attempts/**`/
 * `app/api/exam-types/[id]/instructions`, matching every prior phase's
 * `phaseN-*-routes.integration.test.ts` convention: call the REAL exported Route Handler functions
 * with a genuine `NextRequest` (trusted `x-tenant-*` headers + a real bearer token) against real
 * MySQL, not the service layer directly.
 *
 * Also the permanent regression test for this dispatch's new `ATTEMPTS_BARREL_ONLY` ESLint
 * module-boundary rule — importing `@/app/api/attempts/**` route files above proves that scope is
 * correct (a bare `**\/attempts/**` pattern would have incorrectly rejected these).
 *
 * Run via:
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     npx vitest run src/server/phase7-attempts-routes.integration.test.ts
 */
describe('Phase 7 — /api/attempts/** real routes (real MySQL, real JWT, real concurrency)', () => {
  const slug = `p7-${randomUUID().slice(0, 8)}`;
  let tenantId: string;
  let tenantSchema: string;
  let learnerToken: string;
  let noPermissionToken: string;
  let examTypeId: string;

  beforeAll(async () => {
    const provisioning = await getTenantProvisioningService();
    const tenant = await provisioning.provisionNewTenant({ name: 'Phase7 Tenant', subdomainSlug: slug, adminEmail: `admin@${slug}.local` });
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

        // The seeded 'Member' role already holds attempts.take/attempts.read_own (SeedRbacStep) — used
        // as this suite's learner principal.
        const learnerEmail = `p7learner-${randomUUID().slice(0, 8)}@${slug}.local`;
        const learnerRegistered = await auth.register({ email: learnerEmail, password: 'Abcdefg1', firstName: 'P7', lastName: 'Learner' });
        const memberRole = await roles.findByName('Member');
        if (!memberRole) throw new Error('Member role not seeded — cannot run this suite.');
        await assignment.replaceRolesForUser(learnerRegistered.user.id, [memberRole.id]);
        learnerToken = (await auth.login({ email: learnerEmail, password: 'Abcdefg1' })).accessToken;

        // A real role with zero permission grants — proves the 403 FORBIDDEN path against a genuine
        // authenticated-but-unauthorized caller.
        const emptyRole = await rolesService.create({ name: `NoPerms-${slug}`, description: 'no permissions', permissionIds: [] });
        const noPermEmail = `p7noperm-${randomUUID().slice(0, 8)}@${slug}.local`;
        const noPermRegistered = await auth.register({ email: noPermEmail, password: 'Abcdefg1', firstName: 'P7', lastName: 'NoPerm' });
        await assignment.replaceRolesForUser(noPermRegistered.user.id, [emptyRole.id]);
        noPermissionToken = (await auth.login({ email: noPermEmail, password: 'Abcdefg1' })).accessToken;

        // A real, finalized-shape Exam Type with one module of 3 candidate questions (bank headroom
        // above the module's questionCount=2, so adaptive selection never shortfalls) — inserted
        // directly via ExamAuthoringRepository (the same repository the manual-ZIP flow uses), not a
        // second seeding mechanism.
        examTypeId = randomUUID();
        const examTypeRepo = new ExamAuthoringRepository(requireTenantDataSource());
        const insert: ExamTypeInsert = {
          examType: {
            id: examTypeId,
            name: `Phase7 Exam ${slug}`,
            description: 'Integration-test exam type',
            totalQuestions: 2,
            totalMinutes: 10,
            storagePath: null,
            stageId: null,
            storageMode: 'LocalDisk',
            kind: 'Standard',
            origin: 'ZipImport',
            createdByUserId: null,
            pendingDeleteAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as never,
          modules: [{ id: randomUUID(), examTypeId, moduleName: 'Module A', questionCount: 2 } as never],
          questions: [1, 2, 3].map(
            (n) =>
              ({
                id: randomUUID(),
                examTypeId,
                moduleName: 'Module A',
                questionKey: `q-${slug}-${n}`,
                questionText: `What is ${n} + ${n}?`,
                optionsJson: { A: String(n), B: String(n * 2) },
                correctAnswer: 'B',
                explanation: `${n}+${n}=${n * 2}`,
                sourceGeneratedQuestionId: null,
                createdAt: new Date(),
                updatedAt: new Date(),
              }) as never,
          ),
        };
        await examTypeRepo.insertExamType(insert);
      });
    } finally {
      registry.release(tenantSchema);
    }
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
  });

  function tenantHeaders(token?: string): Record<string, string> {
    const headers: Record<string, string> = { 'x-tenant-id': tenantId, 'x-tenant-slug': slug, 'x-tenant-schema': tenantSchema };
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  function req(path: string, opts: { method?: string; token?: string; body?: unknown } = {}): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
      method: opts.method ?? 'GET',
      headers: { ...tenantHeaders(opts.token), ...(opts.body ? { 'content-type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  }

  it('migration ran clean: attempt/attempt_question tables exist with the expected FK/unique-key shape', async () => {
    const dataSource = await getTenantDataSourceRegistry().acquire(tenantSchema);
    try {
      const tables = await dataSource.query(
        "SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = ? AND table_name IN ('attempt','attempt_question')",
        [tenantSchema],
      );
      expect((tables as { TABLE_NAME: string }[]).map((t) => t.TABLE_NAME).sort()).toEqual(['attempt', 'attempt_question']);

      const fks = await dataSource.query(
        `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL AND TABLE_NAME = 'attempt_question'`,
        [tenantSchema],
      );
      expect((fks as { CONSTRAINT_NAME: string }[]).map((f) => f.CONSTRAINT_NAME)).toEqual(['fk_aq_attempt']);

      const uniques = await dataSource.query(
        `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'attempt' AND NON_UNIQUE = 0 AND INDEX_NAME != 'PRIMARY'`,
        [tenantSchema],
      );
      expect((uniques as { INDEX_NAME: string }[]).map((u) => u.INDEX_NAME)).toEqual(['uq_attempt_active']);
    } finally {
      getTenantDataSourceRegistry().release(tenantSchema);
    }
  });

  it('rejects an unauthenticated request to GET /api/attempts/available-exams', async () => {
    const res = await availableExamsGET(req('/api/attempts/available-exams'));
    expect(res.status).toBe(401);
  });

  it('rejects a caller without attempts.take from starting an attempt (403 FORBIDDEN)', async () => {
    const res = await startPOST(req('/api/attempts', { method: 'POST', token: noPermissionToken, body: { examTypeId } }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
  });

  it('discovery lists the seeded Exam Type and instructions return its module shape', async () => {
    const listRes = await availableExamsGET(req('/api/attempts/available-exams', { token: learnerToken }));
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.some((e: { id: string }) => e.id === examTypeId)).toBe(true);

    const instrRes = await instructionsGET(req(`/api/exam-types/${examTypeId}/instructions`, { token: learnerToken }), {
      params: Promise.resolve({ id: examTypeId }),
    });
    expect(instrRes.status).toBe(200);
    const instr = await instrRes.json();
    expect(instr.modules).toEqual([{ moduleName: 'Module A', questionCount: 2 }]);
  });

  it('EXAM_TYPE_NOT_FOUND for a genuinely unknown Exam Type', async () => {
    const res = await startPOST(req('/api/attempts', { method: 'POST', token: learnerToken, body: { examTypeId: randomUUID() } }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('EXAM_TYPE_NOT_FOUND');
  });

  let attemptId: string;

  it('full happy path: start -> header -> question -> answer -> submit -> review (all/wrong) -> history', async () => {
    const startRes = await startPOST(req('/api/attempts', { method: 'POST', token: learnerToken, body: { examTypeId } }));
    expect(startRes.status).toBe(201);
    const start = await startRes.json();
    expect(start.totalQuestions).toBe(2);
    expect(new Date(start.deadlineAt).getTime() - new Date(start.startTime).getTime()).toBe(10 * 60_000);
    attemptId = start.attemptId;

    const headerRes = await headerGET(req(`/api/attempts/${attemptId}`, { token: learnerToken }), { params: Promise.resolve({ id: attemptId }) });
    expect(headerRes.status).toBe(200);
    expect((await headerRes.json()).status).toBe('InProgress');

    const q0Res = await questionGET(req(`/api/attempts/${attemptId}/questions/0`, { token: learnerToken }), {
      params: Promise.resolve({ id: attemptId, index: '0' }),
    });
    expect(q0Res.status).toBe(200);
    const q0 = await q0Res.json();
    expect(q0.questionIndex).toBe(0);

    // Answer question 0 correctly (option "B" is always correct in this suite's seeded bank), question
    // 1 incorrectly — so the review's wrong-only filter has exactly one row to prove against.
    const answer0Res = await answerPOST(req(`/api/attempts/${attemptId}/questions/0/answer`, { method: 'POST', token: learnerToken, body: { selectedOption: 'B' } }), {
      params: Promise.resolve({ id: attemptId, index: '0' }),
    });
    expect(answer0Res.status).toBe(200);
    const answer1Res = await answerPOST(req(`/api/attempts/${attemptId}/questions/1/answer`, { method: 'POST', token: learnerToken, body: { selectedOption: 'A' } }), {
      params: Promise.resolve({ id: attemptId, index: '1' }),
    });
    expect(answer1Res.status).toBe(200);

    const submitRes = await submitPOST(req(`/api/attempts/${attemptId}/submit`, { method: 'POST', token: learnerToken }), {
      params: Promise.resolve({ id: attemptId }),
    });
    expect(submitRes.status).toBe(200);
    const submitBody = await submitRes.json();
    expect(submitBody.status).toBe('Submitted');
    expect(submitBody.correctCount).toBe(1);
    expect(submitBody.wrongCount).toBe(1);
    expect(submitBody.scorePercent).toBe(50);

    // Submitting again is now rejected — the attempt is no longer InProgress.
    const resubmitRes = await submitPOST(req(`/api/attempts/${attemptId}/submit`, { method: 'POST', token: learnerToken }), {
      params: Promise.resolve({ id: attemptId }),
    });
    expect(resubmitRes.status).toBe(409);
    expect((await resubmitRes.json()).error.code).toBe('ATTEMPT_NOT_IN_PROGRESS');

    const reviewAllRes = await reviewGET(req(`/api/attempts/${attemptId}/review?filter=all`, { token: learnerToken }), {
      params: Promise.resolve({ id: attemptId }),
    });
    expect(reviewAllRes.status).toBe(200);
    expect((await reviewAllRes.json()).items).toHaveLength(2);

    const reviewWrongRes = await reviewGET(req(`/api/attempts/${attemptId}/review?filter=wrong`, { token: learnerToken }), {
      params: Promise.resolve({ id: attemptId }),
    });
    expect(reviewWrongRes.status).toBe(200);
    const reviewWrong = await reviewWrongRes.json();
    expect(reviewWrong.items).toHaveLength(1);
    expect(reviewWrong.items[0].isCorrect).toBe(false);

    const historyRes = await historyGET(req('/api/attempts', { token: learnerToken }));
    expect(historyRes.status).toBe(200);
    const history = await historyRes.json();
    expect(history.some((h: { attemptId: string; status: string }) => h.attemptId === attemptId && h.status === 'Submitted')).toBe(true);
  });

  it('starting a second attempt for a Submitted attempt is allowed (not "already in progress")', async () => {
    const res = await startPOST(req('/api/attempts', { method: 'POST', token: learnerToken, body: { examTypeId } }));
    expect(res.status).toBe(201);
    const second = await res.json();
    // Immediately submit it so it doesn't interfere with the concurrency race test below.
    await submitPOST(req(`/api/attempts/${second.attemptId}/submit`, { method: 'POST', token: learnerToken }), {
      params: Promise.resolve({ id: second.attemptId }),
    });
  });

  it('REAL two-concurrent-HTTP-request race proves the uq_attempt_active DB invariant (not sequential calls)', async () => {
    // Two genuinely concurrent POST /api/attempts calls for the identical (user, examType) pair — no
    // await between them, so both requests reach `AttemptsRepository.insertAttempt` before either has
    // committed. Exactly one must win with 201; the other must lose to the database's own
    // `uq_attempt_active` unique key (not a pre-check race avoided by mere request ordering).
    const [resA, resB] = await Promise.all([
      startPOST(req('/api/attempts', { method: 'POST', token: learnerToken, body: { examTypeId } })),
      startPOST(req('/api/attempts', { method: 'POST', token: learnerToken, body: { examTypeId } })),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winnerRes = resA.status === 201 ? resA : resB;
    const loserRes = resA.status === 201 ? resB : resA;
    const winnerBody = await winnerRes.json();
    const loserBody = await loserRes.json();
    expect(loserBody.error.code).toBe('ATTEMPT_ALREADY_IN_PROGRESS');
    // The loser's error carries the WINNER's real, resumable attempt id — proving the loser's
    // re-query-after-duplicate-key path found the actual committed row, not a stale/guessed id.
    expect(loserBody.error.details.attemptId).toBe(winnerBody.attemptId);

    // Clean up: submit the real winning attempt so later tests in this file start from a clean slate.
    await submitPOST(req(`/api/attempts/${winnerBody.attemptId}/submit`, { method: 'POST', token: learnerToken }), {
      params: Promise.resolve({ id: winnerBody.attemptId }),
    });
  });

  it('REAL backdated deadline_at proves the lazy-timeout path applies before a read (no mocked clock)', async () => {
    const startRes = await startPOST(req('/api/attempts', { method: 'POST', token: learnerToken, body: { examTypeId } }));
    expect(startRes.status).toBe(201);
    const { attemptId: lazyAttemptId } = await startRes.json();

    // Directly backdate deadline_at in real MySQL — no mocked Date/clock anywhere in this test or the
    // service under test; `AttemptsService.applyLazyTimeout` compares against `Date.now()` for real.
    const dataSource = await getTenantDataSourceRegistry().acquire(tenantSchema);
    try {
      await dataSource.query('UPDATE attempt SET deadline_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE) WHERE id = ?', [lazyAttemptId]);

      const beforeRows = await dataSource.query('SELECT status FROM attempt WHERE id = ?', [lazyAttemptId]);
      expect((beforeRows as { status: string }[])[0].status).toBe('InProgress');

      // The very next read (GET header) must observe TimedOut, closed by the lazy path as a side
      // effect of THIS call — not by any background sweep (the worker process is not running here).
      const headerRes = await headerGET(req(`/api/attempts/${lazyAttemptId}`, { token: learnerToken }), {
        params: Promise.resolve({ id: lazyAttemptId }),
      });
      expect(headerRes.status).toBe(200);
      expect((await headerRes.json()).status).toBe('TimedOut');

      const afterRows = await dataSource.query('SELECT status, score_percent FROM attempt WHERE id = ?', [lazyAttemptId]);
      expect((afterRows as { status: string }[])[0].status).toBe('TimedOut');
    } finally {
      getTenantDataSourceRegistry().release(tenantSchema);
    }
  });

  it('AttemptTimeoutSweeper backstop: a real standalone sweep closes a stuck InProgress attempt whose deadline already passed', async () => {
    const startRes = await startPOST(req('/api/attempts', { method: 'POST', token: learnerToken, body: { examTypeId } }));
    expect(startRes.status).toBe(201);
    const { attemptId: stuckAttemptId } = await startRes.json();

    const dataSource = await getTenantDataSourceRegistry().acquire(tenantSchema);
    try {
      await dataSource.query('UPDATE attempt SET deadline_at = DATE_SUB(NOW(3), INTERVAL 5 MINUTE) WHERE id = ?', [stuckAttemptId]);
      const beforeRows = await dataSource.query('SELECT status FROM attempt WHERE id = ?', [stuckAttemptId]);
      expect((beforeRows as { status: string }[])[0].status).toBe('InProgress');
    } finally {
      getTenantDataSourceRegistry().release(tenantSchema);
    }

    // A real, standalone full sweep across every Active tenant — not the lazy path, no direct call
    // into AttemptsService/AttemptsRepository from this test.
    await runAttemptTimeoutSweep();

    const dataSource2 = await getTenantDataSourceRegistry().acquire(tenantSchema);
    try {
      const afterRows = await dataSource2.query('SELECT status FROM attempt WHERE id = ?', [stuckAttemptId]);
      expect((afterRows as { status: string }[])[0].status).toBe('TimedOut');
    } finally {
      getTenantDataSourceRegistry().release(tenantSchema);
    }
  }, 30_000);
});
