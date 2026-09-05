/**
 * Standalone real-browser Playwright proof for Phase 9 sub-slice "9b" (self-serve tenant billing,
 * FR-PKG-6) — run standalone rather than appended to the full cumulative
 * `scripts/playwright-smoke-tenant.ts` run, matching sub-slice "9a"'s own documented precedent
 * (`playwright-smoke-branding.ts`'s header comment) for the same reason: only THIS dispatch's own new
 * flow needs proving here; the full cumulative re-run (now covering 9a+9b) is 9c's job once the
 * dashboard also lands, per this plan's own closing note.
 *
 * Proves, against a real running `next start` server and real MySQL:
 *   1. A Tenant Admin (holds `billing.manage`) logs in for real, navigates to `/settings/billing` via
 *      the real nav link (`billing.read`) — the real `GET /api/tenant/billing/plans` round trip shows
 *      the tenant's real, CreateSubscriptionStep-provisioned current plan + ACTIVE status + the active
 *      package catalog as a real card grid.
 *   2. Clicking a non-current plan's action button attempts a real Checkout Session creation
 *      (`POST /api/tenant/billing/checkout-session`) and surfaces the real `BILLING_NOT_CONFIGURED`
 *      banner for this genuinely-unconfigured deployment (no live Stripe key available in this
 *      environment — same precedent Phase 2 sub-slice "2c"'s own smoke script established for the
 *      Platform-Admin-initiated path). The load-bearing "redirect URL points to this tenant's own
 *      origin" guarantee is proven separately, at the integration-test level
 *      (`phase9b-tenant-billing-routes.integration.test.ts`), since no live Stripe key means the
 *      browser itself can never observe a real redirect happen.
 *   3. A user holding `billing.read` but NOT `billing.manage` (created for real via the actual
 *      `POST /api/roles`/`POST /api/users` routes, then logged in for real) sees the identical
 *      current-plan panel and catalog, but every action button is disabled with the documented helper
 *      text — proving the read/write permission split is enforced in the real rendered UI, not just at
 *      the route layer (already proven by the integration test above).
 *   4. `?checkout=success` and `?checkout=cancel` landing states render the documented banners.
 *   5. Zero console errors across the whole run.
 *
 * Requires a real, already-running `next start` server (`NODE_ENV=test`,
 * `DEFAULT_TENANT_SUBDOMAIN=demo-phase9`) against real MySQL, with the `demo-phase9` tenant already
 * provisioned (reused unchanged from sub-slice "9a" — same shared dev MySQL instance, same
 * already-established "kept, not torn down" precedent) via:
 *   DEMO_TENANT_NAME="Demo Phase 9" DEMO_TENANT_SUBDOMAIN=demo-phase9 \
 *     DEMO_TENANT_ADMIN_EMAIL=admin@demo-phase9.local DEMO_TENANT_ADMIN_PASSWORD=Phase9-Demo-Pass-1 \
 *     npx tsx scripts/provision-phase3-demo-tenant.ts
 *
 * Run via:
 *   APP_BASE_URL=http://localhost:3191 SMOKE_TENANT_ADMIN_EMAIL=admin@demo-phase9.local \
 *     SMOKE_TENANT_ADMIN_PASSWORD=Phase9-Demo-Pass-1 npx tsx scripts/playwright-smoke-billing.ts
 */
import { chromium, type ConsoleMessage, type Page } from 'playwright';

const BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3191';
const ADMIN_EMAIL = process.env.SMOKE_TENANT_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.SMOKE_TENANT_ADMIN_PASSWORD ?? '';

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('SMOKE_TENANT_ADMIN_EMAIL/SMOKE_TENANT_ADMIN_PASSWORD must be set to a real, known-password Tenant Admin.');
  process.exit(1);
}

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource: the server responded with a status of')) {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

/** Logs in through the real `POST /api/auth/login` route (not the browser — used only to obtain a
 * bearer token for the read-only test user's real-API setup calls below, which have no UI to drive
 * yet since this app has no Roles/Users management screen built). */
async function apiLogin(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`API login failed for ${email}: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { accessToken: string };
  return body.accessToken;
}

/** Creates (or reuses, if already present from a prior run) a `billing.read`-only, non-`billing.manage`
 * user via the real `POST /api/roles`/`POST /api/users` routes — §17.0's forward-defensive "future
 * role" scenario, exercised here through real HTTP against the real running server (not a DB insert). */
async function ensureReadOnlyBillingUser(adminToken: string): Promise<{ email: string; password: string }> {
  const email = 'billing-viewer@demo-phase9.local';
  const password = 'Phase9b-Viewer-Pass-1';

  const permissionsRes = await fetch(`${BASE_URL}/api/permissions`, { headers: { authorization: `Bearer ${adminToken}` } });
  const permissions = (await permissionsRes.json()) as { id: number; name: string }[];
  const billingReadId = permissions.find((p) => p.name === 'billing.read')?.id;
  if (!billingReadId) throw new Error('billing.read permission not found via GET /api/permissions.');

  const rolesRes = await fetch(`${BASE_URL}/api/roles`, { headers: { authorization: `Bearer ${adminToken}` } });
  const roles = (await rolesRes.json()) as { id: number; name: string }[];
  let role = roles.find((r) => r.name === 'Billing Viewer (Smoke)');
  if (!role) {
    const createRoleRes = await fetch(`${BASE_URL}/api/roles`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Billing Viewer (Smoke)', description: 'Read-only billing access (Playwright smoke fixture).', permissionIds: [billingReadId] }),
    });
    if (!createRoleRes.ok) throw new Error(`Failed to create Billing Viewer role: ${createRoleRes.status} ${await createRoleRes.text()}`);
    role = (await createRoleRes.json()) as { id: number; name: string };
  }

  const usersRes = await fetch(`${BASE_URL}/api/users?search=${encodeURIComponent(email)}`, { headers: { authorization: `Bearer ${adminToken}` } });
  const usersBody = (await usersRes.json()) as { items: { id: string; email: string }[] };
  if (!usersBody.items.some((u) => u.email === email)) {
    const createUserRes = await fetch(`${BASE_URL}/api/users`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email, firstName: 'Billing', lastName: 'Viewer', password, roleIds: [role.id] }),
    });
    if (!createUserRes.ok) throw new Error(`Failed to create Billing Viewer user: ${createUserRes.status} ${await createUserRes.text()}`);
  }

  return { email, password };
}

async function main() {
  const browser = await chromium.launch();
  const results: string[] = [];

  try {
    // Setup: real API calls (no UI exists yet for this) to create the read-only test user.
    const adminApiToken = await apiLogin(ADMIN_EMAIL, ADMIN_PASSWORD);
    const readOnlyUser = await ensureReadOnlyBillingUser(adminApiToken);
    results.push('SETUP: real billing.read-only (no billing.manage) test user ensured via real POST /api/roles + POST /api/users');

    // ── Part 1: Tenant Admin (billing.manage) real-browser flow ──────────────────────────────────
    {
      const page = await browser.newPage();
      const consoleErrors = trackConsoleErrors(page);

      await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
      await page.getByLabel('Email').fill(ADMIN_EMAIL);
      await page.getByLabel('Password').fill(ADMIN_PASSWORD);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForURL('**/curricula', { timeout: 15_000, waitUntil: 'commit' });
      results.push('PASS: Tenant Admin real login succeeded');

      await page.getByRole('link', { name: 'Billing', exact: true }).click();
      await page.waitForURL('**/settings/billing', { waitUntil: 'commit' });
      await page.waitForSelector('[data-testid="billing-form"]', { timeout: 10_000 });
      results.push('PASS: /settings/billing renders via the real nav link (billing.read)');

      await page.waitForSelector('[data-testid="current-plan-panel"]');
      const statusBadgeText = await page.getByTestId('subscription-status-badge').innerText();
      assert(/active/i.test(statusBadgeText), `current-plan panel shows the real ACTIVE status badge (got '${statusBadgeText}')`);
      results.push(`PASS: current-plan panel shows the real, CreateSubscriptionStep-provisioned subscription status ('${statusBadgeText.trim()}')`);

      const currentChipCount = await page.getByTestId('current-plan-chip').count();
      assert(currentChipCount === 1, `exactly one card is marked "Current plan" (found ${currentChipCount})`);
      results.push('PASS: exactly one catalog card is marked as the current plan (chip + disabled action button)');

      // Click a non-current plan's action button — a real POST /api/tenant/billing/checkout-session,
      // which this genuinely-unconfigured deployment answers with 503 BILLING_NOT_CONFIGURED.
      const actionButtons = page.locator('[data-testid^="plan-action-"]');
      const buttonCount = await actionButtons.count();
      assert(buttonCount > 0, 'at least one plan action button rendered');
      let clicked = false;
      for (let i = 0; i < buttonCount; i++) {
        const btn = actionButtons.nth(i);
        if (await btn.isEnabled()) {
          await btn.click();
          clicked = true;
          break;
        }
      }
      assert(clicked, 'found at least one enabled (non-current-plan) action button to click');
      await page.getByTestId('action-error').waitFor({ state: 'visible', timeout: 10_000 });
      const actionErrorText = await page.getByTestId('action-error').innerText();
      assert(/billing.*isn.?t set up/i.test(actionErrorText), `real BILLING_NOT_CONFIGURED banner surfaced verbatim (got '${actionErrorText}')`);
      results.push(`PASS: clicking a real plan's action button surfaces the real, server-returned BILLING_NOT_CONFIGURED banner: '${actionErrorText}'`);

      // ?checkout=success / ?checkout=cancel landing states.
      await page.goto(`${BASE_URL}/settings/billing?checkout=cancel`, { waitUntil: 'networkidle' });
      await page.getByTestId('checkout-return-banner').waitFor({ state: 'visible', timeout: 10_000 });
      const cancelBannerText = await page.getByTestId('checkout-return-banner').innerText();
      assert(/no changes were made/i.test(cancelBannerText), `?checkout=cancel banner shown (got '${cancelBannerText}')`);
      results.push('PASS: ?checkout=cancel renders the documented "No changes were made to your plan." banner');
      const urlAfterCancel = page.url();
      assert(!urlAfterCancel.includes('checkout=cancel'), `?checkout=cancel query param stripped from the address bar after handling (got '${urlAfterCancel}')`);
      results.push('PASS: ?checkout=cancel query param stripped from the address bar (no re-trigger on refresh)');

      await page.goto(`${BASE_URL}/settings/billing?checkout=success`, { waitUntil: 'networkidle' });
      await page.getByTestId('checkout-return-banner').waitFor({ state: 'visible', timeout: 10_000 });
      const successBannerText = await page.getByTestId('checkout-return-banner').innerText();
      assert(
        /confirming your new plan|upgraded to|still confirming/i.test(successBannerText),
        `?checkout=success banner shows one of the documented confirming/success/neutral states (got '${successBannerText}')`,
      );
      results.push(`PASS: ?checkout=success renders the documented async-confirmation banner: '${successBannerText}'`);

      assert(consoleErrors.length === 0, `expected zero console errors on the Tenant Admin pass, got: ${JSON.stringify(consoleErrors)}`);
      results.push('PASS: zero console errors across the Tenant Admin pass');
      await page.close();
    }

    // ── Part 2: billing.read-only (no billing.manage) real-browser flow ──────────────────────────
    {
      const page = await browser.newPage();
      const consoleErrors = trackConsoleErrors(page);

      await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
      await page.getByLabel('Email').fill(readOnlyUser.email);
      await page.getByLabel('Password').fill(readOnlyUser.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForURL('**/curricula', { timeout: 15_000, waitUntil: 'commit' });
      results.push('PASS: billing.read-only user real login succeeded');

      await page.getByRole('link', { name: 'Billing', exact: true }).click();
      await page.waitForURL('**/settings/billing', { waitUntil: 'commit' });
      await page.waitForSelector('[data-testid="billing-form"]', { timeout: 10_000 });
      results.push('PASS: a billing.read-only user can still reach /settings/billing (view-only, §17.0)');

      const actionButtons = page.locator('[data-testid^="plan-action-"]');
      const buttonCount = await actionButtons.count();
      assert(buttonCount > 0, 'catalog cards rendered for the read-only user too (visible, not hidden)');
      for (let i = 0; i < buttonCount; i++) {
        const enabled = await actionButtons.nth(i).isEnabled();
        assert(!enabled, `every action button is disabled for a billing.read-only user (button ${i} was enabled)`);
      }
      results.push(`PASS: all ${buttonCount} catalog action buttons are disabled for the billing.read-only user (view-only enforcement in the real rendered UI)`);

      const helperTexts = await page.getByText('Only a Tenant Admin can change your plan.').count();
      assert(helperTexts > 0, 'the documented read-only helper text is rendered at least once');
      results.push('PASS: the documented "Only a Tenant Admin can change your plan." helper text is rendered');

      assert(consoleErrors.length === 0, `expected zero console errors on the read-only pass, got: ${JSON.stringify(consoleErrors)}`);
      results.push('PASS: zero console errors across the billing.read-only pass');
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log(results.map((r) => `  ${r}`).join('\n'));
  console.log('\nAll self-serve tenant billing (Phase 9 sub-slice 9b) Playwright smoke assertions passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
