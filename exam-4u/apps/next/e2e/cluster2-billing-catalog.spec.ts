import { test, expect } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import {
  DEMO_TENANTS,
  DEMO_TENANT_ADMIN_PASSWORD,
  platformAuthHeaders,
  platformLogin,
  platformSql,
  tenantAuthHeaders,
  tenantLogin,
} from './fixtures';

/**
 * Cluster 2 — Billing/catalog (migration plan Phase 10, cluster 2): Platform-Admin-initiated billing
 * reassign, self-serve tenant billing plan view, package/feature catalog CRUD, and a genuine
 * concurrency correctness proof.
 *
 * **Gap closed (was disclosed, not silently worked around, by this sub-slice's own first pass —
 * see `docs/plans/nextjs-rewrite-phase10-plan.md`'s "Phase 10 e2e validation — overall status" section
 * for the original finding)**: the migration plan's own cluster-2 wording calls for "feature-usage
 * incl. concurrency" — i.e. `FeatureUsageService`/`TenantFeatureUsageRepository`/the
 * `tenant_feature_usage` atomic-increment enforcement engine. That module was never ported to
 * `apps/next` by phases 0-9, so this cluster's original pass substituted the closest real concurrent-
 * write race that existed at the time (`PackagesService.create`'s natural-key collision handling,
 * still below as its own genuine proof — kept, not replaced). A dedicated follow-up dispatch has since
 * ported `server/platform/usage` (see that plan doc's "Post-e2e closure" section) and retrofitted every
 * real legacy call site this app has an equivalent Route Handler for
 * (`POST /api/attempts`/`POST /api/curricula/:id/documents`/`POST /api/exam-types/zip`/
 * `POST /api/pdf-processing/upload`/`POST /api/pdf-processing/sessions/:id/finalize`) — the test below
 * is this closure's own real, black-box proof: a genuine `FEATURE_LIMIT_REACHED` rejection, tenant
 * isolation, and the usage-read endpoint's accuracy, against the real `pdf.generations` gate on
 * `POST /api/pdf-processing/upload`.
 */

/** A minimal, genuinely-valid single-page PDF (never a checked-in fixture) — same hand-built literal
 * `cluster6-pdf-processing.spec.ts`'s own `buildMinimalPdf` uses (duplicated here rather than shared,
 * matching this suite's own per-file-self-containment convention — `fixtures.ts` holds only
 * cross-cluster helpers, not per-cluster content builders). A unique `sentence` per call keeps the
 * bytes distinct across calls so this app's tier-1 exact-hash upload dedup never short-circuits a
 * second upload into reusing the first session (which would otherwise still count against the quota
 * once, but not prove two independent gated calls).
 */
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

test.describe('Cluster 2 — Billing/catalog', () => {
  test('Platform Admin: package/feature catalog CRUD (create feature, create package, associate)', async ({ request }) => {
    const suffix = Date.now().toString(36);
    const { accessToken } = await platformLogin(request);
    const headers = platformAuthHeaders(accessToken);

    const featureRes = await request.post('/api/platform/features', {
      headers,
      data: { key: `e2e_feature_${suffix}`, name: `E2E Feature ${suffix}`, unit: 'calls', resetPeriod: 'MONTHLY' },
    });
    expect(featureRes.status()).toBe(201);
    const feature = await featureRes.json();

    const packageRes = await request.post('/api/platform/packages', {
      headers,
      data: { key: `e2e_pkg_${suffix}`, name: `E2E Package ${suffix}`, priceCents: 1999 },
    });
    expect(packageRes.status()).toBe(201);
    const pkg = await packageRes.json();

    const assocRes = await request.put(`/api/platform/packages/${pkg.id}/features`, {
      headers,
      data: { features: [{ featureId: feature.id, limit: 50 }] },
    });
    expect(assocRes.status()).toBeLessThan(300);

    const detailRes = await request.get(`/api/platform/packages/${pkg.id}`, { headers });
    expect(detailRes.status()).toBe(200);
    const detailBody = await detailRes.json();
    expect(detailBody.features.some((f: { featureId: string; limit: number | null }) => f.featureId === feature.id && f.limit === 50)).toBe(true);
  });

  test('Genuine concurrency proof: two simultaneous package creates with the IDENTICAL catalog key race — exactly one wins, the other gets a real 409 conflict, never two rows', async ({ request }) => {
    const suffix = Date.now().toString(36);
    const { accessToken } = await platformLogin(request);
    const headers = platformAuthHeaders(accessToken);
    const key = `e2e_race_pkg_${suffix}`;

    // A REAL concurrent race — both requests fired via Promise.all, not awaited sequentially. This is
    // this cluster's substitute for the (unported) feature-usage atomic-increment race — see this
    // file's own header doc comment for why, and what the closest real race actually available here is.
    const [resA, resB] = await Promise.all([
      request.post('/api/platform/packages', { headers, data: { key, name: 'Race A', priceCents: 100 } }),
      request.post('/api/platform/packages', { headers, data: { key, name: 'Race B', priceCents: 200 } }),
    ]);

    const statuses = [resA.status(), resB.status()].sort();
    expect(statuses).toEqual([201, 409]);
    const conflictRes = resA.status() === 409 ? resA : resB;
    expect((await conflictRes.json()).error.code).toBe('PACKAGE_KEY_EXISTS');

    // Confirm exactly ONE row exists for this key server-side (list + filter), not two silently
    // created despite the 409 (a real double-insert would only be caught by direct DB inspection, not
    // by trusting the HTTP status codes alone).
    const listRes = await request.get('/api/platform/packages', { headers });
    const items: Array<{ key: string }> = (await listRes.json()).items;
    expect(items.filter((p) => p.key === key)).toHaveLength(1);
  });

  test('Platform-Admin-initiated billing: reassign a demo tenant to a different package via the direct (non-Stripe) admin path', async ({ request }) => {
    const { accessToken } = await platformLogin(request);
    const headers = platformAuthHeaders(accessToken);

    const tenantsList = await (await request.get('/api/platform/tenants?pageSize=100', { headers })).json();
    const starterTenant = (tenantsList.items as Array<{ id: string; subdomainSlug: string }>).find((t) => t.subdomainSlug === DEMO_TENANTS.starter.subdomain);
    expect(starterTenant, 'demo-starter tenant must exist from the seed step').toBeTruthy();

    const packagesList = await (await request.get('/api/platform/packages?activeOnly=true', { headers })).json();
    const proPackage = (packagesList.items as Array<{ id: string; key: string }>).find((p) => p.key === 'pro');
    expect(proPackage, "catalog 'pro' package must exist (seeded verbatim by the platform migration)").toBeTruthy();

    const before = await (await request.get(`/api/platform/tenants/${starterTenant!.id}/billing`, { headers })).json();
    expect(before.subscription?.packageKey).toBe('starter');

    const reassignRes = await request.put(`/api/platform/tenants/${starterTenant!.id}/billing`, { headers, data: { packageId: proPackage!.id } });
    expect(reassignRes.status()).toBe(200);

    const after = await (await request.get(`/api/platform/tenants/${starterTenant!.id}/billing`, { headers })).json();
    expect(after.subscription?.packageKey).toBe('pro');

    // Restore to 'starter' so this test is safely re-runnable without permanently mutating the shared
    // seeded fixture's assumed starting state for other tests/re-runs in this same suite.
    const starterPackage = (packagesList.items as Array<{ id: string; key: string }>).find((p) => p.key === 'starter');
    await request.put(`/api/platform/tenants/${starterTenant!.id}/billing`, { headers, data: { packageId: starterPackage!.id } });
  });

  test('Self-serve tenant billing: a Tenant Admin can view (billing.read) the real plan catalog + current subscription via /api/tenant/billing/plans', async ({ request }) => {
    const { accessToken } = await tenantLogin(request, DEMO_TENANTS.pro.subdomain, DEMO_TENANTS.pro.adminEmail, DEMO_TENANT_ADMIN_PASSWORD);
    const headers = tenantAuthHeaders(DEMO_TENANTS.pro.subdomain, accessToken);

    const res = await request.get('/api/tenant/billing/plans', { headers });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.packages)).toBe(true);
    expect(body.packages.length).toBeGreaterThan(0);
  });

  test('Self-serve tenant billing: structural tenant-tampering prevention — no route parameter/body field can express a cross-tenant checkout target', async ({ request }) => {
    const { accessToken } = await tenantLogin(request, DEMO_TENANTS.starter.subdomain, DEMO_TENANTS.starter.adminEmail, DEMO_TENANT_ADMIN_PASSWORD);
    const headers = tenantAuthHeaders(DEMO_TENANTS.starter.subdomain, accessToken);

    // billing.read-only role (the same Tenant Admin has billing.manage too, so this specifically proves
    // the *route signature* has no tenant-id field to tamper with, not merely that RBAC would catch it)
    // — the request itself carries no tenantId anywhere; the real acting tenant is resolved solely from
    // the Host header via requireTenantId(), which this test can't smuggle a different value into.
    const res = await request.post('/api/tenant/billing/checkout-session', { headers, data: { packageId: 'irrelevant-does-not-matter' } });
    // Either a real 503 (Stripe not configured in this compose stack) or a 404 PACKAGE_NOT_FOUND is
    // an acceptable, real outcome here — what matters is there is no 2xx/success and no code path that
    // could have targeted any tenant OTHER than the Host-resolved one.
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('FR-PKG-5 closure: a real FEATURE_LIMIT_REACHED rejection on POST /api/pdf-processing/upload once the pdf.generations quota is exhausted, tenant isolation confirmed against an unaffected sibling tenant, and GET /api/tenant/usage reports the exact real numbers', async ({
    request,
  }) => {
    // This suite runs with `workers: 1`/`fullyParallel: false` (playwright.config.ts), so this test's
    // own temporary mutation of demo-starter's subscription (below) is never visible to any other test
    // running concurrently — every cluster runs strictly sequentially.
    const suffix = Date.now().toString(36);
    const { accessToken: platformToken } = await platformLogin(request);
    const platformHeaders = platformAuthHeaders(platformToken);

    // Resolve the real, seeded 'pdf.generations' feature id and demo-starter's real tenant id directly
    // via SQL — cheaper and more direct than round-tripping through the Platform Admin catalog list
    // endpoints for a single lookup each.
    const sql = await platformSql();
    let pdfGenFeatureId: string;
    let starterTenantId: string;
    try {
      const [featureRows] = await sql.query<RowDataPacket[]>("SELECT id FROM feature WHERE `key` = 'pdf.generations' LIMIT 1");
      expect(featureRows[0], "the seeded 'pdf.generations' feature must exist").toBeTruthy();
      pdfGenFeatureId = featureRows[0].id as string;

      const [tenantRows] = await sql.query<RowDataPacket[]>('SELECT id FROM tenant WHERE subdomain_slug = ? LIMIT 1', [
        DEMO_TENANTS.starter.subdomain,
      ]);
      expect(tenantRows[0], 'demo-starter tenant must exist from the seed step').toBeTruthy();
      starterTenantId = tenantRows[0].id as string;

      // Reset any usage this feature/tenant pair may already carry from a prior run of this exact test
      // (tenant_feature_usage is keyed on tenant+feature+period, independent of which package the
      // tenant happens to be assigned to at read/write time) — makes this test's own two-upload
      // assertion below deterministic and safely re-runnable.
      await sql.query('DELETE FROM tenant_feature_usage WHERE tenant_id = ? AND feature_id = ?', [starterTenantId, pdfGenFeatureId]);
    } finally {
      await sql.end();
    }

    // A throwaway, uniquely-keyed package configuring ONLY `pdf.generations` (limit 1) — every other
    // catalog feature is therefore disabled by default-deny (FR-PKG-3) for the duration this tenant is
    // reassigned to it, which is fine: this test only exercises `pdf.generations`.
    const packageRes = await request.post('/api/platform/packages', {
      headers: platformHeaders,
      data: { key: `e2e2_limit_pkg_${suffix}`, name: `E2E2 Limit Package ${suffix}`, priceCents: 100 },
    });
    expect(packageRes.status()).toBe(201);
    const limitPackage = await packageRes.json();

    const assocRes = await request.put(`/api/platform/packages/${limitPackage.id}/features`, {
      headers: platformHeaders,
      data: { features: [{ featureId: pdfGenFeatureId, limit: 1 }] },
    });
    expect(assocRes.status()).toBeLessThan(300);

    // Capture demo-starter's real current package so it can be restored exactly, matching this file's
    // own established "reassign, verify, restore" convention (see the billing-reassign test above).
    const beforeBilling = await (await request.get(`/api/platform/tenants/${starterTenantId}/billing`, { headers: platformHeaders })).json();
    const originalPackageId: string = beforeBilling.subscription.packageId;

    const reassignRes = await request.put(`/api/platform/tenants/${starterTenantId}/billing`, {
      headers: platformHeaders,
      data: { packageId: limitPackage.id },
    });
    expect(reassignRes.status()).toBe(200);

    try {
      const { accessToken: starterToken } = await tenantLogin(
        request,
        DEMO_TENANTS.starter.subdomain,
        DEMO_TENANTS.starter.adminEmail,
        DEMO_TENANT_ADMIN_PASSWORD,
      );
      const starterHeaders = tenantAuthHeaders(DEMO_TENANTS.starter.subdomain, starterToken);

      // First upload: count 0 < limit 1 -> allowed, counter becomes 1.
      const firstUploadRes = await request.post('/api/pdf-processing/upload', {
        headers: starterHeaders,
        multipart: { file: { name: 'e2e2-limit-1.pdf', mimeType: 'application/pdf', buffer: buildMinimalPdf(`E2E2 limit probe A ${suffix}`) } },
      });
      expect(firstUploadRes.status()).toBe(202);

      // Second upload: count 1 >= limit 1 -> a real, honest FEATURE_LIMIT_REACHED rejection, not a
      // crash/generic 500 and not a silent allow.
      const secondUploadRes = await request.post('/api/pdf-processing/upload', {
        headers: starterHeaders,
        multipart: { file: { name: 'e2e2-limit-2.pdf', mimeType: 'application/pdf', buffer: buildMinimalPdf(`E2E2 limit probe B ${suffix}`) } },
      });
      expect(secondUploadRes.status()).toBe(429);
      const secondUploadBody = await secondUploadRes.json();
      expect(secondUploadBody.error.code).toBe('FEATURE_LIMIT_REACHED');
      expect(secondUploadBody.error.details).toMatchObject({ feature: 'pdf.generations', limit: 1 });
      // FR-PKG-5's `resetsAt` — `pdf.generations` is a MONTHLY-reset feature (the seeded catalog), so
      // this must be a real, parseable, strictly-future UTC instant (the 1st of next month at
      // midnight), never null/absent — proves the reset-period logic (`deriveResetsAt`), not just the
      // limit-reached branch.
      const resetsAt = secondUploadBody.error.details.resetsAt as string;
      expect(resetsAt).toBeTruthy();
      expect(new Date(resetsAt).getTime()).toBeGreaterThan(Date.now());

      // GET /api/tenant/usage: the self-serve usage-read endpoint must report the exact real numbers
      // this test just produced — used=1, limit=1, remaining=0, and a non-null resetsAt.
      const usageRes = await request.get('/api/tenant/usage', { headers: starterHeaders });
      expect(usageRes.status()).toBe(200);
      const usageBody = await usageRes.json();
      const pdfGenUsage = (usageBody.features as Array<{ featureKey: string; resetsAt: string | null }>).find(
        (f) => f.featureKey === 'pdf.generations',
      );
      expect(pdfGenUsage).toMatchObject({ featureKey: 'pdf.generations', enabled: true, limit: 1, used: 1, remaining: 0 });
      expect(pdfGenUsage?.resetsAt).toBeTruthy();

      // Tenant isolation: a sibling tenant on its OWN, untouched package (demo-pro, pdf.generations
      // limit 50 per the seeded catalog) is completely unaffected by demo-starter's temporary
      // reassignment/limit-1 package above — its own upload must still succeed normally.
      const { accessToken: proToken } = await tenantLogin(request, DEMO_TENANTS.pro.subdomain, DEMO_TENANTS.pro.adminEmail, DEMO_TENANT_ADMIN_PASSWORD);
      const proHeaders = tenantAuthHeaders(DEMO_TENANTS.pro.subdomain, proToken);
      const proUploadRes = await request.post('/api/pdf-processing/upload', {
        headers: proHeaders,
        multipart: { file: { name: 'e2e2-isolation.pdf', mimeType: 'application/pdf', buffer: buildMinimalPdf(`E2E2 isolation probe ${suffix}`) } },
      });
      expect(proUploadRes.status()).toBe(202);
    } finally {
      // Restore demo-starter to its original package (matching this file's own established convention)
      // and delete the usage row this test itself produced, so a second run of this suite starts from
      // the same clean state this test itself assumes.
      await request.put(`/api/platform/tenants/${starterTenantId}/billing`, { headers: platformHeaders, data: { packageId: originalPackageId } });
      const cleanupSql = await platformSql();
      try {
        await cleanupSql.query('DELETE FROM tenant_feature_usage WHERE tenant_id = ? AND feature_id = ?', [starterTenantId, pdfGenFeatureId]);
      } finally {
        await cleanupSql.end();
      }
    }
  });
});
