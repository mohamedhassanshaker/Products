import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getEnv } from '@/server/config';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { BcryptPasswordHasherAdapter, JwtPlatformTokenAdapter } from '@/server/infrastructure/security';
import { PlatformAdminRepository } from '@/server/platform/auth';
import { AuditLogRepository } from '@/server/platform/audit';
import { POST as tenantsCreatePOST } from '@/app/api/platform/tenants/route';
import { POST as tenantSuspendPOST } from '@/app/api/platform/tenants/[id]/suspend/route';
import { POST as featuresCreatePOST } from '@/app/api/platform/features/route';
import { DELETE as featureDeleteDELETE } from '@/app/api/platform/features/[id]/route';
import { GET as reliabilityGET } from '@/app/api/platform/reliability/route';
import { GET as auditLogGET } from '@/app/api/platform/audit-log/route';

/**
 * Phase 2 sub-slice "2d" (`platform/audit`, `platform/reliability`, `TenantMaintenanceWorker`) —
 * real-route-level regression coverage for this dispatch's new `app/api/platform/{reliability,
 * audit-log}/**` Route Handlers, plus a real end-to-end proof that this dispatch's own audit-log
 * retrofit (2a/2b/2c's already-shipped mutating routes) actually writes a real `platform.audit_log`
 * row — matching the exact convention every prior `phase2*-routes.integration.test.ts` file already
 * established: call the REAL exported Route Handler functions with a genuine `NextRequest`, real
 * MySQL, no mocked service layer.
 *
 * Run via:
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     npx vitest run src/server/phase2d-platform-audit-reliability.integration.test.ts
 */
describe('Phase 2 (2d) — platform/audit retrofit + platform/reliability dashboard real routes', () => {
  const slugPrefix = `p2d-${randomUUID().slice(0, 8)}`;
  let adminToken: string;
  let platformAdminId: string;
  const createdTenantIds: string[] = [];
  const createdTenantSchemas: string[] = [];
  const createdFeatureIds: string[] = [];

  beforeAll(async () => {
    const env = getEnv();
    const platformDs = await getPlatformDataSource();
    const admins = new PlatformAdminRepository(platformDs);
    const hasher = new BcryptPasswordHasherAdapter(4); // low cost factor — this suite's own speed concern only.
    const passwordHash = await hasher.hash('Real-Admin-Pass-1');
    const inserted = await admins.insert({
      id: randomUUID(),
      email: `${slugPrefix}-admin@integration-test.local`,
      passwordHash,
      name: 'Phase2d Test Admin',
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
      await platformDs.query('DELETE FROM audit_log WHERE tenant_id = ?', [id]);
      await platformDs.query('DELETE FROM tenant_provisioning_step WHERE tenant_id = ?', [id]);
      await platformDs.query('DELETE FROM tenant_subscription WHERE tenant_id = ?', [id]);
      await platformDs.query('DELETE FROM tenant WHERE id = ?', [id]);
    }
    for (const id of createdFeatureIds) {
      await platformDs.query('DELETE FROM audit_log WHERE target_id = ?', [id]);
      await platformDs.query('DELETE FROM feature WHERE id = ?', [id]);
    }
    if (platformAdminId) {
      await platformDs.query('DELETE FROM audit_log WHERE actor_id = ?', [platformAdminId]);
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

  it('writes a real platform.audit_log row when a tenant is suspended through the real route, visible via GET /api/platform/audit-log', async () => {
    const slug = `${slugPrefix}-a`;
    const createRes = await tenantsCreatePOST(
      jsonRequest('http://localhost/api/platform/tenants', 'POST', { name: 'Phase2d Tenant A', subdomainSlug: slug, adminEmail: `admin@${slug}.local` }, adminToken),
    );
    const created = await createRes.json();
    createdTenantIds.push(created.id);
    createdTenantSchemas.push(created.schemaName);

    const suspendRes = await tenantSuspendPOST(plainRequest(`http://localhost/api/platform/tenants/${created.id}/suspend`, 'POST', adminToken), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(suspendRes.status).toBe(200);

    // The create itself is also audit-logged (tenant.create) — both rows should now exist for this
    // tenant, oldest-first is not asserted (newest-first is this endpoint's own convention), just that
    // both actions are present.
    const auditRes = await auditLogGET(plainRequest(`http://localhost/api/platform/audit-log?targetId=${created.id}`, 'GET', adminToken));
    expect(auditRes.status).toBe(200);
    const auditBody = await auditRes.json();
    const actions = auditBody.items.map((row: { action: string }) => row.action);
    expect(actions).toContain('tenant.suspend');
    expect(actions).toContain('tenant.create');
    const suspendRow = auditBody.items.find((row: { action: string }) => row.action === 'tenant.suspend');
    expect(suspendRow.actorType).toBe('PlatformAdmin');
    expect(suspendRow.actorId).toBe(platformAdminId);
    expect(suspendRow.summary).toEqual({ statusAfter: 'Suspended' });
  }, 60_000);

  it('filters the audit log by actorId/action, combined with AND', async () => {
    const slug = `${slugPrefix}-b`;
    const createRes = await tenantsCreatePOST(
      jsonRequest('http://localhost/api/platform/tenants', 'POST', { name: 'Phase2d Tenant B', subdomainSlug: slug, adminEmail: `admin@${slug}.local` }, adminToken),
    );
    const created = await createRes.json();
    createdTenantIds.push(created.id);
    createdTenantSchemas.push(created.schemaName);

    const res = await auditLogGET(
      plainRequest(`http://localhost/api/platform/audit-log?actorId=${platformAdminId}&action=tenant.create`, 'GET', adminToken),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((row: { action: string; actorId: string }) => row.action === 'tenant.create' && row.actorId === platformAdminId)).toBe(
      true,
    );
  }, 60_000);

  it('a real, forced audit-write failure never fails the outer mutating request (fail-open, proven at the HTTP layer)', async () => {
    // Forces the real AuditLogRepository.append() (the actual write path AuditLogService.record()
    // wraps) to reject — a genuine simulated partial failure of the underlying write, exercising the
    // REAL fail-open try/catch inside AuditLogService.record() itself (unlike mocking record()
    // directly, which would just replace that guarantee rather than proving it holds). Restored
    // unconditionally via vi.restoreAllMocks() in afterEach below.
    vi.spyOn(AuditLogRepository.prototype, 'append').mockRejectedValueOnce(new Error('simulated audit_log write failure'));

    const slug = `${slugPrefix}-c`;
    const createRes = await tenantsCreatePOST(
      jsonRequest('http://localhost/api/platform/tenants', 'POST', { name: 'Phase2d Tenant C', subdomainSlug: slug, adminEmail: `admin@${slug}.local` }, adminToken),
    );
    // The create itself must still succeed (201) even though the underlying audit write rejected —
    // AuditLogService.record() is documented fail-open (see its own unit test for the isolated proof);
    // this proves that guarantee holds end to end through the real HTTP route.
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    createdTenantIds.push(created.id);
    createdTenantSchemas.push(created.schemaName);
    expect(created.status).toBe('Active');
  }, 60_000);

  it('features.create/delete are also retrofitted with audit writes', async () => {
    const key = `p2d.audit.${randomUUID().slice(0, 8)}`;
    const createRes = await featuresCreatePOST(
      jsonRequest('http://localhost/api/platform/features', 'POST', { key, name: 'Phase2d Audit Feature', unit: 'items', resetPeriod: 'NONE' }, adminToken),
    );
    expect(createRes.status).toBe(201);
    const feature = await createRes.json();
    createdFeatureIds.push(feature.id);

    const deleteRes = await featureDeleteDELETE(plainRequest(`http://localhost/api/platform/features/${feature.id}`, 'DELETE', adminToken), {
      params: Promise.resolve({ id: feature.id }),
    });
    expect(deleteRes.status).toBe(204);

    const auditRes = await auditLogGET(plainRequest(`http://localhost/api/platform/audit-log?targetId=${feature.id}`, 'GET', adminToken));
    const auditBody = await auditRes.json();
    const actions = auditBody.items.map((row: { action: string }) => row.action);
    expect(actions).toContain('feature.create');
    expect(actions).toContain('feature.delete');
  }, 60_000);

  it('GET /api/platform/reliability returns a real cross-tenant snapshot (real outbox/file-cleanup counts, honest zero work-hints)', async () => {
    const res = await reliabilityGET(plainRequest('http://localhost/api/platform/reliability', 'GET', adminToken));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(typeof body.outbox.pending).toBe('number');
    expect(typeof body.outbox.delivered).toBe('number');
    expect(typeof body.outbox.deadLetter).toBe('number');
    expect(typeof body.fileCleanup.due).toBe('number');
    expect(Array.isArray(body.workHints)).toBe(true);
    expect(body.workHints.map((r: { kind: string }) => r.kind).sort()).toEqual(['attempt_timeout', 'outbox', 'pdf_session'].sort());
    // No producer of any hint kind is wired in this app yet (see TenantWorkHintEntity's own doc
    // comment) — every kind's pendingCount is honestly 0.
    expect(body.workHints.every((r: { pendingCount: number }) => r.pendingCount === 0)).toBe(true);
    expect(typeof body.tenantsScanned).toBe('number');
    expect(body.tenantsScanned).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('rejects an unauthenticated request to both new routes with 401 UNAUTHENTICATED', async () => {
    const reliabilityRes = await reliabilityGET(plainRequest('http://localhost/api/platform/reliability', 'GET'));
    expect(reliabilityRes.status).toBe(401);
    expect((await reliabilityRes.json()).error.code).toBe('UNAUTHENTICATED');

    const auditRes = await auditLogGET(plainRequest('http://localhost/api/platform/audit-log', 'GET'));
    expect(auditRes.status).toBe(401);
    expect((await auditRes.json()).error.code).toBe('UNAUTHENTICATED');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
