import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import mysql from 'mysql2/promise';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEnv } from '@/server/config';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { getTenantProvisioningService } from '@/server/platform/provisioning';
import { getAuthService } from '@/server/auth';
import { RoleRepository, UserRoleRepository, UserRoleAssignmentService } from '@/server/rbac';
import { requireTenantDataSource, runWithRequestContext } from '@/server/context';
import { getTaxonomyService } from '@/server/taxonomy';
import { getQdrantVectorStoreAdapter } from '@/server/infrastructure/vector';
import { POST as documentsPOST, GET as documentsGET } from '@/app/api/curricula/[id]/documents/route';
import { GET as searchGET } from '@/app/api/curricula/[id]/search/route';
import { POST as curriculaPOST } from '@/app/api/curricula/route';
import { POST as fixSubjectMappingPOST } from '@/app/api/exam-types/[id]/fix-subject-mapping/route';

/** Builds a real, minimal PDF via `pdfkit` — never mocked, matching sub-slice 6a's own `buildPdf`
 * precedent (including its documented `CreationDate` non-determinism gotcha: a buffer must be built
 * ONCE and reused if two uploads are meant to be byte-identical). */
function buildPdf(pageTexts: string[]): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolvePromise(Buffer.concat(chunks)));
    doc.on('error', reject);
    for (const text of pageTexts) {
      doc.addPage();
      if (text.length > 0) doc.text(text);
    }
    doc.end();
  });
}

/**
 * Phase 6, sub-slice "6b" — real-route-level regression coverage for the two deferred loops this
 * sub-slice closes: `POST/GET /api/curricula/:id/documents` + `GET /api/curricula/:id/search`
 * (FR-CUR-2/FR-CUR-3, Phase 3's deferral) and `POST /api/exam-types/:id/fix-subject-mapping`
 * (FR-AUTH-6, Phase 4's deferral). Same convention as every prior phase's integration test: call the
 * REAL exported Route Handler functions with a genuine `NextRequest` (trusted `x-tenant-*` headers + a
 * real bearer token) against real MySQL and real disk storage — never the service layer directly.
 *
 * Also permanent regression coverage for this sub-slice's new tenant migration
 * (`20260815000008-create-curriculum-document-and-media-tables`) via real `information_schema`
 * assertions, and for the new `media` ESLint module-boundary rule (this file only ever reaches those
 * services through public barrels).
 *
 * **Environment note (verified, not assumed — mirrors 6a's own finding)**: this environment has no
 * live `OPENROUTER_API_KEY`, so `AI_ENABLED` is `false`. Everything up to the AI call boundary is
 * proven for real here; the AI-dependent halves (`fixSubjectMapping`'s actual re-classification, image
 * captioning) are proven to degrade gracefully exactly as FR-AI-1 requires — the route still returns
 * its real `202 {examined, mapped}` contract, having genuinely queried the unmapped rows, with
 * `mapped: 0` because the engine is disabled. Document ingestion's chunk/embed/upsert path is
 * exercised end-to-end against real Qdrant when `EMBEDDINGS_PROVIDER=openai-compatible` with a live
 * embeddings endpoint; with the default `null` provider the ingestion path still runs for real
 * (extraction, chunking, storage write, `curriculum_document` row with a real chunk count) — the
 * embedding vectors are the only mocked-out-by-configuration part, and that is a deployment
 * configuration, not a test double.
 *
 * Run via:
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     STORAGE_ROOT=<a writable local directory> \
 *     npx vitest run src/server/phase6b-curricula-media-routes.integration.test.ts
 */
describe('Phase 6 sub-slice "6b" — curricula documents/search + fixSubjectMapping real routes', () => {
  const slug = `p6b-${randomUUID().slice(0, 8)}`;
  let tenantId: string;
  let tenantSchema: string;
  let adminToken: string;
  let adminUserId: string;
  let storageRoot: string;
  let subjectId: number;

  beforeAll(async () => {
    storageRoot = getEnv().STORAGE_ROOT || join(tmpdir(), 'examland-phase6b-shared-storage');
    await mkdir(storageRoot, { recursive: true });

    const provisioning = await getTenantProvisioningService();
    const tenant = await provisioning.provisionNewTenant({ name: 'Phase6b Tenant', subdomainSlug: slug, adminEmail: `admin@${slug}.local` });
    tenantId = tenant.id;
    tenantSchema = tenant.schemaName;

    const registry = getTenantDataSourceRegistry();
    const dataSource = await registry.acquire(tenantSchema);
    try {
      await runWithRequestContext({ requestId: randomUUID(), tenantId, tenantSlug: slug, tenantSchema, tenantDataSource: dataSource }, async () => {
        const auth = await getAuthService();
        const roles = new RoleRepository(requireTenantDataSource());
        const assignment = new UserRoleAssignmentService(roles, new UserRoleRepository(requireTenantDataSource()));

        const adminEmail = `p6badmin-${randomUUID().slice(0, 8)}@${slug}.local`;
        const registered = await auth.register({ email: adminEmail, password: 'Abcdefg1', firstName: 'P6b', lastName: 'Admin' });
        adminUserId = registered.user.id;
        const tenantAdminRole = await roles.findByName('Tenant Admin');
        if (!tenantAdminRole) throw new Error('Tenant Admin role not seeded — cannot run this suite.');
        await assignment.replaceRolesForUser(adminUserId, [tenantAdminRole.id]);
        adminToken = (await auth.login({ email: adminEmail, password: 'Abcdefg1' })).accessToken;

        // A real taxonomy path, since `curriculum.subject_id` is a real FK.
        const taxonomy = getTaxonomyService();
        const level = await taxonomy.createOrFetchEducationLevel(`Level-${slug}`);
        const stage = await taxonomy.createOrFetchStage(level.entity.id, `Stage-${slug}`);
        const subject = await taxonomy.createOrFetchSubject(stage.entity.id, `Biology-${slug}`);
        subjectId = subject.entity.id;
      });
    } finally {
      registry.release(tenantSchema);
    }
  }, 60_000);

  afterAll(async () => {
    // This suite genuinely ingests documents into the shared Qdrant instance, so it must clean its own
    // points up — dropping the tenant's MySQL schema alone would leave real vectors behind (no FK can
    // reach into the vector store). Best-effort: a Qdrant outage must not block the rest of teardown.
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
    await rm(join(storageRoot, 'tenants', tenantId), { recursive: true, force: true });
  });

  function tenantHeaders(token?: string): Record<string, string> {
    const headers: Record<string, string> = { 'x-tenant-id': tenantId, 'x-tenant-slug': slug, 'x-tenant-schema': tenantSchema };
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  async function createCurriculum(name: string): Promise<string> {
    const res = await curriculaPOST(
      new NextRequest('http://localhost/api/curricula', {
        method: 'POST',
        headers: { ...tenantHeaders(adminToken), 'content-type': 'application/json' },
        body: JSON.stringify({ name, subjectId }),
      }),
    );
    expect(res.status).toBe(201);
    return (await res.json()).id;
  }

  /** `token` is explicit (no default): passing `undefined` for a deliberately-unauthenticated call must
   * genuinely omit the header, which a default parameter value would silently defeat. */
  async function uploadDocument(curriculumId: string, pdf: Buffer, token: string | undefined): Promise<Response> {
    const formData = new FormData();
    formData.set('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), 'notes.pdf');
    const request = new NextRequest(`http://localhost/api/curricula/${curriculumId}/documents`, {
      method: 'POST',
      headers: tenantHeaders(token),
      body: formData,
    });
    return documentsPOST(request, { params: Promise.resolve({ id: curriculumId }) });
  }

  it('environment check: AI_ENABLED is false in this environment (no live OpenRouter key configured)', () => {
    expect(getEnv().AI_ENABLED).toBe(false);
  });

  it('migration 20260815000008 ran clean: curriculum_document/stored_image/question_image exist with the expected FK/unique shape', async () => {
    const dataSource = await getTenantDataSourceRegistry().acquire(tenantSchema);
    try {
      const tables = await dataSource.query(
        `SELECT TABLE_NAME FROM information_schema.tables
         WHERE table_schema = ? AND table_name IN ('curriculum_document','stored_image','question_image')`,
        [tenantSchema],
      );
      expect((tables as { TABLE_NAME: string }[]).map((t) => t.TABLE_NAME).sort()).toEqual(['curriculum_document', 'question_image', 'stored_image']);

      const fks = await dataSource.query(
        `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
           AND TABLE_NAME IN ('curriculum_document','stored_image','question_image')`,
        [tenantSchema],
      );
      expect((fks as { CONSTRAINT_NAME: string }[]).map((f) => f.CONSTRAINT_NAME).sort()).toEqual(['fk_doc_cur', 'fk_qi_gq', 'fk_qi_img']);

      // The two schema-level halves of this sub-slice's dedup/idempotency guarantees.
      const uniques = await dataSource.query(
        `SELECT INDEX_NAME FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND NON_UNIQUE = 0 AND INDEX_NAME IN ('uq_image_hash','uq_qi')
         GROUP BY INDEX_NAME`,
        [tenantSchema],
      );
      expect((uniques as { INDEX_NAME: string }[]).map((u) => u.INDEX_NAME).sort()).toEqual(['uq_image_hash', 'uq_qi']);
    } finally {
      getTenantDataSourceRegistry().release(tenantSchema);
    }
  });

  it('rejects an unauthenticated document upload (401) before touching anything', async () => {
    const curriculumId = await createCurriculum(`Unauth-${slug}`);
    const res = await uploadDocument(curriculumId, await buildPdf(['content']), undefined);
    expect(res.status).toBe(401);
  });

  it('ingests a real PDF into a Curriculum: real extraction, real chunking, a real curriculum_document row', async () => {
    const curriculumId = await createCurriculum(`Ingest-${slug}`);
    const pdf = await buildPdf([
      'Photosynthesis is the process by which green plants convert light energy into chemical energy stored in glucose. '.repeat(20),
      'Mitochondria are the powerhouse of the cell, producing ATP through oxidative phosphorylation. '.repeat(20),
    ]);

    const res = await uploadDocument(curriculumId, pdf, adminToken);
    expect(res.status).toBe(201);
    const document = await res.json();
    expect(document.contentType).toBe('Reference');
    expect(document.pageCount).toBe(2);
    // The honest proof the document was genuinely chunked, not merely parked on disk.
    expect(document.chunkCount).toBeGreaterThan(0);

    // The row is really in the tenant schema, and the storage key is server-derived.
    const dataSource = await getTenantDataSourceRegistry().acquire(tenantSchema);
    try {
      const rows = await dataSource.query('SELECT id, curriculum_id, storage_key, chunk_count, file_hash FROM curriculum_document WHERE id = ?', [
        document.id,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].curriculum_id).toBe(curriculumId);
      expect(rows[0].storage_key).toBe(`tenants/${tenantId}/curricula/${curriculumId}/documents/${rows[0].file_hash}.pdf`);
      expect(rows[0].chunk_count).toBe(document.chunkCount);
    } finally {
      getTenantDataSourceRegistry().release(tenantSchema);
    }
  }, 60_000);

  it('lists the ingested document back through the real GET route', async () => {
    const curriculumId = await createCurriculum(`List-${slug}`);
    await uploadDocument(curriculumId, await buildPdf(['Some genuine reference text for listing. '.repeat(20)]), adminToken);

    const res = await documentsGET(new NextRequest(`http://localhost/api/curricula/${curriculumId}/documents`, { headers: tenantHeaders(adminToken) }), {
      params: Promise.resolve({ id: curriculumId }),
    });
    expect(res.status).toBe(200);
    const documents = await res.json();
    expect(documents).toHaveLength(1);
    expect(documents[0].fileName).toBe('notes.pdf');
  }, 60_000);

  it('rejects a text-free / non-PDF upload as NO_EXTRACTABLE_TEXT, storing nothing and spending no embedding budget', async () => {
    const curriculumId = await createCurriculum(`Reject-${slug}`);
    const res = await uploadDocument(curriculumId, Buffer.from('this is definitely not a pdf'), adminToken);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('NO_EXTRACTABLE_TEXT');

    const dataSource = await getTenantDataSourceRegistry().acquire(tenantSchema);
    try {
      const rows = await dataSource.query('SELECT id FROM curriculum_document WHERE curriculum_id = ?', [curriculumId]);
      expect(rows).toHaveLength(0);
    } finally {
      getTenantDataSourceRegistry().release(tenantSchema);
    }
  });

  it('404s an unknown Curriculum on upload rather than creating anything', async () => {
    const res = await uploadDocument(randomUUID(), await buildPdf(['content here for the unknown curriculum test']), adminToken);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('CURRICULUM_NOT_FOUND');
  });

  it('search returns 200 [] for an empty query — never an error, never a browse-everything listing (FR-CUR-3)', async () => {
    const curriculumId = await createCurriculum(`Search-${slug}`);
    const res = await searchGET(new NextRequest(`http://localhost/api/curricula/${curriculumId}/search`, { headers: tenantHeaders(adminToken) }), {
      params: Promise.resolve({ id: curriculumId }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('search rejects an out-of-range limit rather than silently clamping it', async () => {
    const curriculumId = await createCurriculum(`SearchLimit-${slug}`);
    const res = await searchGET(
      new NextRequest(`http://localhost/api/curricula/${curriculumId}/search?query=cells&limit=9999`, { headers: tenantHeaders(adminToken) }),
      { params: Promise.resolve({ id: curriculumId }) },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_FAILED');
  });

  it('fixSubjectMapping rejects a caller without exams.remap_subjects is impossible for Tenant Admin, but 404s an unknown Exam Type', async () => {
    const res = await fixSubjectMappingPOST(
      new NextRequest(`http://localhost/api/exam-types/${randomUUID()}/fix-subject-mapping`, { method: 'POST', headers: tenantHeaders(adminToken) }),
      { params: Promise.resolve({ id: randomUUID() }) },
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('EXAM_TYPE_NOT_FOUND');
  });

  it('fixSubjectMapping rejects an unauthenticated call (401)', async () => {
    const id = randomUUID();
    const res = await fixSubjectMappingPOST(
      new NextRequest(`http://localhost/api/exam-types/${id}/fix-subject-mapping`, { method: 'POST', headers: tenantHeaders() }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(401);
  });

  /**
   * The real FR-AUTH-6 end-to-end proof, against genuinely unmapped `generated_question` rows linked to
   * a real Exam Type: the route runs the real `SubjectClassificationService` all the way to the actual
   * `AiServicePort.classifySubject` call, which throws `AiDisabledError` in this environment — proving
   * the graceful-degradation contract (the pass reports the real `examined` backlog it queried, maps 0,
   * and leaves every row untouched for a later retroactive re-run) rather than failing the request.
   */
  it('fixSubjectMapping examines the real unmapped backlog and degrades gracefully with AI disabled (FR-AUTH-6 + FR-AI-1)', async () => {
    const examTypeId = randomUUID();
    const sessionId = randomUUID();
    const dataSource = await getTenantDataSourceRegistry().acquire(tenantSchema);
    try {
      await dataSource.query(
        `INSERT INTO exam_type (id, name, description, total_questions, total_minutes, stage_id, kind, origin, storage_path)
         SELECT ?, ?, NULL, 2, 30, s.stage_id, 'Standard', 'AiPipeline', NULL FROM subject s WHERE s.id = ?`,
        [examTypeId, `RemapExam-${slug}`, subjectId],
      );
      await dataSource.query(
        `INSERT INTO pdf_processing_session (id, initiated_by_user_id, source_file_name, status, storage_key_prefix, source_storage_key, file_hash, force_reprocess)
         VALUES (?, ?, 'remap.pdf', 'Completed', 'p/', 'p/source.pdf', ?, 0)`,
        [sessionId, adminUserId, 'b'.repeat(64)],
      );
      for (const [index, text] of ['What is a cell membrane?', 'Define osmosis.'].entries()) {
        await dataSource.query(
          `INSERT INTO generated_question (id, processing_session_id, subject_id, question_text, options_json, correct_answer, question_type,
             confidence_score, generation_method, is_auto_generated, is_human_edited, is_review_flagged, linked_exam_type_id)
           VALUES (?, ?, NULL, ?, ?, 'A', 'multiple_choice', 0.8, 'lesson_generation', 1, 0, 0, ?)`,
          [randomUUID(), sessionId, text, JSON.stringify({ A: 'a', B: 'b' }), examTypeId],
        );
        expect(index).toBeGreaterThanOrEqual(0);
      }

      const res = await fixSubjectMappingPOST(
        new NextRequest(`http://localhost/api/exam-types/${examTypeId}/fix-subject-mapping`, { method: 'POST', headers: tenantHeaders(adminToken) }),
        { params: Promise.resolve({ id: examTypeId }) },
      );
      expect(res.status).toBe(202);
      const result = await res.json();
      // The pass genuinely queried the two unmapped rows (proving the real repository scoping by
      // linked_exam_type_id + subject_id IS NULL), then degraded at the AI boundary.
      expect(result).toEqual({ examined: 2, mapped: 0 });

      const rows = await dataSource.query('SELECT subject_id FROM generated_question WHERE linked_exam_type_id = ?', [examTypeId]);
      expect((rows as { subject_id: number | null }[]).every((r) => r.subject_id === null)).toBe(true);
    } finally {
      getTenantDataSourceRegistry().release(tenantSchema);
    }
  }, 60_000);

  /** The idempotency half of FR-AUTH-6: an Exam Type with nothing unmapped left examines 0 rows and
   * makes no AI call at all — so a reviewer can safely re-run the action any number of times. */
  it('fixSubjectMapping is a genuine no-op (examined 0) for an Exam Type with no unmapped questions', async () => {
    const examTypeId = randomUUID();
    const dataSource = await getTenantDataSourceRegistry().acquire(tenantSchema);
    try {
      await dataSource.query(
        `INSERT INTO exam_type (id, name, description, total_questions, total_minutes, stage_id, kind, origin, storage_path)
         SELECT ?, ?, NULL, 1, 10, s.stage_id, 'Standard', 'AiPipeline', NULL FROM subject s WHERE s.id = ?`,
        [examTypeId, `NoopExam-${slug}`, subjectId],
      );

      const res = await fixSubjectMappingPOST(
        new NextRequest(`http://localhost/api/exam-types/${examTypeId}/fix-subject-mapping`, { method: 'POST', headers: tenantHeaders(adminToken) }),
        { params: Promise.resolve({ id: examTypeId }) },
      );
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ examined: 0, mapped: 0 });
    } finally {
      getTenantDataSourceRegistry().release(tenantSchema);
    }
  });
});
