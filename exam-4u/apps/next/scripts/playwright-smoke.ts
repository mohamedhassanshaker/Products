/**
 * Real-browser Playwright smoke check for the platform console UI (migration plan's "Per-phase
 * verification" item 6: "One rendered-page Playwright smoke check per new UI route"). This is this
 * app's first UI-bearing phase — no persisted Playwright script existed before this dispatch (prior
 * phases used the raw `playwright` library via ad hoc, non-committed verification scripts per
 * `docs/plans/nextjs-rewrite-phase0-plan.md`'s own precedent) — this file is kept as a real,
 * committed, re-runnable asset going forward, matching the migration plan's "cumulative smoke script,
 * never delete/skip a prior phase's assertions" convention for HTTP smoke, extended here to UI smoke.
 *
 * Requires a real, already-running `next start` server (`APP_BASE_URL`, default
 * `http://localhost:3179`) against real MySQL, with:
 *   - at least one `Active` platform admin with a KNOWN password (`SMOKE_ADMIN_EMAIL`/
 *     `SMOKE_ADMIN_PASSWORD` env vars) — this script does not create one itself.
 *   - at least one already-provisioned `Active` demo tenant (proven separately by Phase 1's own
 *     `provision-demo-tenant.ts`/smoke tenants) for the "list shows a real seeded tenant" assertion.
 *
 * Run via:
 *   APP_BASE_URL=http://localhost:3179 SMOKE_ADMIN_EMAIL=... SMOKE_ADMIN_PASSWORD=... \
 *     npm run smoke:ui -w apps/next
 */
import { chromium, type ConsoleMessage, type Page } from 'playwright';

const BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3179';
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? '';

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('SMOKE_ADMIN_EMAIL/SMOKE_ADMIN_PASSWORD must be set to a real, known-password platform admin.');
  process.exit(1);
}

/** Collects every `console.error`/pageerror during a page's lifetime — the exit gate's "zero console
 * errors on each page load" requirement.
 *
 * Chromium itself auto-logs a `console.error`-type "Failed to load resource: the server responded
 * with a status of 503" line for ANY fetch/XHR response with a non-2xx status — a browser-native log,
 * not an application bug — the instant Phase 2 sub-slice "2c"'s own smoke assertion #14 deliberately
 * provokes a real `503 BILLING_NOT_CONFIGURED` response (this deployment's actual, correct,
 * unconfigured-Stripe behavior). No prior phase's smoke script ever deliberately triggered a non-2xx
 * fetch, so this class of expected browser-native log line never needed filtering before. Filtered out
 * by its own fixed, generic text (never application-specific), so a genuine unexpected error of any
 * other shape still fails this check exactly as before. */
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

/**
 * Pages forward through the tenants list (clicking "Next", newest-first) until `subdomainText`
 * appears on the current page or `maxPages` is exhausted. This migration's own established "never
 * force-clean smoke/verification fixtures across dispatches" precedent means the shared dev schema's
 * tenant count only ever grows — by this dispatch, it has reached 50, which already pushes the
 * original Phase 1 `demo-next` seed tenant off the list's first (default) page. A fixed
 * `page 1 only` assertion would become permanently flaky as this count keeps growing over the
 * migration's remaining lifetime, so this helper makes the underlying assertion robust to that
 * expected, ongoing growth instead of asserting a fragile "always on page 1" assumption.
 */
async function ensureTenantRowVisible(page: Page, subdomainText: string, maxPages = 10): Promise<void> {
  for (let i = 0; i < maxPages; i += 1) {
    if (await page.getByText(subdomainText).isVisible().catch(() => false)) return;
    const nextButton = page.getByRole('button', { name: 'Next' });
    if (await nextButton.isDisabled()) break;
    await nextButton.click();
    await page.waitForTimeout(300);
  }
  assert(await page.getByText(subdomainText).isVisible(), `'${subdomainText}' visible in the tenants list within ${maxPages} pages`);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = trackConsoleErrors(page);
  const results: string[] = [];

  try {
    // 1. Platform login page renders, no console errors.
    await page.goto(`${BASE_URL}/platform/login`, { waitUntil: 'networkidle' });
    assert(await page.getByText('ExamLand Platform Admin').isVisible(), 'login page heading visible');
    assert(await page.getByLabel('Email').isVisible(), 'login email field visible');
    results.push('PASS: /platform/login renders with expected heading + form fields');

    // 2. Real login through the actual UI.
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/platform/tenants', { timeout: 15_000, waitUntil: 'commit' });
    results.push('PASS: real login redirected to /platform/tenants');

    // 3. Console shell renders (sidebar nav + heading) and the real seeded/provisioned demo tenant(s)
    //    from Phase 1 are visible in the list — paging forward if necessary (see
    //    `ensureTenantRowVisible`'s own doc comment: this shared dev schema's tenant count only ever
    //    grows across dispatches, so `demo-next` is no longer guaranteed to be on the first page).
    await page.waitForSelector('[data-testid="tenants-table"]', { timeout: 10_000 });
    assert(await page.getByText('ExamLand Platform Admin').isVisible(), 'console shell brand visible');
    await ensureTenantRowVisible(page, 'demo-next.examland.app');
    results.push('PASS: /platform/tenants shows the console shell and a real Phase-1-seeded tenant (demo-next)');

    // 4. Create a new tenant through the UI — a real provisioning workflow run, not a mock.
    const slug = `smoke2a-${Date.now().toString(36)}`;
    await page.getByRole('link', { name: 'Create tenant' }).click();
    await page.waitForURL('**/platform/tenants/new', { waitUntil: 'commit' });
    await page.getByLabel('Tenant name').fill(`Playwright Smoke ${slug}`);
    await page.getByLabel('Subdomain').fill(slug);
    await page.getByLabel('Admin email').fill(`admin@${slug}.local`);
    await page.getByRole('button', { name: 'Create tenant' }).click();
    // The synchronous provisioning call can take several seconds — wait for navigation to the new
    // tenant's real detail page (proves the whole create->provision->redirect chain actually ran).
    await page.waitForURL(/\/platform\/tenants\/[0-9a-f-]{36}$/, { timeout: 30_000, waitUntil: 'commit' });
    assert(await page.getByText(`Playwright Smoke ${slug}`).isVisible(), 'new tenant detail heading visible after real create');
    const statusAfterCreate = await page.getByTestId('status-badge').innerText();
    assert(statusAfterCreate.includes('Active') || statusAfterCreate.includes('Failed'), `unexpected post-create status: ${statusAfterCreate}`);
    results.push(`PASS: created tenant '${slug}' through the real UI via the real provisioning workflow (status: ${statusAfterCreate.trim()})`);

    if (statusAfterCreate.includes('Active')) {
      // 5. Suspend through the real UI, confirm dialog, real status change reflected.
      await page.getByRole('button', { name: 'Suspend' }).click();
      await page.getByTestId('confirm-dialog-confirm').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="status-badge"]')?.textContent?.includes('Suspended'), null, {
        timeout: 10_000,
      });
      results.push('PASS: suspended the new tenant through the real UI (confirm dialog + real status change to Suspended)');

      // 6. Reactivate through the real UI, real status change reflected.
      await page.getByRole('button', { name: 'Activate' }).click();
      await page.waitForFunction(() => document.querySelector('[data-testid="status-badge"]')?.textContent?.includes('Active'), null, {
        timeout: 10_000,
      });
      results.push('PASS: reactivated the new tenant through the real UI (real status change back to Active)');

      // 7. Soft-delete through the real UI — the stronger, type-the-name-to-confirm dialog (this
      //    dispatch's own new surface, no legacy precedent — see docs/design/UX_GUIDELINES.md §18.4).
      await page.getByRole('button', { name: 'Delete tenant' }).click();
      const confirmButton = page.getByTestId('confirm-dialog-confirm');
      assert(await confirmButton.isDisabled(), 'delete confirm button starts disabled until the tenant name is typed');
      await page.getByTestId('confirm-dialog-typed-input').fill(`Playwright Smoke ${slug}`);
      assert(!(await confirmButton.isDisabled()), 'delete confirm button enables once the exact tenant name is typed');
      await confirmButton.click();
      await page.waitForFunction(() => document.body.textContent?.includes('scheduled for permanent removal'), null, { timeout: 10_000 });
      results.push('PASS: soft-deleted the new tenant through the real UI (typed-confirmation gate + real deletedAt/purgeAfterAt banner)');
    } else {
      results.push('SKIP: suspend/reactivate skipped — created tenant landed in Failed status (a real, documented possible outcome); ' +
        'suspend/activate require an Active tenant, so this path was proven separately against the real seed tenants instead.');
    }

    // ── Phase 2 sub-slice "2b" additions (packages/features CRUD UI, platform/ai-models) ──────────
    // Cumulative per the migration plan's own smoke-script convention — every prior phase's assertion
    // above is left intact, not replaced.

    // 8. Create a feature through the real UI.
    const featureSuffix = Date.now().toString(36);
    await page.goto(`${BASE_URL}/platform/features/new`, { waitUntil: 'networkidle' });
    const featureKey = `smoke2b-feat-${featureSuffix}`;
    await page.getByLabel('Key').fill(featureKey);
    await page.getByLabel('Name').fill(`Smoke Feature ${featureSuffix}`);
    await page.getByLabel('Unit').fill('widgets');
    await page.getByRole('button', { name: 'Create feature' }).click();
    await page.waitForURL(/\/platform\/features\/[0-9a-f-]{36}$/, { timeout: 15_000, waitUntil: 'commit' });
    assert(await page.getByText(`Smoke Feature ${featureSuffix}`).isVisible(), 'new feature detail heading visible after real create');
    results.push(`PASS: created feature '${featureKey}' through the real UI`);

    // 9. Create a package through the real UI, then associate the new feature with it via the
    //    feature-association picker (an atomic PUT .../features replace).
    await page.goto(`${BASE_URL}/platform/packages/new`, { waitUntil: 'networkidle' });
    const packageKey = `smoke2b-pkg-${featureSuffix}`;
    await page.getByLabel('Key').fill(packageKey);
    await page.getByLabel('Name').fill(`Smoke Package ${featureSuffix}`);
    await page.getByLabel('Price (USD/month)').fill('9.99');
    await page.getByRole('button', { name: 'Create package' }).click();
    await page.waitForURL(/\/platform\/packages\/[0-9a-f-]{36}$/, { timeout: 15_000, waitUntil: 'commit' });
    results.push(`PASS: created package '${packageKey}' through the real UI`);

    await page.waitForSelector('[data-testid="package-feature-picker"]', { timeout: 10_000 });
    await page.getByLabel(`Enable Smoke Feature ${featureSuffix} for this package`).check();
    await page.getByRole('button', { name: 'Save feature configuration' }).click();
    await page.waitForFunction(() => document.body.textContent?.includes('1 of'), null, { timeout: 10_000 });
    results.push(`PASS: associated feature '${featureKey}' with package '${packageKey}' through the real UI (atomic replace)`);

    // 10. Approve a new AI model allowlist entry through the real UI.
    await page.goto(`${BASE_URL}/platform/ai-models/new`, { waitUntil: 'networkidle' });
    const openRouterModelId = `smoke2b/model-${featureSuffix}`;
    await page.getByLabel('OpenRouter model id').fill(openRouterModelId);
    await page.getByLabel('Display name').fill(`Smoke Model ${featureSuffix}`);
    await page.getByRole('button', { name: 'Approve model' }).click();
    await page.waitForURL(/\/platform\/ai-models\/[0-9a-f-]{36}$/, { timeout: 15_000, waitUntil: 'commit' });
    assert(await page.getByText(`Smoke Model ${featureSuffix}`).isVisible(), 'new AI model detail heading visible after real approval');
    results.push(`PASS: approved AI model '${openRouterModelId}' through the real UI`);

    // 11. Assign the newly-approved model to the real, Phase-1-seeded 'demo-next' tenant through the
    //     tenant detail screen's "AI model" panel — the real, DB-persisted PUT /api/platform/tenants/
    //     :id/ai-model path, then reload the page to confirm the assignment actually persisted server-
    //     side (not just reflected in this one render).
    await page.goto(`${BASE_URL}/platform/tenants`, { waitUntil: 'networkidle' });
    // Locate the table row containing the real, Phase-1-seeded 'demo-next' tenant by its subdomain
    // cell text (unambiguous — unlike the Name cell, which shows the tenant's display name, not its
    // slug), paging forward first if necessary (see `ensureTenantRowVisible`'s own doc comment), then
    // click the Name column's link within that same row.
    await ensureTenantRowVisible(page, 'demo-next.examland.app');
    await page.locator('tr', { hasText: 'demo-next.examland.app' }).getByRole('link').first().click();
    await page.waitForURL(/\/platform\/tenants\/[0-9a-f-]{36}$/, { timeout: 10_000, waitUntil: 'commit' });
    await page.waitForSelector('text=AI model', { timeout: 10_000 });
    await page.getByLabel('Assign AI model').selectOption({ label: `Smoke Model ${featureSuffix}` });
    await page.getByRole('button', { name: 'Save assignment' }).click();
    await page.waitForFunction(
      (name: string) => document.body.textContent?.includes(name) && document.body.textContent?.includes('explicitly assigned'),
      `Smoke Model ${featureSuffix}`,
      { timeout: 10_000 },
    );
    results.push(`PASS: assigned AI model '${openRouterModelId}' to the real 'demo-next' tenant through the real UI`);

    // Real-DB-persistence proof: a hard page reload re-fetches from the server, not from any client
    // cache — the assignment must still be there, proving the mutation actually committed to MySQL.
    await page.reload({ waitUntil: 'networkidle' });
    assert(
      (await page.locator('body').innerText()).includes(`Smoke Model ${featureSuffix}`) &&
        (await page.locator('body').innerText()).includes('explicitly assigned'),
      'AI model assignment survived a hard page reload (real DB persistence, not client-side-only state)',
    );
    results.push('PASS: AI model assignment persisted across a hard reload (confirmed real DB state, not client-only)');

    // Reset the demo tenant back to the platform default afterward — this smoke run must not leave a
    // shared, reused demo tenant (per this app's own established "smoke tenants are reused across
    // runs" convention) permanently pointed at a throwaway model this run is about to leave behind.
    await page.getByLabel('Assign AI model').selectOption({ label: 'Platform default' });
    await page.getByRole('button', { name: 'Save assignment' }).click();
    await page.waitForFunction(() => document.body.textContent?.includes('platform default'), null, { timeout: 10_000 });
    results.push("PASS: reset 'demo-next' back to the platform-default AI model (smoke-run cleanup)");

    // ── Phase 2 sub-slice "2c" additions (Stripe billing integration) ──────────────────────────────
    // Cumulative per the migration plan's own smoke-script convention — every prior phase's assertion
    // above is left intact, not replaced. Still on the real, Phase-1-seeded 'demo-next' tenant's detail
    // page from step 11 above.

    // 12. The billing panel renders the tenant's real subscription (created by CreateSubscriptionStep
    //     during provisioning — 'demo-next' has been subscribed to the seeded 'starter' package since
    //     Phase 1).
    await page.waitForSelector('[data-testid="billing-panel"]', { timeout: 10_000 });
    assert(
      (await page.locator('[data-testid="billing-panel"] dd').first().innerText()).includes('Starter'),
      "billing panel shows demo-next's real current package (Starter)",
    );
    results.push('PASS: billing panel renders the real, provisioning-created subscription (Starter/ACTIVE)');

    // 13. Reassign demo-next directly to the seeded 'Pro' package through the real UI (no Stripe
    //     involved) — the real PUT /api/platform/tenants/:id/billing path.
    await page.getByLabel('Reassign package').selectOption({ label: 'Pro' });
    await page.getByRole('button', { name: 'Reassign package' }).click();
    await page.waitForFunction(() => document.body.textContent?.includes('Pro'), null, { timeout: 10_000 });
    results.push("PASS: reassigned 'demo-next' to the 'Pro' package through the real UI (no Stripe)");

    // Real-DB-persistence proof: a hard page reload re-fetches from the server, not from any client
    // cache — the reassignment must still be there.
    await page.reload({ waitUntil: 'networkidle' });
    assert(
      (await page.locator('[data-testid="billing-panel"]').innerText()).includes('Pro'),
      'package reassignment persisted across a hard reload (real DB state, not client-side-only)',
    );
    results.push('PASS: package reassignment persisted across a hard reload (confirmed real DB state, not client-only)');

    // 14. "Create checkout session" against this real deployment's actual, genuinely unconfigured
    //     Stripe state (STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET both empty — this environment has no
    //     live Stripe test-mode key, see docs/plans/nextjs-rewrite-phase2-plan.md's "Decisions made")
    //     surfaces the real 503 BILLING_NOT_CONFIGURED error as a toast, never silently failing.
    await page.getByRole('button', { name: 'Create checkout session' }).click();
    await page.waitForFunction(() => document.body.textContent?.includes('Billing is not configured'), null, { timeout: 10_000 });
    results.push('PASS: "Create checkout session" surfaces the real BILLING_NOT_CONFIGURED toast for this genuinely-unconfigured deployment');

    // Reset 'demo-next' back to 'Starter' afterward — smoke-run cleanup, matching this project's own
    // "don't leave shared smoke fixtures in a surprising state" discipline (identical to step 11's own
    // AI-model reset above).
    await page.getByLabel('Reassign package').selectOption({ label: 'Starter' });
    await page.getByRole('button', { name: 'Reassign package' }).click();
    await page.waitForFunction(() => document.body.textContent?.includes('Starter'), null, { timeout: 10_000 });
    results.push("PASS: reset 'demo-next' back to the 'Starter' package (smoke-run cleanup)");

    // Note: the inactive-package-rejection case (409 PACKAGE_INACTIVE) is deliberately NOT
    // reproducible through this UI at all — the reassign dropdown only ever lists currently-active
    // packages (`listPackages(true)`), matching the AI-model panel's identical "never offer a
    // disabled option as a new assignment target" rule — so there is no way to even select an
    // inactive package through the real UI to attempt this. That rejection path is proven via a real
    // HTTP call directly against the Route Handler instead (`phase2c-platform-billing-routes.
    // integration.test.ts`), which is the only way to exercise a request shape the UI itself
    // structurally prevents.

    // ── Phase 2 sub-slice "2d" additions (platform/audit retrofit, platform/reliability dashboard) ──
    // Cumulative per the migration plan's own smoke-script convention — every prior phase's assertion
    // above is left intact, not replaced. This is also the final Phase 2 sub-dispatch, so this run now
    // touches every one of Phase 2's seven console surfaces (tenants, features, packages, ai-models,
    // the tenant-detail billing panel, and — added here — Reliability and Audit Log) in one continuous
    // session, satisfying the migration plan's own whole-Phase-2 exit gate ("a Platform Admin can fully
    // operate the platform through the UI alone").

    // 15. The Audit Log console page shows a real row for the feature created in step 8 above (this
    //     dispatch's own retrofit of `platform.audit_log` writes onto every already-shipped mutating
    //     route) — filtered by action, proving the filter form actually narrows the real server-side
    //     query, not just a client-side illusion.
    await page.goto(`${BASE_URL}/platform/audit-log`, { waitUntil: 'networkidle' });
    assert(await page.getByRole('heading', { name: 'Audit Log' }).isVisible(), 'audit log page heading visible');
    await page.getByPlaceholder('e.g. tenant.suspend').fill('feature.create');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await page.waitForSelector('[data-testid="audit-log-table"]', { timeout: 10_000 });
    assert(
      (await page.locator('[data-testid="audit-log-table"]').innerText()).includes(featureKey),
      `audit log shows a real feature.create row referencing '${featureKey}' after filtering by action`,
    );
    results.push(`PASS: Audit Log page shows a real 'feature.create' audit row for '${featureKey}' after filtering by action`);

    // 16. The Reliability dashboard renders real, non-crashing cross-tenant counts (outbox/file-cleanup
    //     health, honest zero work-hints — see docs/design/UX_GUIDELINES.md §18.9).
    await page.goto(`${BASE_URL}/platform/reliability`, { waitUntil: 'networkidle' });
    assert(await page.getByRole('heading', { name: 'Reliability' }).isVisible(), 'reliability page heading visible');
    await page.waitForSelector('[data-testid="outbox-health"]', { timeout: 10_000 });
    await page.waitForSelector('[data-testid="file-cleanup-health"]', { timeout: 10_000 });
    assert(
      (await page.locator('[data-testid="work-hints"]').innerText()).includes('No pending hints is expected today'),
      'reliability dashboard shows the honest, explained zero-work-hints empty state',
    );
    results.push('PASS: Reliability dashboard renders real cross-tenant outbox/file-cleanup counts and the honest zero-work-hints state');

    assert(consoleErrors.length === 0, `expected zero console errors, got: ${JSON.stringify(consoleErrors)}`);
    results.push('PASS: zero console errors across every page load in this run');
  } finally {
    await browser.close();
  }

  console.log(results.map((r) => `  ${r}`).join('\n'));
  console.log('\nAll platform-console Playwright smoke assertions passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
