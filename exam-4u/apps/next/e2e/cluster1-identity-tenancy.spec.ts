import { test, expect } from '@playwright/test';
import {
  DEMO_TENANTS,
  DEMO_TENANT_ADMIN_PASSWORD,
  hostFor,
  platformAuthHeaders,
  platformLogin,
  tenantAuthHeaders,
  tenantLogin,
} from './fixtures';

/**
 * Cluster 1 — Identity/tenancy (migration plan Phase 10 "Final e2e validation", cluster 1): auth (both
 * realms), RBAC default-deny, provisioning, tenant-resolution (`Host`-header correctness), and
 * multi-tenant isolation. Run against the real `docker-compose.next.yml` stack (see
 * `docs/plans/nextjs-rewrite-phase10-plan.md`'s "Sub-slice 10b1" section for how it's brought up).
 */

test.describe('Cluster 1 — Identity/tenancy', () => {
  test('tenant-realm login succeeds for a real seeded Tenant Admin and returns a genuine JWT', async ({ request }) => {
    const { accessToken, user } = await tenantLogin(request, DEMO_TENANTS.starter.subdomain, DEMO_TENANTS.starter.adminEmail, DEMO_TENANT_ADMIN_PASSWORD);
    expect(accessToken.split('.')).toHaveLength(3); // a real JWT, not a placeholder string
    expect(user.id).toBeTruthy();
  });

  test('tenant-realm login rejects a wrong password with 401 INVALID_CREDENTIALS', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      headers: { Host: hostFor(DEMO_TENANTS.starter.subdomain) },
      data: { email: DEMO_TENANTS.starter.adminEmail, password: 'definitely-wrong' },
    });
    expect(res.status()).toBe(401);
    expect((await res.json()).error.code).toBe('INVALID_CREDENTIALS');
  });

  test('platform-realm login succeeds for the seeded Platform Admin with a distinct realm JWT', async ({ request }) => {
    const { accessToken } = await platformLogin(request);
    expect(accessToken.split('.')).toHaveLength(3);
  });

  test('GET /api/auth/me with no Authorization header is rejected with 401 (fail-closed, no unauthenticated-by-omission route)', async ({ request }) => {
    const res = await request.get('/api/auth/me', { headers: { Host: hostFor(DEMO_TENANTS.starter.subdomain) } });
    expect(res.status()).toBe(401);
  });

  test('tenant-resolution: an unknown/nonexistent subdomain is rejected with 404 TENANT_NOT_FOUND, never silently defaulted', async ({ request }) => {
    const res = await request.get('/api/tenant/public-config', { headers: { Host: hostFor('this-subdomain-does-not-exist-e2e') } });
    expect(res.status()).toBe(404);
    expect((await res.json()).error.code).toBe('TENANT_NOT_FOUND');
  });

  test('tenant-resolution: a reserved subdomain (e.g. "admin") is rejected, never resolved to a real tenant', async ({ request }) => {
    const res = await request.get('/api/tenant/public-config', { headers: { Host: hostFor('admin') } });
    expect(res.status()).toBe(404);
  });

  test('tenant-resolution: a real browser navigating to the bare apex host is redirected to /start (the tenant-picker), which then routes to the chosen tenant\'s own /login with email prefilled', async ({ page }) => {
    // A real end-to-end browser navigation (not the `request` fixture) — `middleware.ts`'s friendly
    // redirect is keyed on the `sec-fetch-dest: document` header, which only a genuine top-level page
    // load sends, distinguishing it from every other test in this cluster's own API-level `request`
    // calls. Added directly in response to a real user-reported gap: browsing the bare host previously
    // surfaced a raw TENANT_NOT_FOUND JSON envelope instead of any usable page.
    await page.goto('/');
    await page.waitForURL('**/start');

    await page.getByPlaceholder('your-company', { exact: true }).fill(DEMO_TENANTS.starter.subdomain);
    await page.getByPlaceholder('you@your-company.com').fill(DEMO_TENANTS.starter.adminEmail);
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.waitForURL('**/login**');
    expect(new URL(page.url()).hostname).toBe(`${DEMO_TENANTS.starter.subdomain}.localhost`);
    await expect(page.locator('input[type=email]')).toHaveValue(DEMO_TENANTS.starter.adminEmail);
  });

  test('tenant-resolution: the real Host header correctly resolves the demo-starter vs demo-pro tenant to structurally different schemas', async ({ request }) => {
    const starter = await (await request.get('/api/tenant/public-config', { headers: { Host: hostFor(DEMO_TENANTS.starter.subdomain) } })).json();
    const pro = await (await request.get('/api/tenant/public-config', { headers: { Host: hostFor(DEMO_TENANTS.pro.subdomain) } })).json();
    expect(starter.name).toBe('Demo Starter Academy');
    expect(pro.name).toBe('Demo Pro Academy');
    expect(starter.name).not.toBe(pro.name);
  });

  test('RBAC default-deny: a fresh Member-role user lacks taxonomy.create and is rejected with 403, but keeps taxonomy.read', async ({ request }) => {
    const suffix = Date.now().toString(36);
    const { accessToken: adminToken } = await tenantLogin(request, DEMO_TENANTS.starter.subdomain, DEMO_TENANTS.starter.adminEmail, DEMO_TENANT_ADMIN_PASSWORD);
    const adminHeaders = tenantAuthHeaders(DEMO_TENANTS.starter.subdomain, adminToken);

    // Look up the real seeded 'Member' system role id (SeedRbacStep — every tenant schema gets one).
    const roles = await (await request.get('/api/roles', { headers: adminHeaders })).json();
    const memberRole = (roles as Array<{ id: number; name: string }>).find((r) => r.name === 'Member');
    expect(memberRole, 'seeded Member system role must exist in every tenant schema').toBeTruthy();

    const memberEmail = `e2e-member-${suffix}@demo-starter.local`;
    const memberPassword = 'MemberPass123!';
    const createRes = await request.post('/api/users', {
      headers: adminHeaders,
      data: { email: memberEmail, firstName: 'E2E', lastName: 'Member', password: memberPassword, roleIds: [memberRole!.id] },
    });
    expect(createRes.status()).toBe(201);

    const { accessToken: memberToken } = await tenantLogin(request, DEMO_TENANTS.starter.subdomain, memberEmail, memberPassword);
    const memberHeaders = tenantAuthHeaders(DEMO_TENANTS.starter.subdomain, memberToken);

    // Member HAS taxonomy.read (per SeedRbacStep's MEMBER_PERMISSIONS) — a real 200 elsewhere in the
    // catalog proves this isn't a blanket-deny fluke.
    const readRes = await request.get('/api/taxonomy/education-levels', { headers: memberHeaders });
    expect(readRes.status()).toBe(200);

    // Member does NOT have taxonomy.create/users.create — fail-closed default-deny (RBAC, not a
    // missing route) for both.
    const denyCreateTaxonomy = await request.post('/api/taxonomy/education-levels', {
      headers: memberHeaders,
      data: { name: `Should Be Denied ${suffix}` },
    });
    expect(denyCreateTaxonomy.status()).toBe(403);
    expect((await denyCreateTaxonomy.json()).error.code).toBe('FORBIDDEN');

    const denyCreateUser = await request.post('/api/users', {
      headers: memberHeaders,
      data: { email: `e2e-should-fail-${suffix}@demo-starter.local`, firstName: 'X', lastName: 'Y', password: 'Whatever123!' },
    });
    expect(denyCreateUser.status()).toBe(403);
  });

  test('Provisioning: Platform Admin provisions a brand-new tenant live through the real workflow (POST /api/platform/tenants)', async ({ request }) => {
    const suffix = Date.now().toString(36);
    const { accessToken } = await platformLogin(request);
    const headers = platformAuthHeaders(accessToken);
    const subdomainSlug = `e2e-live-${suffix}`;

    const res = await request.post('/api/platform/tenants', {
      headers,
      data: { name: `E2E Live Tenant ${suffix}`, subdomainSlug, adminEmail: `admin@${subdomainSlug}.local` },
    });
    expect(res.status()).toBe(201);
    const tenant = await res.json();
    expect(tenant.status).toBe('Active'); // real schema creation + RBAC seed + subscription creation all completed synchronously
    expect(tenant.schemaName).toMatch(/^t_/);

    // The new tenant is genuinely resolvable via its own Host header immediately (no propagation
    // delay/cache staleness) — proves the provisioning workflow's write is visible to the very next
    // request, not just to the platform-realm read that created it.
    const publicConfig = await request.get('/api/tenant/public-config', { headers: { Host: hostFor(subdomainSlug) } });
    expect(publicConfig.status()).toBe(200);
    expect((await publicConfig.json()).name).toBe(`E2E Live Tenant ${suffix}`);
  });

  test('Tenant isolation: a user created in demo-starter does not exist/authenticate in demo-pro, even with the identical email+password', async ({ request }) => {
    const suffix = Date.now().toString(36);
    const { accessToken: starterAdminToken } = await tenantLogin(request, DEMO_TENANTS.starter.subdomain, DEMO_TENANTS.starter.adminEmail, DEMO_TENANT_ADMIN_PASSWORD);
    const starterHeaders = tenantAuthHeaders(DEMO_TENANTS.starter.subdomain, starterAdminToken);

    const isolatedEmail = `isolation-check-${suffix}@demo-starter.local`;
    const isolatedPassword = 'IsolationCheck123!';
    const createRes = await request.post('/api/users', {
      headers: starterHeaders,
      data: { email: isolatedEmail, firstName: 'Iso', lastName: 'Check', password: isolatedPassword },
    });
    expect(createRes.status()).toBe(201);

    // Same email/password, but resolved against the DIFFERENT tenant's schema via its own Host header
    // — must be rejected (the row physically doesn't exist in that schema; this is a real
    // schema-per-tenant proof, not a shared-table permission check).
    const crossTenantLogin = await request.post('/api/auth/login', {
      headers: { Host: hostFor(DEMO_TENANTS.pro.subdomain) },
      data: { email: isolatedEmail, password: isolatedPassword },
    });
    expect(crossTenantLogin.status()).toBe(401);

    // Same-tenant login with the identical credentials succeeds — proves the 401 above is genuine
    // cross-tenant isolation, not a broken create/login path.
    const sameTenantLogin = await request.post('/api/auth/login', {
      headers: { Host: hostFor(DEMO_TENANTS.starter.subdomain) },
      data: { email: isolatedEmail, password: isolatedPassword },
    });
    expect(sameTenantLogin.status()).toBe(200);
  });

  test('Tenant isolation: taxonomy created in demo-pro is invisible from demo-enterprise (schema-per-tenant read isolation, not just write isolation)', async ({ request }) => {
    const suffix = Date.now().toString(36);
    const { accessToken: proToken } = await tenantLogin(request, DEMO_TENANTS.pro.subdomain, DEMO_TENANTS.pro.adminEmail, DEMO_TENANT_ADMIN_PASSWORD);
    const proHeaders = tenantAuthHeaders(DEMO_TENANTS.pro.subdomain, proToken);
    const uniqueLevelName = `Isolation-Probe-Level-${suffix}`;

    const createRes = await request.post('/api/taxonomy/education-levels', { headers: proHeaders, data: { name: uniqueLevelName } });
    expect(createRes.status()).toBe(201);

    const { accessToken: entToken } = await tenantLogin(
      request,
      DEMO_TENANTS.enterprise.subdomain,
      DEMO_TENANTS.enterprise.adminEmail,
      DEMO_TENANT_ADMIN_PASSWORD,
    );
    const entHeaders = tenantAuthHeaders(DEMO_TENANTS.enterprise.subdomain, entToken);
    const entLevels: Array<{ name: string }> = await (await request.get('/api/taxonomy/education-levels', { headers: entHeaders })).json();
    expect(entLevels.some((l) => l.name === uniqueLevelName)).toBe(false);

    // Confirm it DOES exist back on the owning tenant (real write, not a failed create silently
    // producing a false-negative isolation result).
    const proLevels: Array<{ name: string }> = await (await request.get('/api/taxonomy/education-levels', { headers: proHeaders })).json();
    expect(proLevels.some((l) => l.name === uniqueLevelName)).toBe(true);
  });
});
