import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEnv } from '@/server/config';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { BcryptPasswordHasherAdapter, JwtPlatformTokenAdapter } from '@/server/infrastructure/security';
import { PlatformAdminRepository } from '@/server/platform/auth';
import { GET as featuresListGET, POST as featuresCreatePOST } from '@/app/api/platform/features/route';
import { GET as featureGetGET, PATCH as featurePatchPATCH, DELETE as featureDeleteDELETE } from '@/app/api/platform/features/[id]/route';
import { GET as packagesListGET, POST as packagesCreatePOST } from '@/app/api/platform/packages/route';
import { GET as packageGetGET, PATCH as packagePatchPATCH } from '@/app/api/platform/packages/[id]/route';
import { PUT as packageFeaturesPUT } from '@/app/api/platform/packages/[id]/features/route';
import { GET as aiModelsListGET, POST as aiModelsCreatePOST } from '@/app/api/platform/ai-models/route';
import { PATCH as aiModelPatchPATCH, DELETE as aiModelDeleteDELETE } from '@/app/api/platform/ai-models/[id]/route';
import { PUT as aiModelSetDefaultPUT } from '@/app/api/platform/ai-models/[id]/default/route';
import { POST as tenantsCreatePOST } from '@/app/api/platform/tenants/route';
import { PUT as tenantAiModelPUT, DELETE as tenantAiModelDELETE } from '@/app/api/platform/tenants/[id]/ai-model/route';

/**
 * Phase 2 sub-slice "2b" (packages/features CRUD UI, `platform/ai-models`) — real-route-level
 * regression coverage for this dispatch's new `app/api/platform/{features,packages,ai-models}/**`
 * Route Handlers plus the `app/api/platform/tenants/:id/ai-model` assignment routes, matching the
 * exact convention `phase2-platform-tenants-routes.integration.test.ts` (sub-slice 2a) established:
 * call the REAL exported Route Handler functions with a genuine `NextRequest`, real MySQL, real JWT —
 * not the service layer directly, so the real `withPlatformAuth` -> service call chain each route
 * wires together is actually proven.
 *
 * Also serves as the permanent regression test proving `PLATFORM_AI_MODELS_BARREL_ONLY`'s
 * from-the-start-correct pattern (`**\/server/platform/ai-models/**`, not a bare
 * `**\/platform/ai-models/**`) never blocks this file's own `@/app/api/platform/ai-models/**` route
 * imports above — the exact class of latent gap `PLATFORM_TENANTS_BARREL_ONLY` had to be fixed for in
 * sub-slice 2a, avoided here by getting the pattern right the first time.
 *
 * Run via:
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     npx vitest run src/server/phase2b-platform-catalog-routes.integration.test.ts
 */
describe('Phase 2 (2b) — /api/platform/{features,packages,ai-models}/** real routes (real MySQL, real JWT)', () => {
  const runId = randomUUID().slice(0, 8);
  let adminToken: string;
  let platformAdminId: string;
  const createdFeatureIds: string[] = [];
  const createdPackageIds: string[] = [];
  const createdModelIds: string[] = [];
  const createdTenantIds: string[] = [];
  const createdTenantSchemas: string[] = [];

  beforeAll(async () => {
    const env = getEnv();
    const platformDs = await getPlatformDataSource();
    const admins = new PlatformAdminRepository(platformDs);
    const hasher = new BcryptPasswordHasherAdapter(4); // low cost factor — this suite's own speed concern only.
    const passwordHash = await hasher.hash('Real-Admin-Pass-1');
    const inserted = await admins.insert({
      id: randomUUID(),
      email: `p2b-${runId}-admin@integration-test.local`,
      passwordHash,
      name: 'Phase2b Test Admin',
      isActive: true,
      lastLoginAt: null,
    });
    platformAdminId = inserted.id;

    const tokens = new JwtPlatformTokenAdapter(env.JWT_PLATFORM_SECRET, env.JWT_PLATFORM_TTL);
    adminToken = (await tokens.issue({ adminId: platformAdminId })).token;
  }, 60_000);

  afterAll(async () => {
    const platformDs = await getPlatformDataSource();
    for (const schema of createdTenantSchemas) {
      const conn = await mysql.createConnection({ host: 'localhost', port: 3306, user: 'examland', password: 'examland_dev' });
      try {
        await conn.query(`DROP DATABASE IF EXISTS \`${schema}\``);
      } finally {
        await conn.end();
      }
    }
    for (const id of createdTenantIds) {
      await platformDs.query('UPDATE tenant SET assigned_ai_model_id = NULL WHERE id = ?', [id]);
      await platformDs.query('DELETE FROM tenant_provisioning_step WHERE tenant_id = ?', [id]);
      await platformDs.query('DELETE FROM tenant_subscription WHERE tenant_id = ?', [id]);
      await platformDs.query('DELETE FROM tenant WHERE id = ?', [id]);
    }
    for (const id of createdPackageIds) {
      await platformDs.query('DELETE FROM package_feature WHERE package_id = ?', [id]);
      await platformDs.query('DELETE FROM `package` WHERE id = ?', [id]);
    }
    for (const id of createdFeatureIds) {
      await platformDs.query('DELETE FROM package_feature WHERE feature_id = ?', [id]);
      await platformDs.query('DELETE FROM feature WHERE id = ?', [id]);
    }
    for (const id of createdModelIds) {
      await platformDs.query('DELETE FROM approved_ai_model WHERE id = ?', [id]);
    }
    if (platformAdminId) {
      await platformDs.query('DELETE FROM platform_admin WHERE id = ?', [platformAdminId]);
    }
    await getTenantDataSourceRegistry().destroyAll();
    await platformDs.destroy();
  });

  function plainRequest(url: string, method: string, token?: string): NextRequest {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    return new NextRequest(url, { method, headers });
  }

  function jsonRequest(url: string, method: string, body: unknown, token?: string): NextRequest {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    return new NextRequest(url, { method, headers, body: JSON.stringify(body) });
  }

  it('rejects an unauthenticated request 401 UNAUTHENTICATED on every new route group', async () => {
    const featuresRes = await featuresListGET(plainRequest('http://localhost/api/platform/features', 'GET'));
    expect(featuresRes.status).toBe(401);
    const packagesRes = await packagesListGET(plainRequest('http://localhost/api/platform/packages', 'GET'));
    expect(packagesRes.status).toBe(401);
    const modelsRes = await aiModelsListGET(plainRequest('http://localhost/api/platform/ai-models', 'GET'));
    expect(modelsRes.status).toBe(401);
  });

  it('creates a feature, rejects a duplicate key, updates it, and deletes it', async () => {
    const key = `p2b-${runId}-feat-a`;
    const createRes = await featuresCreatePOST(
      jsonRequest('http://localhost/api/platform/features', 'POST', { key, name: 'Feature A', unit: 'widgets', resetPeriod: 'MONTHLY' }, adminToken),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.isReferenced).toBe(false);
    createdFeatureIds.push(created.id);

    const dupRes = await featuresCreatePOST(
      jsonRequest('http://localhost/api/platform/features', 'POST', { key, name: 'Dup', unit: 'x', resetPeriod: 'NONE' }, adminToken),
    );
    expect(dupRes.status).toBe(409);
    expect((await dupRes.json()).error.code).toBe('FEATURE_KEY_EXISTS');

    const getRes = await featureGetGET(plainRequest(`http://localhost/api/platform/features/${created.id}`, 'GET', adminToken), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(getRes.status).toBe(200);

    const patchRes = await featurePatchPATCH(
      jsonRequest(`http://localhost/api/platform/features/${created.id}`, 'PATCH', { name: 'Feature A Renamed' }, adminToken),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).name).toBe('Feature A Renamed');

    const listRes = await featuresListGET(plainRequest('http://localhost/api/platform/features', 'GET', adminToken));
    const listBody = await listRes.json();
    expect(listBody.items.some((f: { id: string }) => f.id === created.id)).toBe(true);

    const deleteRes = await featureDeleteDELETE(plainRequest(`http://localhost/api/platform/features/${created.id}`, 'DELETE', adminToken), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(deleteRes.status).toBe(204);
    createdFeatureIds.splice(createdFeatureIds.indexOf(created.id), 1);

    const getAfterDeleteRes = await featureGetGET(plainRequest(`http://localhost/api/platform/features/${created.id}`, 'GET', adminToken), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(getAfterDeleteRes.status).toBe(404);
  }, 60_000);

  it('creates a package, associates a feature with it (atomic replace), then blocks the feature\'s own deletion (FEATURE_IN_USE)', async () => {
    const featureKey = `p2b-${runId}-feat-b`;
    const featureRes = await featuresCreatePOST(
      jsonRequest('http://localhost/api/platform/features', 'POST', { key: featureKey, name: 'Feature B', unit: 'widgets', resetPeriod: 'MONTHLY' }, adminToken),
    );
    const feature = await featureRes.json();
    createdFeatureIds.push(feature.id);

    const packageKey = `p2b-${runId}-pkg-a`;
    const packageRes = await packagesCreatePOST(
      jsonRequest('http://localhost/api/platform/packages', 'POST', { key: packageKey, name: 'Package A', priceCents: 1999 }, adminToken),
    );
    expect(packageRes.status).toBe(201);
    const pkg = await packageRes.json();
    createdPackageIds.push(pkg.id);

    const replaceRes = await packageFeaturesPUT(
      jsonRequest(`http://localhost/api/platform/packages/${pkg.id}/features`, 'PUT', { features: [{ featureId: feature.id, limit: 10 }] }, adminToken),
      { params: Promise.resolve({ id: pkg.id }) },
    );
    expect(replaceRes.status).toBe(200);
    const detail = await replaceRes.json();
    expect(detail.features).toEqual([{ featureId: feature.id, limit: 10 }]);

    // Unknown featureId is hard-rejected before any write.
    const badReplaceRes = await packageFeaturesPUT(
      jsonRequest(`http://localhost/api/platform/packages/${pkg.id}/features`, 'PUT', { features: [{ featureId: 'does-not-exist' }] }, adminToken),
      { params: Promise.resolve({ id: pkg.id }) },
    );
    expect(badReplaceRes.status).toBe(404);
    expect((await badReplaceRes.json()).error.code).toBe('FEATURE_NOT_FOUND');

    // The feature is now referenced — deleting it must be blocked.
    const deleteFeatureRes = await featureDeleteDELETE(plainRequest(`http://localhost/api/platform/features/${feature.id}`, 'DELETE', adminToken), {
      params: Promise.resolve({ id: feature.id }),
    });
    expect(deleteFeatureRes.status).toBe(409);
    expect((await deleteFeatureRes.json()).error.code).toBe('FEATURE_IN_USE');

    const getFeatureRes = await featureGetGET(plainRequest(`http://localhost/api/platform/features/${feature.id}`, 'GET', adminToken), {
      params: Promise.resolve({ id: feature.id }),
    });
    expect((await getFeatureRes.json()).isReferenced).toBe(true);

    const packageDetailRes = await packageGetGET(plainRequest(`http://localhost/api/platform/packages/${pkg.id}`, 'GET', adminToken), {
      params: Promise.resolve({ id: pkg.id }),
    });
    expect((await packageDetailRes.json()).features).toEqual([{ featureId: feature.id, limit: 10 }]);

    const patchPackageRes = await packagePatchPATCH(
      jsonRequest(`http://localhost/api/platform/packages/${pkg.id}`, 'PATCH', { isActive: false }, adminToken),
      { params: Promise.resolve({ id: pkg.id }) },
    );
    expect(patchPackageRes.status).toBe(200);
    expect((await patchPackageRes.json()).isActive).toBe(false);
  }, 60_000);

  it('approves two AI models (neither auto-default, since the seed migration already seeded a platform default in this shared schema — the empty-allowlist "first approval auto-becomes default" case is unit-proven separately in ai-models.service.test.ts), reassigns default, and enforces DEFAULT_MODEL_REQUIRED', async () => {
    // Captures whichever model is default *before* this test touches anything, so it can be restored
    // afterward regardless of what earlier manual verification/dev runs against this shared schema
    // left as the current default — this test must not permanently change the schema's default.
    const beforeListRes = await aiModelsListGET(plainRequest('http://localhost/api/platform/ai-models?includeDisabled=true', 'GET', adminToken));
    const originalDefaultId: string | undefined = (await beforeListRes.json()).items.find(
      (m: { isPlatformDefault: boolean }) => m.isPlatformDefault,
    )?.id;

    const firstModelId = `p2b-${runId}/model-one`;
    const firstRes = await aiModelsCreatePOST(
      jsonRequest('http://localhost/api/platform/ai-models', 'POST', { openRouterModelId: firstModelId, displayName: 'Model One' }, adminToken),
    );
    expect(firstRes.status).toBe(201);
    const first = await firstRes.json();
    createdModelIds.push(first.id);
    // Only auto-default if the allowlist was genuinely empty beforehand (the empty-allowlist
    // "first-ever approval auto-becomes default" case itself is unit-proven separately in
    // ai-models.service.test.ts with a fully controlled fake repository) — this shared, already-
    // migrated schema normally already has the seed migration's default row, so this is normally
    // `false`, but the assertion is derived rather than hardcoded so the test holds either way.
    expect(first.isPlatformDefault).toBe(originalDefaultId === undefined);

    const secondModelId = `p2b-${runId}/model-two`;
    const secondRes = await aiModelsCreatePOST(
      jsonRequest('http://localhost/api/platform/ai-models', 'POST', { openRouterModelId: secondModelId, displayName: 'Model Two' }, adminToken),
    );
    const second = await secondRes.json();
    createdModelIds.push(second.id);
    // The allowlist is never empty by the time `second` is approved (`first` already exists), so this
    // is unconditionally not auto-default.
    expect(second.isPlatformDefault).toBe(false);

    const invalidIdRes = await aiModelsCreatePOST(
      jsonRequest('http://localhost/api/platform/ai-models', 'POST', { openRouterModelId: 'not-a-valid-shape', displayName: 'Bad' }, adminToken),
    );
    expect(invalidIdRes.status).toBe(400);
    expect((await invalidIdRes.json()).error.code).toBe('INVALID_MODEL_ID');

    // Promote the first of these two new models to platform default.
    const setDefaultRes = await aiModelSetDefaultPUT(
      plainRequest(`http://localhost/api/platform/ai-models/${first.id}/default`, 'PUT', adminToken),
      { params: Promise.resolve({ id: first.id }) },
    );
    expect(setDefaultRes.status).toBe(200);
    expect((await setDefaultRes.json()).isPlatformDefault).toBe(true);

    // Cannot disable the current default without designating a replacement first.
    const disableDefaultRes = await aiModelPatchPATCH(
      jsonRequest(`http://localhost/api/platform/ai-models/${first.id}`, 'PATCH', { isEnabled: false }, adminToken),
      { params: Promise.resolve({ id: first.id }) },
    );
    expect(disableDefaultRes.status).toBe(409);
    expect((await disableDefaultRes.json()).error.code).toBe('DEFAULT_MODEL_REQUIRED');

    // Promote the second model to default instead, then the first is free to disable.
    const setDefaultAgainRes = await aiModelSetDefaultPUT(
      plainRequest(`http://localhost/api/platform/ai-models/${second.id}/default`, 'PUT', adminToken),
      { params: Promise.resolve({ id: second.id }) },
    );
    expect(setDefaultAgainRes.status).toBe(200);
    expect((await setDefaultAgainRes.json()).isPlatformDefault).toBe(true);

    const nowDisableFirstRes = await aiModelPatchPATCH(
      jsonRequest(`http://localhost/api/platform/ai-models/${first.id}`, 'PATCH', { isEnabled: false }, adminToken),
      { params: Promise.resolve({ id: first.id }) },
    );
    expect(nowDisableFirstRes.status).toBe(200);
    expect((await nowDisableFirstRes.json()).isEnabled).toBe(false);

    const listRes = await aiModelsListGET(plainRequest('http://localhost/api/platform/ai-models?includeDisabled=true', 'GET', adminToken));
    const listBody = await listRes.json();
    expect(listBody.items.some((m: { id: string }) => m.id === first.id)).toBe(true);

    // Restore whatever the platform default was *before* this test ran, so this test file doesn't
    // leave the shared schema's default permanently pointed at a throwaway test row that this suite's
    // own afterAll is about to delete (which would otherwise leave `approved_ai_model` with zero
    // default rows, breaking every other suite's/manual-verification's assumption that a default
    // always exists). `second` also needs re-enabling first if a later step disabled it — it never
    // was disabled in this test, but re-enabling defensively costs nothing and future-proofs this
    // cleanup against a reordering of the steps above.
    if (originalDefaultId) {
      await aiModelPatchPATCH(jsonRequest(`http://localhost/api/platform/ai-models/${originalDefaultId}`, 'PATCH', { isEnabled: true }, adminToken), {
        params: Promise.resolve({ id: originalDefaultId }),
      });
      await aiModelSetDefaultPUT(plainRequest(`http://localhost/api/platform/ai-models/${originalDefaultId}/default`, 'PUT', adminToken), {
        params: Promise.resolve({ id: originalDefaultId }),
      });
    }
  }, 60_000);

  it('assigns/unassigns a real provisioned tenant to an AI model via the tenant-realm route, and MODEL_IN_USE blocks removal while assigned', async () => {
    const slug = `p2b-${runId}-tenant`;
    const modelId = `p2b-${runId}/tenant-model`;
    const modelRes = await aiModelsCreatePOST(
      jsonRequest('http://localhost/api/platform/ai-models', 'POST', { openRouterModelId: modelId, displayName: 'Tenant Model' }, adminToken),
    );
    const model = await modelRes.json();
    createdModelIds.push(model.id);

    const tenantRes = await tenantsCreatePOST(
      jsonRequest('http://localhost/api/platform/tenants', 'POST', { name: 'Phase2b Tenant', subdomainSlug: slug, adminEmail: `admin@${slug}.local` }, adminToken),
    );
    const tenant = await tenantRes.json();
    createdTenantIds.push(tenant.id);
    createdTenantSchemas.push(tenant.schemaName);

    const assignRes = await tenantAiModelPUT(
      jsonRequest(`http://localhost/api/platform/tenants/${tenant.id}/ai-model`, 'PUT', { approvedAiModelId: model.id }, adminToken),
      { params: Promise.resolve({ id: tenant.id }) },
    );
    expect(assignRes.status).toBe(200);
    const assigned = await assignRes.json();
    expect(assigned).toEqual({ source: 'assigned', openRouterModelId: model.openRouterModelId, displayName: model.displayName });

    // A model still explicitly assigned to a tenant cannot be removed.
    const blockedDeleteRes = await aiModelDeleteDELETE(plainRequest(`http://localhost/api/platform/ai-models/${model.id}`, 'DELETE', adminToken), {
      params: Promise.resolve({ id: model.id }),
    });
    expect(blockedDeleteRes.status).toBe(409);
    const blockedBody = await blockedDeleteRes.json();
    expect(blockedBody.error.code).toBe('MODEL_IN_USE');
    expect(blockedBody.error.details.tenantCount).toBe(1);

    const unassignRes = await tenantAiModelDELETE(plainRequest(`http://localhost/api/platform/tenants/${tenant.id}/ai-model`, 'DELETE', adminToken), {
      params: Promise.resolve({ id: tenant.id }),
    });
    expect(unassignRes.status).toBe(200);
    expect((await unassignRes.json()).source).toBe('platform_default');

    // Now unassigned — removal succeeds.
    const deleteRes = await aiModelDeleteDELETE(plainRequest(`http://localhost/api/platform/ai-models/${model.id}`, 'DELETE', adminToken), {
      params: Promise.resolve({ id: model.id }),
    });
    expect(deleteRes.status).toBe(204);
    createdModelIds.splice(createdModelIds.indexOf(model.id), 1);
  }, 60_000);

  it('a PUT/DELETE .../ai-model against an unknown tenant id is TENANT_NOT_FOUND, owned by platform/tenants', async () => {
    const res = await tenantAiModelPUT(
      jsonRequest('http://localhost/api/platform/tenants/does-not-exist/ai-model', 'PUT', { approvedAiModelId: 'whatever' }, adminToken),
      { params: Promise.resolve({ id: 'does-not-exist' }) },
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('TENANT_NOT_FOUND');
  });
});
