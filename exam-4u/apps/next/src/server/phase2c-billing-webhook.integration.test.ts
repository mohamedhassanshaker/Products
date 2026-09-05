import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import mysql from 'mysql2/promise';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getEnv } from '@/server/config';
import { getPlatformDataSource, getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { BcryptPasswordHasherAdapter, JwtPlatformTokenAdapter } from '@/server/infrastructure/security';
import { PlatformAdminRepository } from '@/server/platform/auth';
import { POST as tenantsCreatePOST } from '@/app/api/platform/tenants/route';
import { POST as packagesCreatePOST } from '@/app/api/platform/packages/route';
import { POST as webhookPOST } from '@/app/api/platform/billing/webhook/route';

/**
 * Phase 2 sub-slice "2c" — real-route-level proof of `POST /api/platform/billing/webhook`, the
 * webhook-driven half of Stripe billing (FR-PKG-6). Split into its own file (not folded into
 * `phase2c-platform-billing-routes.integration.test.ts`) because it needs `STRIPE_SECRET_KEY`/
 * `STRIPE_WEBHOOK_SECRET` actually set (fake values, below) for this file's own `getEnv()` singleton,
 * which would otherwise make the sibling file's `BILLING_NOT_CONFIGURED` assertions no longer reflect
 * this deployment's real (genuinely unconfigured) state. Vitest's default per-file worker isolation
 * means this file's `process.env`/`globalThis` mutations never leak to any other test file.
 *
 * **No live Stripe account needed for this proof** — per the dispatch prompt's own explicit guidance,
 * `Stripe.webhooks.generateTestHeaderString` produces a genuinely, cryptographically valid signature
 * for a given secret entirely locally (Stripe's own signature verification, `constructEvent`, is pure
 * HMAC-SHA256 + timestamp/replay-window checking — no network call at all). Setting
 * `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` to fake-but-well-formed values is therefore sufficient to
 * exercise the *real* `StripePaymentGatewayAdapter.verifyAndParseWebhook` (not a test double) end to end
 * through the real Route Handler, without ever making an HTTPS request to Stripe's servers — that would
 * only be needed for `ensureCustomer`/`createCheckoutSession` (real API calls), which this file does
 * not exercise (see the sibling file for those, proven against a fake `PaymentGatewayPort` instead).
 *
 * **A real, previously-latent bug found while writing this dispatch's own env-override test setup**
 * (not a pre-existing, out-of-scope defect — found and fixed in this same pass): a plain
 * `process.env.STRIPE_SECRET_KEY = '...'` statement placed textually before this file's own `import`
 * lines does NOT reliably run before those imports' own top-level side effects, because ES module
 * `import` declarations are hoisted and fully evaluated before ANY of the importing module's own
 * top-level statements — regardless of their textual position in the file. `server/logging/index.ts`
 * constructs its `logger` singleton eagerly at module scope (`export const logger = getLogger();`),
 * and `server/infrastructure/database/index.ts` imports `server/logging` at its own top level — so
 * merely importing `getPlatformDataSource` anywhere in this file transitively forces `getEnv()`'s
 * first-ever call (caching an empty `STRIPE_SECRET_KEY`) before any of this file's own top-level code
 * ever runs. **Fixed** by explicitly resetting the cached `globalThis.__examlandEnv` singleton inside
 * `beforeAll`, immediately after setting the two `process.env` overrides and before any other call in
 * this file — this is robust regardless of which module's import graph happens to trigger `getEnv()`'s
 * first call, unlike relying on textual/import-hoisting ordering.
 *
 * Run via:
 *   DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
 *     JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars> \
 *     npx vitest run src/server/phase2c-billing-webhook.integration.test.ts
 */
describe('Phase 2 (2c) — POST /api/platform/billing/webhook real route (real MySQL, real signature verification, no live Stripe)', () => {
  const runId = randomUUID().slice(0, 8);
  const webhookSecret = `whsec_test_fake_${runId}`;
  const createdTenantIds: string[] = [];
  const createdTenantSchemas: string[] = [];
  const createdPackageIds: string[] = [];
  let adminToken: string;
  let platformAdminId: string;

  beforeAll(async () => {
    // See this file's own header comment for why a plain top-of-file `process.env.X = ...` assignment
    // is NOT sufficient on its own — resetting the cached singleton here is what actually guarantees
    // `getEnv()`'s *next* call re-reads `process.env` fresh, regardless of whether some transitively-
    // imported module's own eager side effect already forced an earlier (stale) call.
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_p2c';
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    globalThis.__examlandEnv = undefined;

    const env = getEnv();
    // Sanity check: confirms the reset above actually took effect for this run, rather than silently
    // testing against an accidentally-unconfigured deployment.
    expect(env.STRIPE_SECRET_KEY).toBe('sk_test_fake_p2c');
    expect(env.STRIPE_WEBHOOK_SECRET).toBe(webhookSecret);

    const platformDs = await getPlatformDataSource();
    const admins = new PlatformAdminRepository(platformDs);
    const hasher = new BcryptPasswordHasherAdapter(4);
    const passwordHash = await hasher.hash('Real-Admin-Pass-1');
    const inserted = await admins.insert({
      id: randomUUID(),
      email: `p2c-webhook-${runId}-admin@integration-test.local`,
      passwordHash,
      name: 'Phase2c Webhook Test Admin',
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

  function jsonRequest(url: string, method: string, body: unknown, token?: string): NextRequest {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    return new NextRequest(url, { method, headers, body: JSON.stringify(body) });
  }

  /** Builds a genuinely-signed webhook `NextRequest` — `Stripe.webhooks.generateTestHeaderString`
   * produces a real signature for `webhookSecret`, entirely locally, no network call. */
  function signedWebhookRequest(eventId: string, type: string, dataObject: unknown): NextRequest {
    const payload = JSON.stringify({ id: eventId, type, data: { object: dataObject } });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    return new NextRequest('http://localhost/api/platform/billing/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      body: payload,
    });
  }

  async function provisionTenant(slug: string) {
    const res = await tenantsCreatePOST(
      jsonRequest(
        'http://localhost/api/platform/tenants',
        'POST',
        { name: 'Phase2c Webhook Tenant', subdomainSlug: slug, adminEmail: `admin@${slug}.local` },
        adminToken,
      ),
    );
    const tenant = await res.json();
    createdTenantIds.push(tenant.id);
    createdTenantSchemas.push(tenant.schemaName);
    return tenant;
  }

  async function createPackage(key: string) {
    const res = await packagesCreatePOST(
      jsonRequest('http://localhost/api/platform/packages', 'POST', { key, name: `Package ${key}`, priceCents: 2900 }, adminToken),
    );
    const pkg = await res.json();
    createdPackageIds.push(pkg.id);
    return pkg;
  }

  it('rejects a request with a bad signature with 401 WEBHOOK_SIGNATURE_INVALID, never leaking the underlying reason', async () => {
    const payload = JSON.stringify({ id: 'evt_bad', type: 'checkout.session.completed', data: { object: {} } });
    const res = await webhookPOST(
      new NextRequest('http://localhost/api/platform/billing/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': 'not-a-real-signature' },
        body: payload,
      }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(body.error.message).not.toMatch(/timestamp|hmac|secret/i);
  });

  it('rejects a request with a missing stripe-signature header', async () => {
    const res = await webhookPOST(
      new NextRequest('http://localhost/api/platform/billing/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
  });

  it(
    'processes a genuinely, correctly signed checkout.session.completed event end-to-end: activates the real tenant subscription, ' +
      'applies the target package from metadata, and persists both provider ids — all atomically to real MySQL',
    async () => {
      const tenant = await provisionTenant(`p2c-wh-${runId}-t1`);
      const pkg = await createPackage(`p2c-wh-${runId}-pkg1`);

      const req = signedWebhookRequest('evt_p2c_1', 'checkout.session.completed', {
        customer: 'cus_p2c_1',
        subscription: 'sub_p2c_1',
        metadata: { tenantId: tenant.id, packageId: pkg.id },
      });
      const res = await webhookPOST(req);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true });

      const platformDs = await getPlatformDataSource();
      const rows = await platformDs.query(
        'SELECT status, package_id, provider_customer_id, provider_subscription_id FROM tenant_subscription WHERE tenant_id = ?',
        [tenant.id],
      );
      const row = rows[0];
      expect(row.status).toBe('ACTIVE');
      expect(row.package_id).toBe(pkg.id);
      expect(row.provider_customer_id).toBe('cus_p2c_1');
      expect(row.provider_subscription_id).toBe('sub_p2c_1');
    },
    30_000,
  );

  it('processes customer.subscription.updated, mapping provider status to the internal three-state vocabulary and persisting the billing period', async () => {
    const tenant = await provisionTenant(`p2c-wh-${runId}-t2`);
    // First, a real checkout.session.completed to give this tenant a real provider_subscription_id to match against.
    await webhookPOST(
      signedWebhookRequest('evt_p2c_2a', 'checkout.session.completed', {
        customer: 'cus_p2c_2',
        subscription: 'sub_p2c_2',
        metadata: { tenantId: tenant.id },
      }),
    );

    const periodStart = 1_700_000_000;
    const periodEnd = 1_702_592_000;
    const res = await webhookPOST(
      signedWebhookRequest('evt_p2c_2b', 'customer.subscription.updated', {
        id: 'sub_p2c_2',
        status: 'past_due',
        current_period_start: periodStart,
        current_period_end: periodEnd,
      }),
    );
    expect(res.status).toBe(200);

    const platformDs = await getPlatformDataSource();
    const rows = await platformDs.query('SELECT status, current_period_start, current_period_end FROM tenant_subscription WHERE tenant_id = ?', [
      tenant.id,
    ]);
    const row = rows[0];
    expect(row.status).toBe('PAST_DUE');
    expect(new Date(row.current_period_start).getTime()).toBe(periodStart * 1000);
    expect(new Date(row.current_period_end).getTime()).toBe(periodEnd * 1000);
  }, 30_000);

  it('processes customer.subscription.deleted, marking the subscription CANCELED unconditionally', async () => {
    const tenant = await provisionTenant(`p2c-wh-${runId}-t3`);
    await webhookPOST(
      signedWebhookRequest('evt_p2c_3a', 'checkout.session.completed', {
        customer: 'cus_p2c_3',
        subscription: 'sub_p2c_3',
        metadata: { tenantId: tenant.id },
      }),
    );

    const res = await webhookPOST(signedWebhookRequest('evt_p2c_3b', 'customer.subscription.deleted', { id: 'sub_p2c_3' }));
    expect(res.status).toBe(200);

    const platformDs = await getPlatformDataSource();
    const rows = await platformDs.query('SELECT status FROM tenant_subscription WHERE tenant_id = ?', [tenant.id]);
    expect(rows[0].status).toBe('CANCELED');
  }, 30_000);

  it('returns 200 (never an error) for a recognized-but-unmatched event, e.g. an unknown provider subscription id', async () => {
    const res = await webhookPOST(signedWebhookRequest('evt_p2c_4', 'customer.subscription.updated', { id: 'sub_does_not_exist', status: 'active' }));
    expect(res.status).toBe(200);
  });

  it('returns 200 (never an error) for a genuinely unknown/unhandled event type', async () => {
    const res = await webhookPOST(signedWebhookRequest('evt_p2c_5', 'invoice.paid', {}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });
});
