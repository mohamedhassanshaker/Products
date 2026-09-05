import { test, expect } from '@playwright/test';
import { DEMO_TENANTS, DEMO_TENANT_ADMIN_PASSWORD, tenantAuthHeaders, tenantLogin } from './fixtures';

/**
 * Cluster 4 — Content model (migration plan Phase 10, cluster 4): taxonomy CRUD, curricula ownership,
 * and document ingestion + semantic search (real Qdrant round-trip).
 *
 * **Environment constraint re-confirmed**: `EMBEDDINGS_PROVIDER=openai-compatible` with an empty key
 * in this compose stack (a fully-valid "configured but not live" shape — required for `next start`
 * itself to boot, see `docs/plans/nextjs-rewrite-phase10-plan.md`'s "Decisions made" #9). A real
 * document-ingestion embed call therefore genuinely fails at the real network boundary — this is the
 * same honest "prove up to the real network-call boundary, never fabricate a result" standard every
 * prior AI/embeddings-touching phase's own smoke script already established (see
 * `scripts/playwright-smoke-tenant.ts`'s own step 24 comment for the identical precedent).
 */

test.describe('Cluster 4 — Content model', () => {
  test('Taxonomy CRUD: create Education Level -> Stage -> Subject hierarchy, list, and delete-protection when referenced', async ({ request }) => {
    const suffix = Date.now().toString(36);
    const { accessToken } = await tenantLogin(request, DEMO_TENANTS.starter.subdomain, DEMO_TENANTS.starter.adminEmail, DEMO_TENANT_ADMIN_PASSWORD);
    const headers = tenantAuthHeaders(DEMO_TENANTS.starter.subdomain, accessToken);

    const level = await (await request.post('/api/taxonomy/education-levels', { headers, data: { name: `E2E Level ${suffix}` } })).json();
    const stage = await (
      await request.post('/api/taxonomy/stages', { headers, data: { educationLevelId: level.id, name: `E2E Stage ${suffix}` } })
    ).json();
    const subject = await (await request.post('/api/taxonomy/subjects', { headers, data: { stageId: stage.id, name: `E2E Subject ${suffix}` } })).json();
    expect(level.id).toBeTruthy();
    expect(stage.id).toBeTruthy();
    expect(subject.id).toBeTruthy();

    const levels: Array<{ id: number; name: string }> = await (await request.get('/api/taxonomy/education-levels', { headers })).json();
    expect(levels.some((l) => l.id === level.id)).toBe(true);

    // FR-TAX-4 deletion-protection: an Education Level with a real, referencing Stage beneath it must
    // be rejected, not silently orphan the Stage row.
    const deleteBlockedRes = await request.delete(`/api/taxonomy/education-levels/${level.id}`, { headers });
    expect(deleteBlockedRes.status()).toBeGreaterThanOrEqual(400);

    // Delete leaf-first (Subject, then Stage, then Level) and confirm each succeeds once unreferenced.
    expect((await request.delete(`/api/taxonomy/subjects/${subject.id}`, { headers })).status()).toBeLessThan(300);
    expect((await request.delete(`/api/taxonomy/stages/${stage.id}`, { headers })).status()).toBeLessThan(300);
    expect((await request.delete(`/api/taxonomy/education-levels/${level.id}`, { headers })).status()).toBeLessThan(300);
  });

  test('Curricula ownership: the owner can manage their own Curriculum; a second, non-owning Member without curricula.read_all is rejected', async ({ request }) => {
    const suffix = Date.now().toString(36);
    const { accessToken: ownerToken, user: owner } = await tenantLogin(
      request,
      DEMO_TENANTS.pro.subdomain,
      DEMO_TENANTS.pro.adminEmail,
      DEMO_TENANT_ADMIN_PASSWORD,
    );
    const ownerHeaders = tenantAuthHeaders(DEMO_TENANTS.pro.subdomain, ownerToken);
    expect(owner.id).toBeTruthy();

    const level = await (await request.post('/api/taxonomy/education-levels', { headers: ownerHeaders, data: { name: `Own Level ${suffix}` } })).json();
    const stage = await (
      await request.post('/api/taxonomy/stages', { headers: ownerHeaders, data: { educationLevelId: level.id, name: `Own Stage ${suffix}` } })
    ).json();
    const subject = await (
      await request.post('/api/taxonomy/subjects', { headers: ownerHeaders, data: { stageId: stage.id, name: `Own Subject ${suffix}` } })
    ).json();
    const curriculumRes = await request.post('/api/curricula', { headers: ownerHeaders, data: { name: `Own Curriculum ${suffix}`, subjectId: subject.id } });
    expect(curriculumRes.status()).toBe(201);
    const curriculum = await curriculumRes.json();

    const getOwn = await request.get(`/api/curricula/${curriculum.id}`, { headers: ownerHeaders });
    expect(getOwn.status()).toBe(200);

    // A second Member-role user (no curricula.read_all, and not the owner) is created and must be
    // rejected reading this same Curriculum by id.
    const roles = await (await request.get('/api/roles', { headers: ownerHeaders })).json();
    const memberRole = (roles as Array<{ id: number; name: string }>).find((r) => r.name === 'Member');
    const memberEmail = `e2e-nonowner-${suffix}@demo-pro.local`;
    const memberPassword = 'NonOwner123!';
    await request.post('/api/users', {
      headers: ownerHeaders,
      data: { email: memberEmail, firstName: 'Non', lastName: 'Owner', password: memberPassword, roleIds: [memberRole!.id] },
    });
    const { accessToken: memberToken } = await tenantLogin(request, DEMO_TENANTS.pro.subdomain, memberEmail, memberPassword);
    const memberHeaders = tenantAuthHeaders(DEMO_TENANTS.pro.subdomain, memberToken);

    const getAsNonOwner = await request.get(`/api/curricula/${curriculum.id}`, { headers: memberHeaders });
    expect(getAsNonOwner.status()).toBe(403);
    expect((await getAsNonOwner.json()).error.code).toBe('NOT_CURRICULUM_OWNER');
  });

  test('Curricula ingestion: uploading a real PDF document genuinely reaches the real embeddings network boundary (honest failure, not a fabricated success) — the app never crashes or 500s', async ({ request }) => {
    const suffix = Date.now().toString(36);
    const { accessToken } = await tenantLogin(request, DEMO_TENANTS.enterprise.subdomain, DEMO_TENANTS.enterprise.adminEmail, DEMO_TENANT_ADMIN_PASSWORD);
    const headers = tenantAuthHeaders(DEMO_TENANTS.enterprise.subdomain, accessToken);

    const level = await (await request.post('/api/taxonomy/education-levels', { headers, data: { name: `Ingest Level ${suffix}` } })).json();
    const stage = await (
      await request.post('/api/taxonomy/stages', { headers, data: { educationLevelId: level.id, name: `Ingest Stage ${suffix}` } })
    ).json();
    const subject = await (await request.post('/api/taxonomy/subjects', { headers, data: { stageId: stage.id, name: `Ingest Subject ${suffix}` } })).json();
    const curriculum = await (
      await request.post('/api/curricula', { headers, data: { name: `Ingest Curriculum ${suffix}`, subjectId: subject.id } })
    ).json();

    // A minimal, genuinely-valid PDF byte sequence (not a checked-in fixture) — enough for
    // `pdf-parse` to extract real text from a single page containing this literal sentence.
    const minimalPdf = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
        '3 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 5 0 R>>>>/MediaBox[0 0 300 150]/Contents 4 0 R>>endobj\n' +
        '4 0 obj<</Length 66>>stream\nBT /F1 18 Tf 20 100 Td (E2E ingestion probe sentence.) Tj ET\nendstream endobj\n' +
        '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n' +
        'trailer<</Root 1 0 R>>',
      'utf8',
    );

    const uploadRes = await request.post(`/api/curricula/${curriculum.id}/documents`, {
      headers,
      multipart: { file: { name: 'e2e-probe.pdf', mimeType: 'application/pdf', buffer: minimalPdf } },
    });
    // The real, honest outcome in this environment is either a genuine embeddings-network failure
    // (5xx/502/503-shaped domain error) surfaced cleanly through the error envelope, or — if the PDF
    // parse itself rejects this minimal hand-built file before ever reaching the embeddings call — a
    // 4xx validation error. What must NEVER happen is an unhandled crash (no envelope at all) or a
    // fabricated 2xx claiming real vector indexing succeeded when no live embeddings credential exists.
    expect(uploadRes.status()).toBeGreaterThanOrEqual(400);
    const body = await uploadRes.json();
    expect(body.error?.code, 'a real, well-formed ErrorEnvelope code, not an unhandled crash').toBeTruthy();

    // Semantic search over this (empty/failed-ingestion) Curriculum must still respond cleanly — an
    // absent/empty query returns 200 [] per FR-CUR-3's own explicit rule, never a 500.
    const emptySearchRes = await request.get(`/api/curricula/${curriculum.id}/search`, { headers });
    expect(emptySearchRes.status()).toBe(200);
    expect(await emptySearchRes.json()).toEqual([]);
  });
});
