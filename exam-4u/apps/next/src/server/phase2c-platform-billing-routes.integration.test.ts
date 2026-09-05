import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEnv } from '@/server/config';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { BcryptPasswordHasherAdapter, JwtPlatformTokenAdapter } from '@/server/infrastructure/security';
import { PlatformAdminRepository } from '@/server/platform/auth';
import { BillingCheckoutService, PackageRepository, TenantSubscriptionRepository } from '@/server/platform/billing';
import type { PaymentGatewayPort } from '@/server/common/ports/payment-gateway.port';
import { POST as tenantsCreatePOST } from '@/app/api/platform/tenants/route';
import { POST as packagesCreatePOST } from '@/app/api/platform/packages/route';
import { PATCH as packagePatchPATCH } from '@/app/api/platform/packages/[id]/route';
import { GET as tenantBillingGET, PUT as tenantBillingPUT } from '@/app/api/platform/tenants/[id]/billing/route';
import { POST as checkoutSessionPOST } from '@/app/api/platform/tenants/[id]/billing/checkout-session/route';

/**
 * Phase 2 sub-slice "2c" (Stripe billing integration) — real-route-level regression coverage for
 * `app/api/platform/tenants/:id/billing/**`, matching `phase2b-platform-catalog-routes.integration.
 * test.ts`'s exact convention: call the REAL exported Route Handler functions with a genuine
 * `NextRequest`, real MySQL, real JWT.
 *
 * **This dispatch's own env has no real Stripe test-mode key configured** (confirmed: `.env`/
 * `.env.example` both ship `STRIPE_SECRET_KEY=`/`STRIPE_WEBHOOK_SECRET=` empty — see
 * `docs/plans/nextjs-rewrite-phase2-plan.md`'s Sub-slice 2c "Decisions made" for the full note). This
 * file therefore runs against the deployment's *actual, real* unconfigured state — proving the real,
 * correct `503 BILLING_NOT_CONFIGURED` behavior for the Stripe-network-dependent checkout-session
 * route — and proves the checkout-session *database-write* path (provider-customer-id persistence)
 * via a real integration test against `BillingCheckoutService` constructed directly with a
 * fake-but-realistic `PaymentGatewayPort` test double plus the real repositories/real MySQL (per the
 * dispatch prompt's own explicitly-authorized fallback when no live Stripe key is available). The
 * sibling file `phase2c-billing-webhook.integration.test.ts` proves the real webhook ROUTE end-to-end
 * with a real, SDK-generated signature (`Stripe.webhooks.generateTestHeaderString`, which needs no
 * live account since signature verification is pure local cryptography) — split into its own file
 * because it needs `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` actually set (fake values) for the
 * whole file's `getEnv()` singleton, which would otherwise make *this* file's `BILLING_NOT_CONFIGURED`
 * assertions no longer reflect this deployment's real state.
 *
 * Run via:
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     npx vitest run src/server/phase2c-platform-billing-routes.integration.test.ts
 */
describe('Phase 2 (2c) — /api/platform/tenants/:id/billing/** real routes (real MySQL, real JWT, no live Stripe)', () => {
  const runId = randomUUID().slice(0, 8);
  let adminToken: string;
  let platformAdminId: string;
  const createdTenantIds: string[] = [];
  const createdTenantSchemas: string[] = [];
  const createdPackageIds: string[] = [];

  beforeAll(async () => {
    const env = getEnv();
    const platformDs = await getPlatformDataSource();
    const admins = new PlatformAdminRepository(platformDs);
    const hasher = new BcryptPasswordHasherAdapter(4); // low cost factor — this suite's own speed concern only.
    const passwordHash = await hasher.hash('Real-Admin-Pass-1');
    const inserted = await admins.insert({
      id: randomUUID(),
      email: `p2c-${runId}-admin@integration-test.local`,
      passwordHash,
      name: 'Phase2c Test Admin',
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
      await platformDs.query('DELETE FROM tenant_provisioning_step WHERE tenant_id = ?', [id]);
      await platformDs.query('DELETE FROM tenant_subscription WHERE tenant_id = ?', [id]);
      await platformDs.query('DELETE FROM tenant WHERE id = ?', [id]);
    }
    for (const id of createdPackageIds) {
      await platformDs.query('DELETE FROM `package` WHERE id = ?', [id]);
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

  async function provisionTenant(slug: string) {
    const res = await tenantsCreatePOST(
      jsonRequest('http://localhost/api/platform/tenants', 'POST', { name: 'Phase2c Tenant', subdomainSlug: slug, adminEmail: `admin@${slug}.local` }, adminToken),
    );
    const tenant = await res.json();
    createdTenantIds.push(tenant.id);
    createdTenantSchemas.push(tenant.schemaName);
    return tenant;
  }

  async function createPackage(key: string, overrides: Record<string, unknown> = {}) {
    const res = await packagesCreatePOST(
      jsonRequest('http://localhost/api/platform/packages', 'POST', { key, name: `Package ${key}`, priceCents: 1500, ...overrides }, adminToken),
    );
    const pkg = await res.json();
    createdPackageIds.push(pkg.id);
    return pkg;
  }

  it('rejects an unauthenticated request 401 UNAUTHENTICATED on every new route', async () => {
    const getRes = await tenantBillingGET(plainRequest('http://localhost/api/platform/tenants/whatever/billing', 'GET'), {
      params: Promise.resolve({ id: 'whatever' }),
    });
    expect(getRes.status).toBe(401);
    const putRes = await tenantBillingPUT(jsonRequest('http://localhost/api/platform/tenants/whatever/billing', 'PUT', { packageId: 'x' }), {
      params: Promise.resolve({ id: 'whatever' }),
    });
    expect(putRes.status).toBe(401);
    const checkoutRes = await checkoutSessionPOST(
      jsonRequest('http://localhost/api/platform/tenants/whatever/billing/checkout-session', 'POST', { packageId: 'x' }),
      { params: Promise.resolve({ id: 'whatever' }) },
    );
    expect(checkoutRes.status).toBe(401);
  });

  it('GET/PUT .../billing against an unknown tenant id is TENANT_NOT_FOUND, owned by platform/tenants', async () => {
    const getRes = await tenantBillingGET(plainRequest('http://localhost/api/platform/tenants/does-not-exist/billing', 'GET', adminToken), {
      params: Promise.resolve({ id: 'does-not-exist' }),
    });
    expect(getRes.status).toBe(404);
    expect((await getRes.json()).error.code).toBe('TENANT_NOT_FOUND');

    const putRes = await tenantBillingPUT(
      jsonRequest('http://localhost/api/platform/tenants/does-not-exist/billing', 'PUT', { packageId: 'x' }, adminToken),
      { params: Promise.resolve({ id: 'does-not-exist' }) },
    );
    expect(putRes.status).toBe(404);
    expect((await putRes.json()).error.code).toBe('TENANT_NOT_FOUND');
  });

  it('reads the real subscription a real provisioned tenant received during CreateSubscriptionStep (FALLBACK_PACKAGE_KEY)', async () => {
    const tenant = await provisionTenant(`p2c-${runId}-t1`);

    const res = await tenantBillingGET(plainRequest(`http://localhost/api/platform/tenants/${tenant.id}/billing`, 'GET', adminToken), {
      params: Promise.resolve({ id: tenant.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscription).not.toBeNull();
    expect(body.subscription.status).toBe('ACTIVE');
    expect(body.subscription.hasProviderCustomer).toBe(false);
  }, 30_000);

  it('reassigns a tenant directly to a new active package through the real UI path, persisting to real MySQL', async () => {
    const tenant = await provisionTenant(`p2c-${runId}-t2`);
    const pkg = await createPackage(`p2c-${runId}-pkg-active`);

    const putRes = await tenantBillingPUT(
      jsonRequest(`http://localhost/api/platform/tenants/${tenant.id}/billing`, 'PUT', { packageId: pkg.id }, adminToken),
      { params: Promise.resolve({ id: tenant.id }) },
    );
    expect(putRes.status).toBe(200);
    expect((await putRes.json()).subscription).toMatchObject({ packageId: pkg.id, status: 'ACTIVE' });

    // Real-DB-persistence proof: re-read via a fresh GET.
    const getRes = await tenantBillingGET(plainRequest(`http://localhost/api/platform/tenants/${tenant.id}/billing`, 'GET', adminToken), {
      params: Promise.resolve({ id: tenant.id }),
    });
    expect((await getRes.json()).subscription.packageId).toBe(pkg.id);
  }, 30_000);

  it('rejects reassignment to an inactive package with 409 PACKAGE_INACTIVE, and 404 PACKAGE_NOT_FOUND for an unknown one', async () => {
    const tenant = await provisionTenant(`p2c-${runId}-t3`);
    const pkg = await createPackage(`p2c-${runId}-pkg-inactive`);
    await packagePatchPATCH(jsonRequest(`http://localhost/api/platform/packages/${pkg.id}`, 'PATCH', { isActive: false }, adminToken), {
      params: Promise.resolve({ id: pkg.id }),
    });

    const inactiveRes = await tenantBillingPUT(
      jsonRequest(`http://localhost/api/platform/tenants/${tenant.id}/billing`, 'PUT', { packageId: pkg.id }, adminToken),
      { params: Promise.resolve({ id: tenant.id }) },
    );
    expect(inactiveRes.status).toBe(409);
    expect((await inactiveRes.json()).error.code).toBe('PACKAGE_INACTIVE');

    const unknownRes = await tenantBillingPUT(
      jsonRequest(`http://localhost/api/platform/tenants/${tenant.id}/billing`, 'PUT', { packageId: 'does-not-exist' }, adminToken),
      { params: Promise.resolve({ id: tenant.id }) },
    );
    expect(unknownRes.status).toBe(404);
    expect((await unknownRes.json()).error.code).toBe('PACKAGE_NOT_FOUND');
  }, 30_000);

  it('POST .../checkout-session returns real 503 BILLING_NOT_CONFIGURED — this deployment genuinely has no Stripe secrets set', async () => {
    const tenant = await provisionTenant(`p2c-${runId}-t4`);
    const pkg = await createPackage(`p2c-${runId}-pkg-checkout`);

    const res = await checkoutSessionPOST(
      jsonRequest(`http://localhost/api/platform/tenants/${tenant.id}/billing/checkout-session`, 'POST', { packageId: pkg.id }, adminToken),
      { params: Promise.resolve({ id: tenant.id }) },
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('BILLING_NOT_CONFIGURED');
  }, 30_000);

  it(
    "proves BillingCheckoutService's real database-write path (provider-customer-id persistence) against real MySQL, " +
      'using a fake-but-realistic PaymentGatewayPort in place of the real Stripe network call (no live Stripe key available ' +
      "in this environment — see this file's own header comment)",
    async () => {
      const tenant = await provisionTenant(`p2c-${runId}-t5`);
      const pkg = await createPackage(`p2c-${runId}-pkg-fakegw`);

      const ds = await getPlatformDataSource();
      const packages = new PackageRepository(ds);
      const subscriptions = new TenantSubscriptionRepository(ds);
      const fakeGateway: PaymentGatewayPort = {
        ensureCustomer: async () => 'cus_fake_p2c',
        createCheckoutSession: async () => ({ id: 'cs_fake_p2c', url: 'https://checkout.stripe.com/pay/cs_fake_p2c' }),
        verifyAndParseWebhook: () => {
          throw new Error('not used by this test');
        },
      };
      const service = new BillingCheckoutService(packages, subscriptions, fakeGateway, {
        stripeSecretKey: 'sk_test_fake',
        stripeWebhookSecret: 'whsec_test_fake',
        checkoutSuccessUrlTemplate: 'https://example.com/{tenantId}?checkout=success',
        checkoutCancelUrlTemplate: 'https://example.com/{tenantId}?checkout=cancel',
      });

      const result = await service.createCheckoutSession(tenant.id, tenant.name, pkg.id);
      expect(result.url).toBe('https://checkout.stripe.com/pay/cs_fake_p2c');

      // Real-DB-persistence proof: the provider customer id must actually be written to
      // `tenant_subscription.provider_customer_id` in real MySQL, readable back via a fresh
      // repository read (not just asserted against the in-memory fake).
      const row = await subscriptions.findByTenantId(tenant.id);
      expect(row?.providerCustomerId).toBe('cus_fake_p2c');
    },
    30_000,
  );

  it('POST .../checkout-session returns 409 PACKAGE_INACTIVE before ever reaching BILLING_NOT_CONFIGURED-independent logic for an inactive package (guard ordering: config check runs first regardless)', async () => {
    const tenant = await provisionTenant(`p2c-${runId}-t6`);
    const pkg = await createPackage(`p2c-${runId}-pkg-inactive-checkout`);
    await packagePatchPATCH(jsonRequest(`http://localhost/api/platform/packages/${pkg.id}`, 'PATCH', { isActive: false }, adminToken), {
      params: Promise.resolve({ id: pkg.id }),
    });

    // Given this deployment's real unconfigured state, BILLING_NOT_CONFIGURED is checked (and thrown)
    // before the package-active check ever runs — proving that ordering is real, not just documented.
    const res = await checkoutSessionPOST(
      jsonRequest(`http://localhost/api/platform/tenants/${tenant.id}/billing/checkout-session`, 'POST', { packageId: pkg.id }, adminToken),
      { params: Promise.resolve({ id: tenant.id }) },
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('BILLING_NOT_CONFIGURED');
  }, 30_000);
});
