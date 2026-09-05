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
import { RoleRepository, RolesService, UserRoleRepository, UserRoleAssignmentService, PermissionRepository } from '@/server/rbac';
import { requireTenantDataSource, runWithRequestContext } from '@/server/context';
import { POST as uploadPOST } from '@/app/api/pdf-processing/upload/route';
import { GET as sessionsGET } from '@/app/api/pdf-processing/sessions/route';
import { GET as sessionGET } from '@/app/api/pdf-processing/sessions/[id]/route';
import { runPdfStaleSessionRecoverySweep } from '@/server/workers/pdf-stale-session-recovery';

/** Builds a real, minimal PDF via `pdfkit` — never mocked, matching
 * `legacy/api/src/modules/pdf-processing/application/pdf-processing.service.spec.ts`'s established
 * `buildPdf` precedent. */
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

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Phase 6, sub-slice "6a" — real-route-level regression coverage for `app/api/pdf-processing/**`,
 * matching every prior phase's `phaseN-*-routes.integration.test.ts` convention: call the REAL
 * exported Route Handler functions with a genuine `NextRequest` (trusted `x-tenant-*` headers + a real
 * bearer token) against real MySQL and real disk storage, not the service layer directly.
 *
 * Also the permanent regression test for this dispatch's two new ESLint module-boundary rules
 * (`PDF_PROCESSING_BARREL_ONLY`/`INFRASTRUCTURE_TEXT_EXTRACTION_BARREL_ONLY`) — the imports above of
 * `@/app/api/pdf-processing/**` prove that scoping is correct (a bare pattern would have rejected
 * these).
 *
 * **Environment note (documented per this dispatch's own explicit instruction)**: this environment has
 * no live `OPENROUTER_API_KEY` (`AI_ENABLED` defaults `false` — confirmed by reading `.env`/the actual
 * env this test runs under, not assumed). A freshly-uploaded, genuinely-new (never-before-seen) PDF
 * therefore reaches `Classifying`/`AI_DISABLED` — a REAL, correctly-recorded graceful-degradation
 * state — and never `Completed` on its own. Tier-1 exact-hash dedup is proven by first SQL-marking a
 * session `Completed` (simulating "this exact content was already successfully processed at some
 * earlier point, e.g. once a real OpenRouter key is configured") and then re-uploading the identical
 * bytes — the dedup gate runs BEFORE the classification call, so the second session reaching
 * `Completed` via `reusedFromSessionId` is real, unconditional proof that the AI pipeline was skipped
 * entirely for the duplicate, regardless of `AI_ENABLED`.
 *
 * Run via (STORAGE_ROOT must point at a writable local directory for real disk writes to succeed):
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     STORAGE_ROOT=<a writable local directory> \
 *     npx vitest run src/server/phase6a-pdf-processing-routes.integration.test.ts
 */
describe('Phase 6 sub-slice "6a" — /api/pdf-processing/** real routes (real MySQL, real disk, real JWT)', () => {
  const slug = `p6a-${randomUUID().slice(0, 8)}`;
  let tenantId: string;
  let tenantSchema: string;
  let adminToken: string;
  let noPermissionToken: string;
  let storageRoot: string;

  beforeAll(async () => {
    storageRoot = getEnv().STORAGE_ROOT || join(tmpdir(), 'examland-phase6a-shared-storage');
    await mkdir(storageRoot, { recursive: true });

    const provisioning = await getTenantProvisioningService();
    const tenant = await provisioning.provisionNewTenant({ name: 'Phase6a Tenant', subdomainSlug: slug, adminEmail: `admin@${slug}.local` });
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

        const adminEmail = `p6aadmin-${randomUUID().slice(0, 8)}@${slug}.local`;
        const adminRegistered = await auth.register({ email: adminEmail, password: 'Abcdefg1', firstName: 'P6a', lastName: 'Admin' });
        const tenantAdminRole = await roles.findByName('Tenant Admin');
        if (!tenantAdminRole) throw new Error('Tenant Admin role not seeded — cannot run this suite.');
        await assignment.replaceRolesForUser(adminRegistered.user.id, [tenantAdminRole.id]);
        adminToken = (await auth.login({ email: adminEmail, password: 'Abcdefg1' })).accessToken;

        // A real role with zero permission grants — proves the 403 FORBIDDEN path against a genuine
        // authenticated-but-unauthorized caller, rather than the seeded Member (which already holds
        // pdf.upload/pdf.review by default and would not exercise this rejection path).
        const emptyRole = await rolesService.create({ name: `NoPerms-${slug}`, description: 'no permissions', permissionIds: [] });
        const noPermEmail = `p6anoperm-${randomUUID().slice(0, 8)}@${slug}.local`;
        const noPermRegistered = await auth.register({ email: noPermEmail, password: 'Abcdefg1', firstName: 'P6a', lastName: 'NoPerm' });
        await assignment.replaceRolesForUser(noPermRegistered.user.id, [emptyRole.id]);
        noPermissionToken = (await auth.login({ email: noPermEmail, password: 'Abcdefg1' })).accessToken;
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
    await rm(join(storageRoot, 'tenants', tenantId), { recursive: true, force: true });
  });

  function tenantHeaders(token?: string): Record<string, string> {
    const headers: Record<string, string> = { 'x-tenant-id': tenantId, 'x-tenant-slug': slug, 'x-tenant-schema': tenantSchema };
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  async function uploadPdf(pdf: Buffer, token: string | undefined): Promise<Response> {
    const formData = new FormData();
    formData.set('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), 'exam.pdf');
    const request = new NextRequest('http://localhost/api/pdf-processing/upload', { method: 'POST', headers: tenantHeaders(token), body: formData });
    return uploadPOST(request);
  }

  async function getSession(id: string, token: string | undefined = adminToken): Promise<Response> {
    return sessionGET(new NextRequest(`http://localhost/api/pdf-processing/sessions/${id}`, { headers: tenantHeaders(token) }), {
      params: Promise.resolve({ id }),
    });
  }

  /** Verified against the *actual* env this test process runs under — not assumed. */
  it('environment check: AI_ENABLED is false in this environment (no live OpenRouter key configured)', () => {
    expect(getEnv().AI_ENABLED).toBe(false);
  });

  it('migration ran clean: pdf_processing_session/generated_question tables exist with the expected FK shape', async () => {
    const dataSource = await getTenantDataSourceRegistry().acquire(tenantSchema);
    try {
      const tables = await dataSource.query(
        "SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = ? AND table_name IN ('pdf_processing_session','generated_question')",
        [tenantSchema],
      );
      expect((tables as { TABLE_NAME: string }[]).map((t) => t.TABLE_NAME).sort()).toEqual(['generated_question', 'pdf_processing_session']);

      const fks = await dataSource.query(
        `SELECT TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL AND TABLE_NAME IN ('pdf_processing_session','generated_question')`,
        [tenantSchema],
      );
      const fkNames = (fks as { CONSTRAINT_NAME: string }[]).map((f) => f.CONSTRAINT_NAME).sort();
      expect(fkNames).toEqual(['fk_gq_session', 'fk_gq_subject', 'fk_sess_subject']);
    } finally {
      getTenantDataSourceRegistry().release(tenantSchema);
    }
  });

  it('rejects an unauthenticated request to GET /api/pdf-processing/sessions', async () => {
    const res = await sessionsGET(new NextRequest('http://localhost/api/pdf-processing/sessions', { headers: tenantHeaders() }));
    expect(res.status).toBe(401);
  });

  it('rejects a caller without pdf.upload attempting to upload a PDF (403 FORBIDDEN)', async () => {
    const pdf = await buildPdf(['some content']);
    const res = await uploadPdf(pdf, noPermissionToken);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
  });

  it('rejects a non-PDF upload with INVALID_FILE_SIGNATURE (real magic-byte check over real HTTP)', async () => {
    const formData = new FormData();
    formData.set('file', new Blob([new Uint8Array(Buffer.from('not a real pdf'))], { type: 'application/pdf' }), 'fake.pdf');
    const request = new NextRequest('http://localhost/api/pdf-processing/upload', { method: 'POST', headers: tenantHeaders(adminToken), body: formData });
    const res = await uploadPOST(request);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_FILE_SIGNATURE');
  });

  let firstSessionId: string;
  // Built ONCE and reused verbatim for the dedup test below — `pdfkit` stamps a `CreationDate` into
  // its own info dictionary by default, so two SEPARATE `buildPdf()` calls (even with byte-identical
  // page text) produce genuinely different bytes/sha256 hashes a few milliseconds apart. Reusing the
  // exact same `Buffer` is what makes "the identical bytes were uploaded twice" a true statement,
  // rather than accidentally testing two merely-similar documents.
  let sharedPdf: Buffer;

  it('202-before-AI-work: a real PDF upload returns 202 Pending immediately, then the session genuinely reaches Classifying/AI_DISABLED (graceful degradation, real state persisted)', async () => {
    sharedPdf = await buildPdf(['a genuine first-time exam question about arithmetic '.repeat(5)]);
    const res = await uploadPdf(sharedPdf, adminToken);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('Pending');
    firstSessionId = body.sessionId;

    // Poll the real GET route until the background pipeline (extraction -> dedup miss -> classify)
    // has genuinely run — proves this isn't a mocked shortcut, the real `pdf-parse` extraction and the
    // real `AiService`/`AiDisabledError` fail-closed path both actually executed.
    let lastStatus = '';
    let lastErrorCode: string | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const pollRes = await getSession(firstSessionId);
      const pollBody = await pollRes.json();
      lastStatus = pollBody.status;
      lastErrorCode = pollBody.errorCode;
      if (lastStatus === 'Classifying' && lastErrorCode) break;
      await sleep(500);
    }
    expect(lastStatus).toBe('Classifying');
    expect(lastErrorCode).toBe('AI_DISABLED');
  }, 30_000);

  it('GET /api/pdf-processing/sessions lists the uploaded session', async () => {
    const res = await sessionsGET(new NextRequest('http://localhost/api/pdf-processing/sessions', { headers: tenantHeaders(adminToken) }));
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows.some((r: { id: string }) => r.id === firstSessionId)).toBe(true);
  });

  it("SESSION_NOT_FOUND for GET /api/pdf-processing/sessions/:id with an unknown id", async () => {
    const res = await getSession(randomUUID());
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('SESSION_NOT_FOUND');
  });

  it('tier-1 exact-hash dedup: re-uploading the identical bytes after the original is marked Completed reuses it immediately, skipping the AI pipeline entirely (proven by reaching Completed directly, never Classifying/AI_DISABLED)', async () => {
    // Simulate "this exact document was already successfully processed" (e.g. once a real OpenRouter
    // key is configured) by directly marking the first session Completed — this is the one honest way
    // to construct a real dedup-eligible predecessor in an environment with no live AI credential.
    const dataSource = await getTenantDataSourceRegistry().acquire(tenantSchema);
    try {
      await dataSource.query(
        "UPDATE pdf_processing_session SET status = 'Completed', content_type = 'Exam', page_count = 1, completed_at = NOW(3), error_code = NULL, error_message = NULL WHERE id = ?",
        [firstSessionId],
      );
    } finally {
      getTenantDataSourceRegistry().release(tenantSchema);
    }

    const res = await uploadPdf(sharedPdf, adminToken);
    expect(res.status).toBe(202);
    const secondSessionId = (await res.json()).sessionId;

    let finalBody: { status: string; reusedFromSessionId: string | null } | undefined;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const pollRes = await getSession(secondSessionId);
      const parsed: { status: string; reusedFromSessionId: string | null } = await pollRes.json();
      finalBody = parsed;
      if (parsed.status === 'Completed' || parsed.status === 'Failed') break;
      await sleep(500);
    }

    expect(finalBody).toBeDefined();
    expect(finalBody!.status).toBe('Completed');
    expect(finalBody!.reusedFromSessionId).toBe(firstSessionId);
  }, 30_000);

  it('StaleSessionRecoveryWorker: a genuinely-stuck in-flight session (stale heartbeat) is claimed and either resumed or failed past max attempts by a real sweep pass', async () => {
    // Construct a genuinely-stuck session: in-flight status, heartbeat far in the past, already at
    // maxResumeAttempts — the real sweep should fail it with SESSION_RECOVERY_EXHAUSTED rather than
    // resuming indefinitely.
    const stuckId = randomUUID();
    const dataSource = await getTenantDataSourceRegistry().acquire(tenantSchema);
    try {
      await dataSource.query(
        `INSERT INTO pdf_processing_session
          (id, source_file_name, status, storage_key_prefix, source_storage_key, file_hash, resume_attempts, heartbeat_at, created_at, updated_at)
         VALUES (?, 'stuck.pdf', 'Extracting', 'tenants/x/pdf/stuck/', 'tenants/x/pdf/stuck/source.pdf', ?, 3, DATE_SUB(NOW(3), INTERVAL 1 HOUR), NOW(3), NOW(3))`,
        [stuckId, randomUUID().replace(/-/g, '')],
      );
    } finally {
      getTenantDataSourceRegistry().release(tenantSchema);
    }

    await runPdfStaleSessionRecoverySweep('integration-test-worker');

    const res = await getSession(stuckId);
    const body = await res.json();
    expect(body.status).toBe('Failed');
    expect(body.errorCode).toBe('SESSION_RECOVERY_EXHAUSTED');
  }, 30_000);
});
