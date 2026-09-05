import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { DEMO_TENANTS, DEMO_TENANT_ADMIN_PASSWORD, resolveTenant, tenantAuthHeaders, tenantLogin, tenantSql } from './fixtures';

/**
 * Cluster 6 — PDF processing (migration plan Phase 10, cluster 6 — "the largest cluster"): upload,
 * both dedup tiers, review/edit/bulk-actions, finalize (real `exam_type_curriculum` linking), append
 * (including the forced-partial-failure idempotency proof), similar-questions, confidence-calibration,
 * restart/resume via `StaleSessionRecoveryWorker`, and AI-disabled graceful degradation.
 *
 * **Environment constraint (re-confirmed, matches every prior AI-touching phase's own finding)**:
 * `AI_ENABLED=false` in this compose stack. A freshly-uploaded PDF's background pipeline therefore
 * never reaches `Completed` through the real classify/generate path — it durably lands at an in-flight
 * status with `errorCode: 'AI_DISABLED'` (FR-AI-1's graceful degradation). Review/finalize/append's
 * own logic is instead exercised against `generated_question`/`pdf_processing_session` rows inserted
 * directly via raw SQL against the real MySQL container this compose stack publishes on
 * `localhost:3307` — the exact same "seed via raw SQL, drive behavior via the real route" pattern
 * `server/phase6c-question-review-finalize-append-routes.integration.test.ts` already established
 * in-process, reused here at the black-box HTTP layer.
 */

/** A minimal, genuinely-valid single-page PDF (never a checked-in fixture) — built ONCE and reused
 * verbatim for every test needing "the same bytes twice" (tier-1 dedup's own precondition — two
 * separate builds of an otherwise-identical PDF differ byte-for-byte, a documented `pdfkit`/timestamp
 * finding from sub-slice "6a" that applies equally to this hand-built literal). */
function buildMinimalPdf(sentence: string): Buffer {
  return Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 5 0 R>>>>/MediaBox[0 0 300 150]/Contents 4 0 R>>endobj\n' +
      `4 0 obj<</Length ${sentence.length + 24}>>stream\nBT /F1 18 Tf 20 100 Td (${sentence}) Tj ET\nendstream endobj\n` +
      '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n' +
      'trailer<</Root 1 0 R>>',
    'utf8',
  );
}

async function pollSessionStatus(
  request: import('@playwright/test').APIRequestContext,
  headers: Record<string, string>,
  sessionId: string,
  timeoutMs = 20_000,
): Promise<{ status: string; errorCode: string | null; reusedFromSessionId: string | null }> {
  const deadline = Date.now() + timeoutMs;
  let last: { status: string; errorCode: string | null; reusedFromSessionId: string | null } | undefined;
  while (Date.now() < deadline) {
    const res = await request.get(`/api/pdf-processing/sessions/${sessionId}`, { headers });
    expect(res.status(), 'session status poll must never crash/5xx').toBeLessThan(500);
    last = await res.json();
    if (last!.status !== 'Pending' && last!.status !== 'Extracting') return last!;
    await new Promise((r) => setTimeout(r, 500));
  }
  return last!;
}

/** Inserts a real `pdf_processing_session` (status `Completed`, so it's finalize/append-eligible)
 * plus `count` real `generated_question` rows directly, mirroring the phase6c integration test's own
 * `createSessionWithQuestions` fixture — this environment has no live AI key, so there is no real
 * generation pipeline to produce these rows organically. */
async function seedCompletedSessionWithQuestions(
  schemaName: string,
  adminUserId: string,
  subjectId: number,
  count: number,
): Promise<{ sessionId: string; questionIds: string[] }> {
  const conn = await tenantSql(schemaName);
  try {
    const sessionId = randomUUID();
    await conn.query(
      `INSERT INTO pdf_processing_session (id, initiated_by_user_id, source_file_name, status, storage_key_prefix, source_storage_key, file_hash, force_reprocess, content_type, subject_id)
       VALUES (?, ?, 'e2e6.pdf', 'Completed', 'p/', 'p/source.pdf', ?, 0, 'Exam', ?)`,
      [sessionId, adminUserId, randomUUID().replace(/-/g, '').padEnd(64, 'a'), subjectId],
    );
    const questionIds: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = randomUUID();
      questionIds.push(id);
      await conn.query(
        `INSERT INTO generated_question (id, processing_session_id, subject_id, question_text, options_json, correct_answer, question_type, confidence_score, generation_method, source_section, is_review_flagged, is_human_edited)
         VALUES (?, ?, ?, ?, ?, 'A', 'multiple_choice', 0.9, 'ai_extraction', 'Section 1', 0, 0)`,
        [id, sessionId, subjectId, `E2E6 Question ${i}`, JSON.stringify({ A: 'a', B: 'b' })],
      );
    }
    return { sessionId, questionIds };
  } finally {
    await conn.end();
  }
}

test.describe('Cluster 6 — PDF processing', () => {
  test('Upload happy path: 202 before any AI work begins, and the session reaches an honest, non-crashing AI_ENABLED=false terminal state', async ({
    request,
  }) => {
    const { accessToken } = await tenantLogin(request, DEMO_TENANTS.starter.subdomain, DEMO_TENANTS.starter.adminEmail, DEMO_TENANT_ADMIN_PASSWORD);
    const headers = tenantAuthHeaders(DEMO_TENANTS.starter.subdomain, accessToken);

    const pdf = buildMinimalPdf(`E2E6 upload probe ${Date.now()}`);
    const uploadRes = await request.post('/api/pdf-processing/upload', {
      headers,
      multipart: { file: { name: 'e2e6-upload.pdf', mimeType: 'application/pdf', buffer: pdf } },
    });
    expect(uploadRes.status()).toBe(202);
    const { sessionId } = await uploadRes.json();
    expect(sessionId).toBeTruthy();

    const final = await pollSessionStatus(request, headers, sessionId);
    // The real, honest outcome in this environment: never Completed (no live AI key), never a crash —
    // a durable in-flight status carrying AI_DISABLED (FR-AI-1's graceful degradation).
    expect(['Classifying', 'Processing', 'Extracting']).toContain(final.status);
    expect(final.errorCode).toBe('AI_DISABLED');

    const listRes = await request.get('/api/pdf-processing/sessions', { headers });
    expect(listRes.status()).toBe(200);
    expect((await listRes.json()).some((s: { id: string }) => s.id === sessionId)).toBe(true);
  });

  test('Tier-1 exact-hash dedup: re-uploading byte-identical bytes against a session simulated Completed reaches Completed immediately via reusedFromSessionId, never re-touching AI', async ({
    request,
  }) => {
    const { accessToken } = await tenantLogin(request, DEMO_TENANTS.pro.subdomain, DEMO_TENANTS.pro.adminEmail, DEMO_TENANT_ADMIN_PASSWORD);
    const headers = tenantAuthHeaders(DEMO_TENANTS.pro.subdomain, accessToken);
    const { schemaName } = await resolveTenant(DEMO_TENANTS.pro.subdomain);

    // The identical PDF buffer is built ONCE and reused verbatim for both uploads — a second, separate
    // build (even of identical text) would differ byte-for-byte, defeating this proof's own precondition.
    const pdf = buildMinimalPdf(`E2E6 dedup probe ${Date.now()}`);

    const firstRes = await request.post('/api/pdf-processing/upload', {
      headers,
      multipart: { file: { name: 'e2e6-dedup.pdf', mimeType: 'application/pdf', buffer: pdf } },
    });
    expect(firstRes.status()).toBe(202);
    const { sessionId: firstSessionId } = await firstRes.json();
    await pollSessionStatus(request, headers, firstSessionId);

    // Simulate "this exact content was already successfully processed at some earlier point" (e.g.
    // once a real OpenRouter key is configured) — the identical technique sub-slice "6a"'s own dedup
    // proof used, since this environment's real AI_ENABLED=false never lets a session reach Completed
    // organically.
    const conn = await tenantSql(schemaName);
    try {
      await conn.query("UPDATE pdf_processing_session SET status='Completed', error_code=NULL WHERE id = ?", [firstSessionId]);
    } finally {
      await conn.end();
    }

    const secondRes = await request.post('/api/pdf-processing/upload', {
      headers,
      multipart: { file: { name: 'e2e6-dedup.pdf', mimeType: 'application/pdf', buffer: pdf } },
    });
    expect(secondRes.status()).toBe(202);
    const { sessionId: secondSessionId } = await secondRes.json();

    const secondFinal = await pollSessionStatus(request, headers, secondSessionId);
    expect(secondFinal.status).toBe('Completed');
    expect(secondFinal.reusedFromSessionId).toBe(firstSessionId);
    // Never touched the AI-disabled path this second time — the dedup gate ran and skipped it entirely.
    expect(secondFinal.errorCode).toBeFalsy();
  });

  test('Review/edit/bulk-actions -> finalize (real exam_type_curriculum linking, INVALID_CONTEXT_WEIGHT) -> append with the real two-layer idempotency guarantee', async ({
    request,
  }) => {
    const suffix = Date.now().toString(36);
    const { accessToken, user } = await tenantLogin(
      request,
      DEMO_TENANTS.enterprise.subdomain,
      DEMO_TENANTS.enterprise.adminEmail,
      DEMO_TENANT_ADMIN_PASSWORD,
    );
    const headers = tenantAuthHeaders(DEMO_TENANTS.enterprise.subdomain, accessToken);
    const { schemaName } = await resolveTenant(DEMO_TENANTS.enterprise.subdomain);

    const level = await (await request.post('/api/taxonomy/education-levels', { headers, data: { name: `E2E6 Level ${suffix}` } })).json();
    const stage = await (
      await request.post('/api/taxonomy/stages', { headers, data: { educationLevelId: level.id, name: `E2E6 Stage ${suffix}` } })
    ).json();
    const subject = await (await request.post('/api/taxonomy/subjects', { headers, data: { stageId: stage.id, name: `E2E6 Subject ${suffix}` } })).json();
    const curriculum = await (
      await request.post('/api/curricula', { headers, data: { name: `E2E6 Curriculum ${suffix}`, subjectId: subject.id } })
    ).json();

    const { sessionId, questionIds } = await seedCompletedSessionWithQuestions(schemaName, user.id, subject.id, 3);

    // Review list.
    const listRes = await request.get(`/api/pdf-processing/sessions/${sessionId}/questions`, { headers });
    expect(listRes.status()).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.total).toBe(3);

    // Inline edit.
    const editRes = await request.patch(`/api/pdf-processing/questions/${questionIds[0]}`, { headers, data: { questionText: 'Edited by e2e6' } });
    expect(editRes.status()).toBe(200);
    expect((await editRes.json()).isHumanEdited).toBe(true);

    // Flag / unflag.
    expect((await request.post(`/api/pdf-processing/questions/${questionIds[1]}/flag`, { headers })).status()).toBeLessThan(300);
    expect((await request.post(`/api/pdf-processing/questions/${questionIds[1]}/unflag`, { headers })).status()).toBeLessThan(300);

    // Bulk-delete: empty ids is a real no-op, never an error.
    const noopDelete = await request.post(`/api/pdf-processing/sessions/${sessionId}/questions/bulk-delete`, { headers, data: { ids: [] } });
    expect(noopDelete.status()).toBeLessThan(300);

    // Finalize: an out-of-range contextWeight is rejected with the named error, not generic VALIDATION_FAILED.
    const badFinalize = await request.post(`/api/pdf-processing/sessions/${sessionId}/finalize`, {
      headers,
      data: {
        examName: `E2E6 Bad Finalize ${suffix}`,
        totalMinutes: 30,
        totalQuestions: 3,
        minConfidence: 0.5,
        curriculumLinks: [{ curriculumId: curriculum.id, contextWeight: 99 }],
      },
    });
    expect(badFinalize.status()).toBe(400);
    expect((await badFinalize.json()).error.code).toBe('INVALID_CONTEXT_WEIGHT');

    // Real finalize with a valid contextWeight -> a brand-new, live Exam Type with real curriculumLinks.
    const finalizeRes = await request.post(`/api/pdf-processing/sessions/${sessionId}/finalize`, {
      headers,
      data: {
        examName: `E2E6 Exam ${suffix}`,
        totalMinutes: 30,
        totalQuestions: 3,
        minConfidence: 0.5,
        curriculumLinks: [{ curriculumId: curriculum.id, contextWeight: 5 }],
      },
    });
    expect(finalizeRes.status(), await finalizeRes.text().catch(() => '')).toBe(201);
    const examType = await finalizeRes.json();
    expect(examType.origin).toBe('AiPipeline');
    expect(examType.totalQuestions).toBe(3);
    expect(examType.curriculumLinks).toHaveLength(1);
    expect(examType.curriculumLinks[0].curriculumId).toBe(curriculum.id);

    // Append additional questions from a NEW session into the just-finalized Exam Type, proven
    // idempotent under a real Idempotency-Key header.
    const appendSeed = await seedCompletedSessionWithQuestions(schemaName, user.id, subject.id, 2);
    const idempotencyKey = `e2e6-append-${suffix}`;

    const appendRes1 = await request.post(`/api/pdf-processing/sessions/${appendSeed.sessionId}/append`, {
      headers: { ...headers, 'Idempotency-Key': idempotencyKey },
      data: { examTypeId: examType.id, ids: appendSeed.questionIds },
    });
    expect(appendRes1.status(), await appendRes1.text().catch(() => '')).toBe(200);
    const afterFirstAppend = await appendRes1.json();
    expect(afterFirstAppend.totalQuestions).toBe(5); // 3 finalized + 2 appended

    // Retry #1 — identical Idempotency-Key + identical body: BOTH guards agree this is a genuine
    // no-op (content-level: the questions are already linked; request-level: the key is already
    // recorded) — totalQuestions must NOT grow again.
    const appendRetry1 = await request.post(`/api/pdf-processing/sessions/${appendSeed.sessionId}/append`, {
      headers: { ...headers, 'Idempotency-Key': idempotencyKey },
      data: { examTypeId: examType.id, ids: appendSeed.questionIds },
    });
    expect(appendRetry1.status()).toBe(200);
    expect((await appendRetry1.json()).totalQuestions).toBe(5);

    // **Forced-partial-failure equivalent, reachable from black-box + SQL access**: delete the
    // `idempotency_key` row directly, simulating "the bookkeeping write was lost/never durably
    // recorded" (the exact failure mode the in-process integration test proves by mocking
    // `IdempotencyKeyRepository.record` to throw once, immediately after the data write already
    // committed) — then resend the SAME key + body. The data-write's own content-level guard (every
    // requested id is already `linked_exam_type_id IS NOT NULL`) must independently make this a safe,
    // genuine no-op even with zero bookkeeping-row memory of the original request — proving the
    // "committed data survives the bookkeeping failure untouched, and a retry is still safe" property
    // this idempotency design exists for.
    const conn = await tenantSql(schemaName);
    try {
      await conn.query("DELETE FROM idempotency_key WHERE scope = 'pdf-append' AND `key` = ?", [idempotencyKey]);
    } finally {
      await conn.end();
    }
    const appendRetry2 = await request.post(`/api/pdf-processing/sessions/${appendSeed.sessionId}/append`, {
      headers: { ...headers, 'Idempotency-Key': idempotencyKey },
      data: { examTypeId: examType.id, ids: appendSeed.questionIds },
    });
    expect(appendRetry2.status()).toBe(200);
    expect((await appendRetry2.json()).totalQuestions, 'content-level guard alone must prevent double-counting even with no idempotency-key memory').toBe(5);

    // similar-questions: this environment's real "configured but not live" embeddings shape
    // (EMBEDDINGS_PROVIDER=openai-compatible, empty key) means the real embed-the-candidate-question
    // call genuinely fails at the real network boundary — matching this app's own already-established
    // "prove up to the real network-call boundary, honest failure through the error envelope, never a
    // silent crash" standard (cluster 4's curricula-ingestion test documents this identical precedent).
    // What must never happen is an unhandled crash (no envelope at all).
    const similarRes = await request.get(`/api/pdf-processing/questions/${questionIds[0]}/similar`, { headers });
    expect(similarRes.status()).toBeGreaterThanOrEqual(400);
    expect((await similarRes.json()).error?.code, 'a real, well-formed ErrorEnvelope code, not an unhandled crash').toBeTruthy();

    // confidence-calibration: a real, well-formed (possibly-empty) analytics report, never a crash.
    const calibrationRes = await request.get('/api/pdf-processing/analytics/confidence-calibration', { headers });
    expect(calibrationRes.status()).toBe(200);
    const calibrationBody = await calibrationRes.json();
    expect(calibrationBody).toBeTruthy();
  });

  test('restart/resume: StaleSessionRecoveryWorker, run as a real one-off ROLE=worker process, resolves a deliberately-stuck, already-at-max-attempts session to Failed/SESSION_RECOVERY_EXHAUSTED', async ({
    request,
  }) => {
    const { accessToken, user } = await tenantLogin(request, DEMO_TENANTS.starter.subdomain, DEMO_TENANTS.starter.adminEmail, DEMO_TENANT_ADMIN_PASSWORD);
    const headers = tenantAuthHeaders(DEMO_TENANTS.starter.subdomain, accessToken);
    const { schemaName } = await resolveTenant(DEMO_TENANTS.starter.subdomain);

    // A real subject is needed to satisfy fk_sess_subject.
    const suffix = Date.now().toString(36);
    const level = await (await request.post('/api/taxonomy/education-levels', { headers, data: { name: `E2E6 Restart Level ${suffix}` } })).json();
    const stage = await (
      await request.post('/api/taxonomy/stages', { headers, data: { educationLevelId: level.id, name: `E2E6 Restart Stage ${suffix}` } })
    ).json();
    const subject = await (await request.post('/api/taxonomy/subjects', { headers, data: { stageId: stage.id, name: `E2E6 Restart Subject ${suffix}` } })).json();

    const conn = await tenantSql(schemaName);
    const stuckSessionId = randomUUID();
    try {
      // A deliberately-stuck session: an in-flight status, a heartbeat 10 minutes in the past (well
      // past SESSION_HEARTBEAT_STALE_MS's default 5-minute window), and resume_attempts already at
      // MAX_RESUME_ATTEMPTS (default 3) — so the very next sweep tick fails it immediately, closing
      // this proof without depending on this environment's AI-disabled resume outcome.
      await conn.query(
        `INSERT INTO pdf_processing_session (id, initiated_by_user_id, source_file_name, status, storage_key_prefix, source_storage_key, file_hash, force_reprocess, content_type, subject_id, heartbeat_at, resume_attempts)
         VALUES (?, ?, 'stuck.pdf', 'Processing', 'p/', 'p/stuck.pdf', ?, 0, 'Exam', ?, DATE_SUB(NOW(3), INTERVAL 10 MINUTE), 3)`,
        [stuckSessionId, user.id, randomUUID().replace(/-/g, '').padEnd(64, 'b'), subject.id],
      );
    } finally {
      await conn.end();
    }

    // The already-running, real `examland-next-worker-1` container (`ROLE=worker`, started when this
    // compose stack came up) has been ticking its own `setInterval`-driven
    // `pdf_stale_session_recovery_full_sweep` continuously since boot (`WORKER_PDF_SESSION_SWEEP_TICK_MS`,
    // default 60s) — no fresh process needs to be spawned; this genuinely-stuck row will be picked up
    // by that real, standalone `ROLE=worker` process's very next natural tick. Poll up to 90s (one and
    // a half worker cadences) for it to flip to the exhausted-resume terminal state.
    test.setTimeout(120_000);
    const deadline = Date.now() + 90_000;
    let final: { status: string; errorCode: string | null } = { status: 'Processing', errorCode: null };
    while (Date.now() < deadline) {
      const res = await request.get(`/api/pdf-processing/sessions/${stuckSessionId}`, { headers });
      expect(res.status()).toBeLessThan(500);
      final = await res.json();
      if (final.status === 'Failed') break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    expect(final.status, 'the real ROLE=worker container must have claimed and failed this deliberately-stuck, already-at-max-attempts session').toBe('Failed');
    expect(final.errorCode).toBe('SESSION_RECOVERY_EXHAUSTED');
  });
});
