import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { getTenantProvisioningService } from '@/server/platform/provisioning';
import { getAuthService } from '@/server/auth';
import { RoleRepository, UserRoleRepository, UserRoleAssignmentService } from '@/server/rbac';
import { requireTenantDataSource, runWithRequestContext } from '@/server/context';
import { PackageRepository, TenantSubscriptionRepository, BillingCheckoutService, TenantBillingService } from '@/server/platform/billing';
import type { PaymentGatewayPort } from '@/server/common/ports/payment-gateway.port';
import { GET as plansGET } from '@/app/api/tenant/billing/plans/route';
import { POST as checkoutSessionPOST } from '@/app/api/tenant/billing/checkout-session/route';

/**
 * Migration plan Phase 9 sub-slice "9b" (self-serve tenant billing, FR-PKG-6's self-serve half) —
 * real-route-level regression coverage for `app/api/tenant/billing/**`, matching
 * `phase3-taxonomy-curricula-routes.integration.test.ts`'s exact convention: call the REAL exported
 * Route Handler functions with a genuine `NextRequest` (trusted `x-tenant-*` headers + a real bearer
 * token), real MySQL, real `jose` JWTs.
 *
 * **This deployment's env has no real Stripe test-mode key configured** (same constraint Phase 2
 * sub-slice "2c" documented and this sub-slice's own dispatch brief re-confirms) — `POST
 * .../checkout-session`'s real-unconfigured-deployment `503 BILLING_NOT_CONFIGURED` path is proven
 * directly against the real route below. The load-bearing "redirect URL points back to *this*
 * tenant's own `/settings/billing` origin, not the Platform Admin console's" guarantee is proven via
 * `TenantBillingService` constructed directly with a fake-but-realistic `PaymentGatewayPort` test
 * double (real repositories, real MySQL) — the exact fallback pattern
 * `phase2c-platform-billing-routes.integration.test.ts`'s own "proves BillingCheckoutService's real
 * database-write path..." test already established for the identical no-live-Stripe-key constraint.
 *
 * Run via:
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     npx vitest run src/server/phase9b-tenant-billing-routes.integration.test.ts
 */
describe('Phase 9 (9b) — /api/tenant/billing/** real routes (real MySQL, real JWT, no live Stripe)', () => {
  const slug = `p9b-${randomUUID().slice(0, 8)}`;
  let tenantId: string;
  let tenantSchema: string;
  let adminToken: string;
  let memberToken: string;
  let readOnlyToken: string;

  beforeAll(async () => {
    const provisioning = await getTenantProvisioningService();
    const tenant = await provisioning.provisionNewTenant({ name: 'Phase9b Tenant', subdomainSlug: slug, adminEmail: `admin@${slug}.local` });
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

        // Tenant Admin — holds both billing.read and billing.manage (SeedRbacStep's cross-join grant).
        const adminEmail = `p9badmin-${randomUUID().slice(0, 8)}@${slug}.local`;
        const adminRegistered = await auth.register({ email: adminEmail, password: 'Abcdefg1', firstName: 'P9b', lastName: 'Admin' });
        const tenantAdminRole = await roles.findByName('Tenant Admin');
        if (!tenantAdminRole) throw new Error('Tenant Admin role not seeded — cannot run this suite.');
        await assignment.replaceRolesForUser(adminRegistered.user.id, [tenantAdminRole.id]);
        adminToken = (await auth.login({ email: adminEmail, password: 'Abcdefg1' })).accessToken;

        // Member — per SeedRbacStep's MEMBER_PERMISSIONS list, holds neither billing.read nor
        // billing.manage (proves the fail-closed default for a role that was never granted billing at
        // all, distinct from the read-only-but-not-manage scenario below).
        const memberRole = await roles.findByName('Member');
        if (!memberRole) throw new Error('Member role not seeded — cannot run this suite.');
        const memberEmail = `p9bmember-${randomUUID().slice(0, 8)}@${slug}.local`;
        const memberRegistered = await auth.register({ email: memberEmail, password: 'Abcdefg1', firstName: 'P9b', lastName: 'Member' });
        await assignment.replaceRolesForUser(memberRegistered.user.id, [memberRole.id]);
        memberToken = (await auth.login({ email: memberEmail, password: 'Abcdefg1' })).accessToken;

        // A billing.read-only, non-billing.manage role — §17.0's forward-defensive "future role" case,
        // not stated as existing yet in this app's default seed; constructed here specifically to prove
        // the read/write permission split really is enforced at the route layer, not merely documented.
        const permissionRows: { id: number; name: string }[] = await requireTenantDataSource().query(
          "SELECT id, name FROM permission WHERE name = 'billing.read'",
        );
        const billingReadPermissionId = permissionRows[0]?.id;
        if (!billingReadPermissionId) throw new Error('billing.read permission not seeded — cannot run this suite.');
        const readOnlyRoleResult: { insertId: number } = await requireTenantDataSource().query(
          "INSERT INTO role (name, description, is_system) VALUES ('Billing Viewer', 'Read-only billing access.', 0)",
        );
        const readOnlyRoleId = (readOnlyRoleResult as unknown as { insertId: number }[])[0]?.insertId ?? readOnlyRoleResult.insertId;
        await requireTenantDataSource().query('INSERT INTO role_permission (role_id, permission_id) VALUES (?, ?)', [
          readOnlyRoleId,
          billingReadPermissionId,
        ]);
        const readOnlyEmail = `p9breadonly-${randomUUID().slice(0, 8)}@${slug}.local`;
        const readOnlyRegistered = await auth.register({ email: readOnlyEmail, password: 'Abcdefg1', firstName: 'P9b', lastName: 'ReadOnly' });
        await assignment.replaceRolesForUser(readOnlyRegistered.user.id, [readOnlyRoleId]);
        readOnlyToken = (await auth.login({ email: readOnlyEmail, password: 'Abcdefg1' })).accessToken;
      });
    } finally {
      registry.release(tenantSchema);
    }
  }, 60_000);

  afterAll(async () => {
    const platformDs = await getPlatformDataSource();
    if (tenantSchema) {
      const conn = await mysql.createConnection({ host: 'localhost', port: 3306, user: 'examland', password: 'examland_dev' });
      try {
        await conn.query(`DROP DATABASE IF EXISTS \`${tenantSchema}\``);
      } finally {
        await conn.end();
      }
    }
    if (tenantId) {
      await platformDs.query('DELETE FROM tenant_provisioning_step WHERE tenant_id = ?', [tenantId]);
      await platformDs.query('DELETE FROM tenant_subscription WHERE tenant_id = ?', [tenantId]);
      await platformDs.query('DELETE FROM tenant WHERE id = ?', [tenantId]);
    }
    await getTenantDataSourceRegistry().destroyAll();
    await platformDs.destroy();
  });

  function req(url: string, method: string, token?: string, body?: unknown): NextRequest {
    const headers: Record<string, string> = { 'x-tenant-id': tenantId, 'x-tenant-slug': slug, 'x-tenant-schema': tenantSchema };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    return new NextRequest(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }

  it('rejects an unauthenticated request to both routes with 401', async () => {
    const plansRes = await plansGET(req('http://localhost/api/tenant/billing/plans', 'GET'));
    expect(plansRes.status).toBe(401);
    const checkoutRes = await checkoutSessionPOST(
      req('http://localhost/api/tenant/billing/checkout-session', 'POST', undefined, { packageId: 'x' }),
    );
    expect(checkoutRes.status).toBe(401);
  });

  it('rejects a Member (holds neither billing.read nor billing.manage) with 403 FORBIDDEN on both routes', async () => {
    const plansRes = await plansGET(req('http://localhost/api/tenant/billing/plans', 'GET', memberToken));
    expect(plansRes.status).toBe(403);
    expect((await plansRes.json()).error.code).toBe('FORBIDDEN');

    const checkoutRes = await checkoutSessionPOST(
      req('http://localhost/api/tenant/billing/checkout-session', 'POST', memberToken, { packageId: 'x' }),
    );
    expect(checkoutRes.status).toBe(403);
  });

  it("a Tenant Admin's GET /api/tenant/billing/plans reads the real subscription CreateSubscriptionStep provisioned (FALLBACK_PACKAGE_KEY)", async () => {
    const res = await plansGET(req('http://localhost/api/tenant/billing/plans', 'GET', adminToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ACTIVE');
    expect(body.currentPackageId).not.toBeNull();
    expect(Array.isArray(body.packages)).toBe(true);
    expect(body.packages.length).toBeGreaterThan(0);
  }, 30_000);

  it('a billing.read-only (no billing.manage) user CAN read the plan catalog but is FORBIDDEN from initiating checkout', async () => {
    const plansRes = await plansGET(req('http://localhost/api/tenant/billing/plans', 'GET', readOnlyToken));
    expect(plansRes.status).toBe(200);

    const checkoutRes = await checkoutSessionPOST(
      req('http://localhost/api/tenant/billing/checkout-session', 'POST', readOnlyToken, { packageId: 'does-not-matter' }),
    );
    expect(checkoutRes.status).toBe(403);
    expect((await checkoutRes.json()).error.code).toBe('FORBIDDEN');
  }, 30_000);

  it('POST /api/tenant/billing/checkout-session returns real 503 BILLING_NOT_CONFIGURED — this deployment genuinely has no Stripe secrets set', async () => {
    const plans = await (await plansGET(req('http://localhost/api/tenant/billing/plans', 'GET', adminToken))).json();
    const packageId = plans.packages[0].id;

    const res = await checkoutSessionPOST(
      req('http://localhost/api/tenant/billing/checkout-session', 'POST', adminToken, { packageId }),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('BILLING_NOT_CONFIGURED');
  }, 30_000);

  it(
    "proves TenantBillingService.initiateCheckout's redirect URLs genuinely point back to THIS tenant's own " +
      "/settings/billing origin (never the Platform Admin console's /platform/tenants/{id} default) — real MySQL, " +
      'a fake-but-realistic PaymentGatewayPort in place of the real Stripe network call (no live Stripe key ' +
      'available in this environment, matching phase2c-platform-billing-routes.integration.test.ts\'s own identical constraint)',
    async () => {
      const ds = await getPlatformDataSource();
      const packages = new PackageRepository(ds);
      const subscriptions = new TenantSubscriptionRepository(ds);
      const pkgs = await packages.findAllActive();
      const targetPackage = pkgs[0];
      expect(targetPackage).toBeDefined();

      let capturedSuccessUrl = '';
      let capturedCancelUrl = '';
      const fakeGateway: PaymentGatewayPort = {
        ensureCustomer: async () => 'cus_fake_p9b',
        createCheckoutSession: async (input) => {
          capturedSuccessUrl = input.successUrl;
          capturedCancelUrl = input.cancelUrl;
          return { id: 'cs_fake_p9b', url: 'https://checkout.stripe.com/pay/cs_fake_p9b' };
        },
        verifyAndParseWebhook: () => {
          throw new Error('not used by this test');
        },
      };
      const checkout = new BillingCheckoutService(packages, subscriptions, fakeGateway, {
        stripeSecretKey: 'sk_test_fake',
        stripeWebhookSecret: 'whsec_test_fake',
        // Deliberately the Platform Admin console's own default template — if TenantBillingService
        // failed to override it with its own tenantOrigin-based redirectUrls, the assertions below
        // would catch it (the captured URL would contain `/platform/tenants/` instead of the tenant's
        // own subdomain + `/settings/billing`).
        checkoutSuccessUrlTemplate: 'https://examland.app/platform/tenants/{tenantId}?checkout=success',
        checkoutCancelUrlTemplate: 'https://examland.app/platform/tenants/{tenantId}?checkout=cancel',
      });
      const tenantBilling = new TenantBillingService(packages, subscriptions, checkout);

      const tenantOrigin = `https://${slug}.examland.app`;
      const result = await tenantBilling.initiateCheckout(tenantId, 'Phase9b Tenant', tenantOrigin, targetPackage.id);
      expect(result.url).toBe('https://checkout.stripe.com/pay/cs_fake_p9b');

      expect(capturedSuccessUrl).toBe(`${tenantOrigin}/settings/billing?checkout=success`);
      expect(capturedCancelUrl).toBe(`${tenantOrigin}/settings/billing?checkout=cancel`);
      expect(capturedSuccessUrl).not.toContain('/platform/tenants/');
      expect(capturedCancelUrl).not.toContain('/platform/tenants/');
    },
    30_000,
  );
});
