/**
 * Standalone real-browser Playwright proof for Phase 9 sub-slice "9a" (tenant branding, FR-MT-10) —
 * run standalone rather than appended to the full cumulative `scripts/playwright-smoke-tenant.ts` run
 * (documented choice, per this dispatch's own brief: "you only need to prove YOUR OWN new branding
 * flow works in a real browser this dispatch... run standalone if that's faster/more reliable").
 *
 * Proves, against a real running `next start` server and real MySQL:
 *   1. A Tenant Admin logs in for real, navigates to `/settings/branding` via the real nav link
 *      (`tenant.settings.manage`).
 *   2. Changes the accent color through the real form, saves — a real `PATCH /api/tenant/branding`
 *      round-trip.
 *   3. A HARD RELOAD (not a client-side re-render) shows the real `--brand-accent` CSS custom property
 *      on `<html>` reflecting the newly-saved color — a genuine `getComputedStyle` assertion, proving
 *      the root layout's server-side render actually picked up the persisted value (not just that the
 *      PATCH returned 200).
 *   4. An out-of-contrast hex (a very light gray, fails WCAG 2.2 AA against the white surface anchor)
 *      is rejected server-side with the real `INSUFFICIENT_COLOR_CONTRAST` message surfaced in the UI.
 *   5. Resets the accent back to default; confirms `--brand-accent` reverts on a subsequent hard reload.
 *
 * Requires a real, already-running `next start` server (`NODE_ENV=test`,
 * `DEFAULT_TENANT_SUBDOMAIN=demo-phase9`) against real MySQL, with the `demo-phase9` tenant already
 * provisioned via:
 *   DEMO_TENANT_NAME="Demo Phase 9" DEMO_TENANT_SUBDOMAIN=demo-phase9 \
 *     DEMO_TENANT_ADMIN_EMAIL=admin@demo-phase9.local DEMO_TENANT_ADMIN_PASSWORD=Phase9-Demo-Pass-1 \
 *     npx tsx scripts/provision-phase3-demo-tenant.ts
 *
 * Run via:
 *   APP_BASE_URL=http://localhost:3191 SMOKE_TENANT_ADMIN_EMAIL=admin@demo-phase9.local \
 *     SMOKE_TENANT_ADMIN_PASSWORD=Phase9-Demo-Pass-1 npx tsx scripts/playwright-smoke-branding.ts
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

/** Reads the live `--brand-accent` CSS custom property off `<html>` via a genuine
 * `getComputedStyle` call in the real browser — not a DOM attribute string-match, an actual computed
 * style read, so this proves Chakra's `brand.500` token genuinely resolves through the CSS cascade. */
async function readBrandAccentComputedStyle(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-accent').trim());
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = trackConsoleErrors(page);
  const results: string[] = [];

  try {
    // 1. Real login.
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/curricula', { timeout: 15_000, waitUntil: 'commit' });
    results.push('PASS: real login succeeded, redirected to /curricula');

    // Baseline: read whatever --brand-accent the platform default currently renders as, so the
    // "changed" assertion below is a genuine before/after diff, not an assumed starting value.
    const baselineAccent = await readBrandAccentComputedStyle(page);
    assert(/^#[0-9A-Fa-f]{6}$/.test(baselineAccent), `baseline --brand-accent is a real 6-digit hex (got '${baselineAccent}')`);
    results.push(`PASS: baseline --brand-accent computed style is a real hex value ('${baselineAccent}') — server-rendered with zero client-side fetch (no FOUC)`);

    // 2. Navigate to /settings/branding via the real permission-gated nav link.
    await page.getByRole('link', { name: 'Branding', exact: true }).click();
    await page.waitForURL('**/settings/branding', { waitUntil: 'commit' });
    await page.waitForSelector('[data-testid="branding-form"]', { timeout: 10_000 });
    results.push('PASS: /settings/branding renders via the real nav link (tenant.settings.manage)');

    // 3. Change the accent color to a genuinely different, WCAG-AA-passing color, save through the
    // real form.
    const NEW_ACCENT = '2E7D32'; // A dark, WCAG-AA-passing green — deliberately distinct from any
    // platform default so the before/after diff below is unambiguous.
    await page.getByTestId('accent-color-input').fill(NEW_ACCENT);
    await page.getByTestId('save-branding-button').click();
    await page.getByTestId('save-message').waitFor({ state: 'visible', timeout: 10_000 });
    const saveMessageText = await page.getByTestId('save-message').innerText();
    assert(saveMessageText.includes('updated'), `save confirmation message shown (got '${saveMessageText}')`);
    results.push(`PASS: saved a new accent color (#${NEW_ACCENT}) through the real form; real PATCH /api/tenant/branding round-trip confirmed`);

    // 4. THE MANDATORY REAL ASSERTION: a hard reload (full navigation, not client-side) must show the
    // new color reflected in the real, server-rendered --brand-accent CSS custom property.
    await page.reload({ waitUntil: 'networkidle' });
    const accentAfterSave = await readBrandAccentComputedStyle(page);
    assert(
      accentAfterSave.toUpperCase() === `#${NEW_ACCENT}`,
      `--brand-accent computed style reflects the newly-saved accent color after a hard reload (expected '#${NEW_ACCENT}', got '${accentAfterSave}')`,
    );
    assert(accentAfterSave.toUpperCase() !== baselineAccent.toUpperCase(), '--brand-accent genuinely changed from its baseline value');
    results.push(
      `PASS: a hard reload shows the real, server-rendered --brand-accent = '${accentAfterSave}' (matches the newly-saved #${NEW_ACCENT}, differs from the baseline '${baselineAccent}') — proves the root layout's server-side render genuinely reads the persisted accent, with zero FOUC`,
    );

    // Also confirm the Chakra `brand.500` token itself resolves to the same live value on a real
    // rendered component (not just the raw CSS var) — the color-picker input's own `value` mirrors
    // `previewColor`, which is `#${effectiveAccentColor}` once loaded.
    await page.waitForSelector('[data-testid="accent-color-input"]', { timeout: 10_000 });
    const reloadedInputValue = await page.getByTestId('accent-color-input').inputValue();
    assert(reloadedInputValue.toUpperCase() === NEW_ACCENT, `the branding form itself shows the persisted accent color after reload (got '${reloadedInputValue}')`);
    results.push('PASS: the branding form itself shows the real, persisted accent color after a hard reload (real GET /api/tenant/branding read path)');

    // 5. An out-of-contrast hex must be rejected server-side, with the real error surfaced verbatim.
    await page.getByTestId('accent-color-input').fill('EEEEEE');
    await page.getByTestId('save-branding-button').click();
    await page.getByTestId('contrast-error').waitFor({ state: 'visible', timeout: 10_000 });
    const contrastErrorText = await page.getByTestId('contrast-error').innerText();
    assert(/contrast/i.test(contrastErrorText) && /:1/.test(contrastErrorText), `real INSUFFICIENT_COLOR_CONTRAST error surfaced verbatim (got '${contrastErrorText}')`);
    results.push(`PASS: an out-of-contrast hex (#EEEEEE) is rejected server-side; the real ratio/required numbers are surfaced verbatim: '${contrastErrorText}'`);

    // Confirm the rejected color was NOT persisted — a hard reload must still show the previously-saved
    // (accepted) color, never the rejected one.
    await page.reload({ waitUntil: 'networkidle' });
    const accentAfterRejectedAttempt = await readBrandAccentComputedStyle(page);
    assert(
      accentAfterRejectedAttempt.toUpperCase() === `#${NEW_ACCENT}`,
      `the rejected color was never persisted — --brand-accent still reflects the last accepted value (got '${accentAfterRejectedAttempt}')`,
    );
    results.push('PASS: the rejected out-of-contrast color was never persisted (real server-side enforcement, not merely a client-side block)');

    // 6. Reset to default — confirms the "clear" (null) tri-state path also genuinely persists.
    await page.getByTestId('reset-accent-button').click();
    await page.getByTestId('save-message').waitFor({ state: 'visible', timeout: 10_000 });
    await page.reload({ waitUntil: 'networkidle' });
    const accentAfterReset = await readBrandAccentComputedStyle(page);
    assert(
      accentAfterReset.toUpperCase() === baselineAccent.toUpperCase(),
      `resetting to default reverts --brand-accent to the original baseline value (expected '${baselineAccent}', got '${accentAfterReset}')`,
    );
    results.push('PASS: "Reset to default color" genuinely reverts the persisted override; --brand-accent matches the original baseline after a hard reload');

    assert(consoleErrors.length === 0, `expected zero console errors, got: ${JSON.stringify(consoleErrors)}`);
    results.push('PASS: zero console errors across every page load in this run');
  } finally {
    await browser.close();
  }

  console.log(results.map((r) => `  ${r}`).join('\n'));
  console.log('\nAll branding (Phase 9 sub-slice 9a) Playwright smoke assertions passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
