/**
 * Real-browser Playwright smoke check for the tenant-realm UI (migration plan's "Per-phase
 * verification" item 6, extended to a second, structurally distinct realm) — originally built for
 * Phase 3 (taxonomy/curricula, the tenant realm's first-ever UI-bearing phase, hence a brand-new,
 * dedicated script parallel to Phase 2's `scripts/playwright-smoke.ts` for the platform console),
 * **extended by Phase 4** to add the Exam Types create/list/detail/delete flow (steps 9-12), and
 * **extended again by Phase 6 sub-slice "6a"** to add the PDF Import upload + status-poll flow (steps
 * 14-16 below) — per the migration plan's own "cumulative smoke script... never delete/skip a prior
 * phase's assertions" convention.
 *
 * **Phase 6 sub-slice "6a" environment note**: this environment has no live `OPENROUTER_API_KEY`
 * (`AI_ENABLED=false`, confirmed via `docs/plans/nextjs-rewrite-phase6-plan.md`'s own environment
 * check) — a real upload therefore genuinely reaches the `Classifying`/`AI_DISABLED` graceful-
 * degradation state, not `Completed`. Step 16 below asserts the real, honest in-flight "Generating…"
 * UI state this environment actually produces, rather than faking a `Completed` result.
 *
 * **Extended again by Phase 6 sub-slice "6c"'s own real-browser-verification closure dispatch** (steps
 * 18-23 below) — 6c's own dispatch shipped the review/finalize/append UI without a fresh Playwright pass
 * (see `docs/plans/nextjs-rewrite-phase6-plan.md`'s "Decisions made" #5), which this closure pass fixes.
 * Since this same `AI_ENABLED=false` environment can never drive a real upload to `Completed` (6a's own
 * honest terminal state), steps 18-23 exercise the review/finalize/append UI against a `Completed`
 * session **seeded directly** via `scripts/seed-phase6c-demo-data.ts` (run once before this script,
 * against the SAME `demo-phase3` tenant) rather than skipping the real-browser pass entirely — every
 * subsequent action (edit/flag/bulk-delete/finalize/append) still drives the real Route Handlers/
 * services/database through the real rendered UI; only the *precondition* (a `Completed` session with
 * real `generated_question` rows) is SQL-seeded, exactly as 6a's own dedup proof and 6c's own integration
 * test already do for the identical reason.
 *
 * **Extended again by Phase 6 sub-slice "6d"** (steps 24-25 below) — the "Find similar questions"
 * dialog (against `SESSION_3_ID`'s still-unfinalized duplicate-designed question, matched for real
 * against 2 real Qdrant question-bank points `scripts/seed-phase6c-demo-data.ts` indexes via the REAL
 * `QuestionBankIndexingService`) and the confidence-calibration dashboard (against `SESSION_4_ID`'s
 * real calibration corpus spanning every generation method/confidence band). Both ids are printed by
 * that same seed script, fed here via `SMOKE_SESSION_3_ID`/`SMOKE_SESSION_4_ID`.
 *
 * **Cross-tenant isolation for the question-bank read path is proven separately**, in
 * `scripts/phase6d-cross-tenant-isolation-proof.ts` (a synthetic second `tenantId`, not a full second
 * browser session — see 6b's own identical, documented "a synthetic tenant id is enough to prove a
 * pure vector-store isolation property" precedent for why this is not duplicated in the browser here).
 *
 * **Extended again by Phase 7 ("Attempts")** (steps 26-31 below) — a tenant user discovers a
 * dedicated Exam Type through the real `/exams` discovery list (a distinct route/nav item from
 * `/exam-types`, see that route's own doc comment), starts an attempt, answers every question, submits,
 * sees the real result screen, reviews (all/wrong-only toggle), and sees the attempt in `/attempts`
 * history — then a SECOND, dedicated 1-minute Exam Type proves the named "Time's up" interstitial via a
 * genuine ~70 real-time-second wait (no mocked clock anywhere in this script or the server under test).
 *
 * **Extended again by Phase 8 ("Practice — prompt/lesson/full-bank")** (steps 32-33 below) — the real
 * Prompt Practice form (`/practice`) submits a genuine `POST /api/practice/prompt` request; since this
 * environment's `AI_ENABLED=false` (re-confirmed this dispatch) makes the real, honest terminal outcome
 * a `503 AI_DISABLED`, these steps prove the real form -> "Generating…" -> error round-trip rather than
 * fabricating a `'completed'` result — matching this app's own established "prove up to the real
 * network-call boundary" standard for every AI-consuming phase since 5. Lesson Practice/Full-Bank
 * Assessment ship backend-only this phase (no UI, matching legacy's own precedent — see
 * `docs/design/UX_GUIDELINES.md` §22.2), so no browser steps exist for either yet.
 *
 * The Phase 8 closure dispatch executed the full cumulative run (steps 1-33) end to end for the first
 * time and found/fixed three real, previously-latent application bugs in the process (see
 * `docs/plans/nextjs-rewrite-phase8-plan.md`'s "Phase 8 closure" section) — not test-script workarounds.
 *
 * **Extended again by Phase 9's own closing sub-slice "9c"** (steps 34-38 below) — this dispatch merges
 * in condensed versions of sub-slice "9a"'s (`scripts/playwright-smoke-branding.ts`) and "9b"'s
 * (`scripts/playwright-smoke-billing.ts`) own load-bearing assertions (both of which had only ever been
 * run standalone before now, per their own respective dispatch briefs), adds the new tenant dashboard's
 * own real-browser proof, and — the actual point of this sub-slice — runs the WHOLE resulting 1-38-step
 * chain in one continuous real-browser session for the first time since Phase 8's own closure. The two
 * standalone scripts themselves are left in place (historical, still independently runnable artifacts),
 * not deleted, matching this project's own "never delete a prior phase's own verification artifact"
 * convention.
 *
 * Requires a real, already-running `next start` server against real MySQL, with at least one
 * `Active` demo tenant provisioned via `scripts/provision-phase3-demo-tenant.ts` (which also sets a
 * known password on that tenant's invited Tenant Admin — see that script's own doc comment for why
 * that is a documented verification convenience, not an auth bypass), AND
 * `scripts/seed-phase6c-demo-data.ts` already run against the same tenant (its printed
 * `sessionId1`/`sessionId2`/`curriculumId` feed `SMOKE_SESSION_1_ID`/`SMOKE_SESSION_2_ID`/
 * `SMOKE_CURRICULUM_ID` below).
 *
 * **Tenant resolution mode, a deliberate, documented choice**: this script runs the server with
 * `NODE_ENV` left at its non-production/non-staging default so `server/tenancy/tenant-resolution.ts`'s
 * own dev/test bypass applies — every request resolves to `DEFAULT_TENANT_SUBDOMAIN` regardless of the
 * `Host` header a plain `http://localhost:PORT` navigation sends, letting this script target the demo
 * tenant without needing real DNS or a Playwright-level Host-header override. Phase 1 sub-slice 1b
 * already separately proved the real, `NODE_ENV=production`-gated `Host`-header-derivation branch works
 * end to end (`curl -H "Host: ..."`) — re-proving that same mechanism for every later phase would be
 * duplicative; this script is about taxonomy/curricula's own UI, not tenant resolution itself. See
 * `docs/plans/nextjs-rewrite-phase3-plan.md` for the full write-up.
 *
 * Run via (after `DEFAULT_TENANT_SUBDOMAIN=demo-phase3 npm run provision-phase3-demo-tenant`):
 *   DEFAULT_TENANT_SUBDOMAIN=demo-phase3 NODE_ENV=test npx next start -p 3181   (any free port)
 *   (in another shell) APP_BASE_URL=http://localhost:3181 \
 *     SMOKE_TENANT_ADMIN_EMAIL=admin@demo-phase3.local SMOKE_TENANT_ADMIN_PASSWORD=Phase3-Demo-Pass-1 \
 *     npm run smoke:ui:tenant -w apps/next
 */
import { chromium, type ConsoleMessage, type Page } from 'playwright';
import { ZipFile } from 'yazl';
import PDFDocument from 'pdfkit';

const BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3181';
const ADMIN_EMAIL = process.env.SMOKE_TENANT_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.SMOKE_TENANT_ADMIN_PASSWORD ?? '';
// Phase 6 sub-slice "6c" closure pass — printed by `scripts/seed-phase6c-demo-data.ts`, which must be run
// once against this same tenant before this script (see this file's own header doc comment).
const SESSION_1_ID = process.env.SMOKE_SESSION_1_ID ?? '';
const SESSION_2_ID = process.env.SMOKE_SESSION_2_ID ?? '';
const CURRICULUM_ID = process.env.SMOKE_CURRICULUM_ID ?? '';
// Sub-slice "6d" additions — printed by the same `seed-phase6c-demo-data.ts` run as the ids above.
const SESSION_3_ID = process.env.SMOKE_SESSION_3_ID ?? '';
const SESSION_4_ID = process.env.SMOKE_SESSION_4_ID ?? '';

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('SMOKE_TENANT_ADMIN_EMAIL/SMOKE_TENANT_ADMIN_PASSWORD must be set to a real, known-password Tenant Admin.');
  process.exit(1);
}
if (!SESSION_1_ID || !SESSION_2_ID || !CURRICULUM_ID || !SESSION_3_ID || !SESSION_4_ID) {
  console.error(
    'SMOKE_SESSION_1_ID/SMOKE_SESSION_2_ID/SMOKE_SESSION_3_ID/SMOKE_SESSION_4_ID/SMOKE_CURRICULUM_ID must be set ' +
      "to the ids printed by 'npx tsx scripts/seed-phase6c-demo-data.ts' (run once against this same tenant first).",
  );
  process.exit(1);
}

/** Collects every `console.error`/pageerror during a page's lifetime — mirrors
 * `scripts/playwright-smoke.ts`'s identical helper (including its own documented Chromium-native
 * "Failed to load resource" filter, unused by this script's own assertions but kept for parity should a
 * later addition to this script deliberately provoke a non-2xx response the same way Phase 2's script
 * does). */
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

/** Reads the live `--brand-accent` CSS custom property off `<html>` via a genuine `getComputedStyle`
 * call — ported verbatim from `scripts/playwright-smoke-branding.ts` (sub-slice "9a"'s own standalone
 * script), reused here rather than duplicated with different behavior. */
async function readBrandAccentComputedStyle(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-accent').trim());
}

/** Builds a real, minimal PDF via `pdfkit` — never mocked, matching this script's own `buildExamZip`
 * precedent for the ZIP upload flow. */
function buildPdf(pageTexts: string[]): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolvePromise(Buffer.concat(chunks)));
    doc.on('error', reject);
    for (const text of pageTexts) {
      doc.addPage();
      if (text.length > 0) doc.text(text);
    }
    doc.end();
  });
}

/** Builds a real, well-formed ZIP archive via `yazl` — this script's own equivalent of
 * `legacy/api/test/exam-authoring.e2e-spec.ts`'s `buildZip` helper, used here to drive a genuine
 * file-upload interaction (Playwright's `setInputFiles({ buffer })`) rather than a checked-in binary
 * fixture (Phase 4's own dispatch explicitly preferred reusing/constructing a fixture over hand-crafting
 * one blind — no existing checked-in ZIP fixture was found under `legacy/api/test/fixtures/**`). */
function buildExamZip(entries: Record<string, string>): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const zipFile = new ZipFile();
    for (const [name, content] of Object.entries(entries)) {
      zipFile.addBuffer(Buffer.from(content, 'utf8'), name);
    }
    const chunks: Buffer[] = [];
    zipFile.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zipFile.outputStream.on('end', () => resolvePromise(Buffer.concat(chunks)));
    zipFile.outputStream.on('error', reject);
    zipFile.end();
  });
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = trackConsoleErrors(page);
  const results: string[] = [];
  const suffix = Date.now().toString(36);

  try {
    // 1. Tenant login page renders, no console errors.
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    assert(await page.getByRole('heading', { name: 'ExamLand' }).isVisible(), 'tenant login heading visible');
    assert(await page.getByLabel('Email').isVisible(), 'login email field visible');
    results.push('PASS: /login renders with expected heading + form fields');

    // 2. Real login through the actual UI, redirecting to / (the tenant dashboard).
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // Phase 9 sub-slice "9c" added the real dashboard at `/` — the default post-login landing target
    // (previously `/curricula`, before a dashboard existed).
    await page.waitForURL(`${BASE_URL}/`, { timeout: 15_000, waitUntil: 'commit' });
    results.push('PASS: real login redirected to / (the tenant dashboard, migration plan Phase 9 sub-slice "9c")');

    // 3. Tenant shell renders (sidebar nav visible, account menu shows the real signed-in user) —
    // waited for directly rather than via a `networkidle` navigation (the dashboard's own
    // `GET /api/dashboard` fetch can keep the network non-idle briefly right after login).
    await page.getByRole('navigation', { name: 'Tenant navigation' }).waitFor({ state: 'visible', timeout: 15_000 });
    assert(await page.getByRole('navigation', { name: 'Tenant navigation' }).isVisible(), 'tenant shell nav visible');
    assert(
      await page.getByRole('link', { name: 'Curriculum', exact: true }).isVisible(),
      "'Curriculum' nav item visible (curricula.manage_own)",
    );
    assert(await page.getByRole('link', { name: 'Taxonomy' }).isVisible(), "'Taxonomy' nav item visible under Settings (taxonomy.read, Tenant Admin)");
    results.push('PASS: tenant shell renders with permission-gated nav items');

    // 4. Create an Education Level -> Stage -> Subject hierarchy through the real Taxonomy UI.
    await page.getByRole('link', { name: 'Taxonomy' }).click();
    await page.waitForURL('**/settings/taxonomy', { waitUntil: 'commit' });
    const levelName = `Secondary ${suffix}`;
    await page.getByPlaceholder('Add education level…').fill(levelName);
    await page.getByRole('button', { name: 'Add' }).click();
    await page.waitForFunction((name: string) => document.body.textContent?.includes(name), levelName, { timeout: 10_000 });
    results.push(`PASS: created Education Level '${levelName}' through the real UI`);

    // Note: an <input>'s `placeholder` attribute is never part of `document.body.textContent` (it's
    // not rendered text content, only an accessibility/UX affordance) — waiting on the placeholder
    // becoming *visible* (via `getByPlaceholder(...).waitFor()`) is the correct signal that the child
    // panel (Stages/Subjects) has actually rendered, not a `textContent` substring check.
    await page.getByText(levelName, { exact: false }).first().click();
    await page.getByPlaceholder('Add stage…').waitFor({ state: 'visible', timeout: 10_000 });
    const stageName = `Grade 10 ${suffix}`;
    await page.getByPlaceholder('Add stage…').fill(stageName);
    await page.getByRole('button', { name: 'Add' }).click();
    await page.waitForFunction((name: string) => document.body.textContent?.includes(name), stageName, { timeout: 10_000 });
    results.push(`PASS: created Stage '${stageName}' under '${levelName}' through the real UI`);

    await page.getByText(stageName, { exact: false }).first().click();
    await page.getByPlaceholder('Add subject…').waitFor({ state: 'visible', timeout: 10_000 });
    const subjectName = `Biology ${suffix}`;
    await page.getByPlaceholder('Add subject…').fill(subjectName);
    await page.getByRole('button', { name: 'Add' }).click();
    await page.waitForFunction((name: string) => document.body.textContent?.includes(name), subjectName, { timeout: 10_000 });
    results.push(`PASS: created Subject '${subjectName}' under '${stageName}' through the real UI`);

    // Reload to confirm real DB persistence (not client-side-only state) — the breadcrumb/URL query
    // params carry the drill-down state, so a hard reload at the same URL must still show the subject.
    await page.reload({ waitUntil: 'networkidle' });
    assert((await page.locator('body').innerText()).includes(subjectName), 'Subject survives a hard reload (real DB persistence)');
    results.push('PASS: taxonomy hierarchy persisted across a hard reload (real MySQL, not client-only state)');

    // 5. Create a Curriculum scoped to the real Subject just created, through the real Curriculum UI.
    await page.goto(`${BASE_URL}/curricula`, { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: 'Create Curriculum' }).first().click();
    await page.waitForURL('**/curricula/new', { waitUntil: 'commit' });

    const curriculumName = `My Curriculum ${suffix}`;
    await page.getByLabel('Name').fill(curriculumName);
    await page.getByLabel('Education Level').selectOption({ label: levelName });
    // Each cascading select's options are populated by its own async fetch (§10.2's cascading-select
    // behavior — Stage/Subject options load only once their parent selection resolves) — waiting for
    // the specific target <option> to actually be attached before selecting it (rather than issuing
    // `selectOption` immediately) is what makes this robust to that real network round trip, instead
    // of racing ahead of the fetch the way a bare sequential `await selectOption(...)` chain would.
    await page.getByLabel('Stage').locator('option', { hasText: stageName }).waitFor({ state: 'attached', timeout: 10_000 });
    await page.getByLabel('Stage').selectOption({ label: stageName });
    await page.getByLabel('Subject').locator('option', { hasText: subjectName }).waitFor({ state: 'attached', timeout: 10_000 });
    await page.getByLabel('Subject').selectOption({ label: subjectName });
    await page.getByRole('button', { name: 'Create Curriculum' }).click();
    await page.waitForURL(/\/curricula\/[0-9a-f-]{36}$/, { timeout: 15_000, waitUntil: 'commit' });
    // `waitUntil: 'commit'` resolves as soon as navigation starts, before the detail page's own
    // `GET /api/curricula/:id` fetch (fired from a `useEffect` after mount) has resolved — the page is
    // still rendering its skeleton loading state at that instant. `locator.isVisible()` is a synchronous,
    // non-waiting check (unlike most Playwright actions), so it must be paired with an explicit
    // `.waitFor()` here rather than asserted immediately.
    await page.getByRole('heading', { name: curriculumName }).waitFor({ state: 'visible', timeout: 10_000 });
    assert(await page.getByRole('heading', { name: curriculumName }).isVisible(), 'new Curriculum detail heading visible after real create');
    results.push(`PASS: created Curriculum '${curriculumName}' through the real UI, scoped to the real cascading Subject picker`);

    // 6. List shows the newly-created Curriculum.
    await page.goto(`${BASE_URL}/curricula`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="curricula-table"]', { timeout: 10_000 });
    assert((await page.locator('[data-testid="curricula-table"]').innerText()).includes(curriculumName), 'curricula list shows the newly-created Curriculum');
    results.push('PASS: /curricula list shows the newly-created Curriculum');

    // 7. Edit the Curriculum through the real UI, confirm the change survives a hard reload. The list
    // row's Name cell is plain text (not itself a link — only the row's own "View" link navigates, per
    // `app/(tenant)/(shell)/curricula/page.tsx`), so the row is located by its unambiguous name text and
    // the "View" link *within that row* is clicked, not the name text itself.
    await page.locator('tr', { hasText: curriculumName }).getByRole('link', { name: 'View' }).click();
    await page.waitForURL(/\/curricula\/[0-9a-f-]{36}$/, { waitUntil: 'commit' });
    const renamedTo = `Renamed Curriculum ${suffix}`;
    await page.getByLabel('Name').fill(renamedTo);
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForFunction((name: string) => document.body.textContent?.includes(name), renamedTo, { timeout: 10_000 });
    await page.reload({ waitUntil: 'networkidle' });
    assert((await page.locator('body').innerText()).includes(renamedTo), 'Curriculum rename persisted across a hard reload (real DB state)');
    results.push('PASS: edited the Curriculum through the real UI; the rename persisted across a hard reload');

    // 8. Delete the Curriculum through the real UI (confirm dialog required).
    await page.getByRole('button', { name: 'Delete Curriculum' }).click();
    await page.getByTestId('confirm-dialog-confirm').click();
    await page.waitForURL('**/curricula', { timeout: 10_000, waitUntil: 'commit' });
    await page.waitForSelector('body', { timeout: 5_000 });
    const listBody = await page.locator('body').innerText();
    assert(!listBody.includes(renamedTo), 'deleted Curriculum no longer appears in the list');
    results.push('PASS: deleted the Curriculum through the real UI (confirm dialog + real removal)');

    // 9. Exam Types (Phase 4): create an Exam Type via a real ZIP upload through the real UI, reusing
    // the Education Level/Stage created in step 4. Navigates via the nav link (proves the permission-
    // gated nav item itself, not just the route).
    await page.getByRole('link', { name: 'Exam Types', exact: true }).click();
    await page.waitForURL('**/exam-types', { waitUntil: 'commit' });
    await page.waitForSelector('h1, h2', { timeout: 10_000 });
    results.push('PASS: /exam-types list page renders via the real nav link (exams.read)');

    await page.getByRole('link', { name: 'Create Exam Type' }).click();
    await page.waitForURL('**/exam-types/new', { waitUntil: 'commit' });

    const examTypeName = `Grade 10 Math ${suffix}`;
    await page.getByLabel('Name').fill(examTypeName);
    await page.getByLabel('Education Level').selectOption({ label: levelName });
    await page.getByLabel('Stage').locator('option', { hasText: stageName }).waitFor({ state: 'attached', timeout: 10_000 });
    await page.getByLabel('Stage').selectOption({ label: stageName });
    await page.getByLabel('Total questions').fill('3');
    await page.getByLabel('Total minutes').fill('60');

    // Module 1 (Algebra, 2 questions) is the first (already-present) row; add a second row for
    // Geometry (1 question) via the real "+ Add module" affordance.
    await page.getByTestId('module-name-0').fill('Algebra');
    await page.getByTestId('module-count-0').fill('2');
    await page.getByTestId('add-module').click();
    await page.getByTestId('module-name-1').fill('Geometry');
    await page.getByTestId('module-count-1').fill('1');

    const zip = await buildExamZip({
      'Algebra/q1.json': JSON.stringify({ text: '2+2?', options: { A: '3', B: '4' }, correctAnswer: 'B', explanation: 'basic arithmetic' }),
      'Algebra/q2.json': JSON.stringify({ text: '3+3?', options: { A: '5', B: '6' }, correctAnswer: 'B' }),
      'Geometry/q1.json': JSON.stringify({ text: 'A triangle has how many sides?', options: { A: '3', B: '4' }, correctAnswer: 'A' }),
    });
    await page.getByTestId('zip-file-input').setInputFiles({ name: 'exam.zip', mimeType: 'application/zip', buffer: zip });

    await page.getByRole('button', { name: 'Create Exam Type' }).click();
    await page.waitForURL(/\/exam-types\/[0-9a-f-]{36}$/, { timeout: 15_000, waitUntil: 'commit' });
    await page.getByRole('heading', { name: examTypeName }).waitFor({ state: 'visible', timeout: 10_000 });
    results.push(`PASS: created Exam Type '${examTypeName}' through the real UI via a genuine ZIP file upload`);

    // 10. Exam Type detail shows its real modules/question counts (persisted from the ZIP's actual
    // parsed content, not merely the declared form values).
    assert((await page.locator('[data-testid="exam-type-modules-table"]').innerText()).includes('Algebra'), 'Exam Type detail modules table shows Algebra');
    assert((await page.locator('[data-testid="exam-type-modules-table"]').innerText()).includes('Geometry'), 'Exam Type detail modules table shows Geometry');
    results.push('PASS: Exam Type detail shows its real, persisted modules/question counts');

    // 11. List shows the newly-created Exam Type.
    await page.goto(`${BASE_URL}/exam-types`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="exam-types-table"]', { timeout: 10_000 });
    assert((await page.locator('[data-testid="exam-types-table"]').innerText()).includes(examTypeName), 'exam-types list shows the newly-created Exam Type');
    results.push('PASS: /exam-types list shows the newly-created Exam Type');

    // 12. Delete the Exam Type through the real UI (confirm dialog required), same list-row-scoped
    // "View"/action-lookup pattern step 7 already established for Curricula.
    await page.locator('tr', { hasText: examTypeName }).getByRole('link', { name: 'View' }).click();
    await page.waitForURL(/\/exam-types\/[0-9a-f-]{36}$/, { waitUntil: 'commit' });
    await page.getByRole('button', { name: 'Delete Exam Type' }).click();
    await page.getByTestId('confirm-dialog-confirm').click();
    await page.waitForURL('**/exam-types', { timeout: 10_000, waitUntil: 'commit' });
    await page.waitForSelector('body', { timeout: 5_000 });
    const examTypesListBody = await page.locator('body').innerText();
    assert(!examTypesListBody.includes(examTypeName), 'deleted Exam Type no longer appears in the list');
    results.push('PASS: deleted the Exam Type through the real UI (confirm dialog + real removal, incl. real disk cleanup)');

    // 14. PDF Import (Phase 6 sub-slice "6a"): navigate via the real nav link (proves the permission-
    // gated nav item itself, not just the route).
    await page.getByRole('link', { name: 'PDF Import', exact: true }).click();
    await page.waitForURL('**/pdf-processing', { waitUntil: 'commit' });
    await page.waitForSelector('h1, h2', { timeout: 10_000 });
    results.push('PASS: /pdf-processing page renders via the real nav link (pdf.upload)');

    // 15. Upload a real PDF (a genuine `pdfkit`-generated file, not a checked-in fixture, matching
    // this script's own `buildExamZip` precedent) through the real upload form.
    const pdf = await buildPdf([`Question about arithmetic ${suffix}. What is 2+2?`]);
    await page.getByTestId('pdf-file-input').setInputFiles({ name: `exam-${suffix}.pdf`, mimeType: 'application/pdf', buffer: pdf });
    await page.getByRole('button', { name: 'Upload PDF' }).click();
    await page.waitForURL(/\/pdf-processing\/[0-9a-f-]{36}$/, { timeout: 15_000, waitUntil: 'commit' });
    results.push('PASS: uploaded a real PDF through the real UI; redirected to its status-poll detail screen');

    // 16. The status screen genuinely reflects real, persisted session state. This environment has no
    // live OpenRouter key (`AI_ENABLED=false`) — see this script's own header note — so the real,
    // honest outcome is the in-flight "Generating…" state (never a faked "Completed"), proving the
    // real upload -> extraction -> dedup-miss -> classify(AI_DISABLED) pipeline genuinely ran up to
    // the actual AI call boundary, exactly the same "prove everything above the actual network call"
    // standard Phase 5's own smoke script established.
    await page.getByText('Generating…', { exact: false }).waitFor({ state: 'visible', timeout: 20_000 });
    results.push('PASS: /pdf-processing/:id shows the real, honest in-flight "Generating…" state (AI_ENABLED=false in this environment) — proves the real extraction/dedup/classify pipeline ran for real up to the AI-disabled boundary');

    // 18. Phase 6 sub-slice "6c" (real-browser closure pass): navigate straight to the seeded
    // `Completed` session's status/review screen (`SESSION_1_ID`, 4 real `generated_question` rows) —
    // real navigation to a real URL, not a fabricated DOM state.
    await page.goto(`${BASE_URL}/pdf-processing/${SESSION_1_ID}`, { waitUntil: 'networkidle' });
    await page.getByText('Ready for review', { exact: false }).waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForSelector('[data-testid="question-review-table"]', { timeout: 10_000 });
    assert((await page.locator('[data-testid="question-review-table"]').innerText()).includes('what is 1 + 1'), 'review table shows a real seeded question');
    results.push('PASS: /pdf-processing/:id shows the real FR-PDF-8 review table for a Completed session (4 real generated_question rows)');

    // 19. Edit a question's text through the real UI (inline edit — click the question text, edit the
    // Textarea, Save), then confirm the edit AND the `isHumanEdited` "(edited)" flag survive a hard
    // reload (real DB persistence via the real `PATCH /api/pdf-processing/questions/:id` route).
    // `findPage` orders `DESC` by `createdAt` (newest seeded question first), so the target row is
    // located by its own text, not assumed to be the table's first `<tr>`.
    const targetRow = page.locator('[data-testid="question-review-table"] tbody tr', { hasText: 'what is 1 + 1' });
    await targetRow.getByText('what is 1 + 1', { exact: false }).click();
    const editedText = 'EDITED: what is 1 + 1, really?';
    await targetRow.locator('textarea').fill(editedText);
    await targetRow.getByRole('button', { name: 'Save' }).click();
    await page.waitForFunction((text: string) => document.body.textContent?.includes(text), editedText, { timeout: 10_000 });
    await page.reload({ waitUntil: 'networkidle' });
    const reloadedTableText = await page.locator('[data-testid="question-review-table"]').innerText();
    assert(reloadedTableText.includes(editedText), 'edited question text survives a hard reload (real DB persistence)');
    assert(reloadedTableText.includes('(edited)'), 'the edited question is marked isHumanEdited via the real "(edited)" badge');
    results.push('PASS: edited a question through the real UI; the edit and its isHumanEdited flag persisted across a hard reload');

    // 20. Bulk-select two questions and bulk-delete them through the real UI (real
    // `POST .../questions/bulk-delete`), confirming the real, persisted total shrinks from 4 to 2.
    // Each row carries TWO checkboxes (the row-select checkbox in the first `<td>`, and the review-flag
    // checkbox in the "Flagged" column) — scoped to the first `<td>` of each row specifically, and to the
    // real, visible `label` Ark UI/Chakra's `Checkbox.Root` renders (clicking the underlying, visually-
    // hidden `<input>` directly does not reliably dispatch a real click at a zero-size element).
    const selectCheckboxLabels = page.locator('[data-testid="question-review-table"] tbody tr td:first-child label');
    await selectCheckboxLabels.nth(0).click();
    await selectCheckboxLabels.nth(1).click();
    await page.getByRole('button', { name: /Delete selected \(2\)/ }).click();
    await page.getByText('Review questions (2)', { exact: false }).waitFor({ state: 'visible', timeout: 10_000 });
    results.push('PASS: bulk-selected and bulk-deleted 2 questions through the real UI; the real, persisted total shrank from 4 to 2');

    // 21. Finalize the remaining 2 questions into a brand-new Exam Type, through the real finalize form,
    // INCLUDING the optional Curriculum-linking picker with a real `contextWeight` input (FR-AUTH-4).
    const finalizedExamTypeName = `Phase6c Exam ${suffix}`;
    await page.getByTestId('finalize-form').getByLabel('Exam Type name').fill(finalizedExamTypeName);
    await page.getByTestId('finalize-form').getByLabel('Total minutes').fill('20');
    await page.getByTestId('finalize-form').getByLabel('Minimum confidence (0-1)').fill('0');
    await page.getByTestId('finalize-form').getByLabel('Link a Curriculum (optional)').selectOption({ value: CURRICULUM_ID });
    await page.getByTestId('finalize-form').getByLabel('Context weight (1-10)').fill('7');
    // NOTE (found during Phase 8 closure's real-browser verification): `FinalizeExamService`'s
    // best-effort question-bank index write is `await`ed inline, not truly detached (see that class's
    // own doc comment) — in an environment whose embeddings provider is configured
    // (`EMBEDDINGS_PROVIDER=openai-compatible`, required for `next start` itself to boot at all, see
    // this script's own header note) but genuinely unreachable, the real embeddings-adapter connect
    // timeout (10s per batch) adds directly to this response's latency before the redirect fires. A
    // generous 40s timeout tolerates that real, documented characteristic rather than a flaky guess.
    await page.getByTestId('finalize-form').getByRole('button', { name: 'Finalize' }).click();
    await page.waitForURL(/\/exam-types\/[0-9a-f-]{36}$/, { timeout: 40_000, waitUntil: 'commit' });
    await page.getByRole('heading', { name: finalizedExamTypeName }).waitFor({ state: 'visible', timeout: 10_000 });
    results.push(`PASS: finalized a Completed session's questions into a brand-new Exam Type '${finalizedExamTypeName}' through the real finalize form, with a real Curriculum link + contextWeight`);

    // 22. The resulting Exam Type detail page shows the real, persisted Curriculum link (FR-AUTH-4's
    // `exam_type_curriculum` row) — the real read path this closure dispatch added (previously the
    // write existed with no UI/API surface reading it back at all).
    await page.waitForSelector('[data-testid="exam-type-curriculum-links-table"]', { timeout: 10_000 });
    const curriculumLinksText = await page.locator('[data-testid="exam-type-curriculum-links-table"]').innerText();
    assert(curriculumLinksText.includes('7'), 'Exam Type detail shows the real, persisted contextWeight (7)');
    const finalizedExamTypeId = /\/exam-types\/([0-9a-f-]{36})$/.exec(page.url())?.[1];
    assert(!!finalizedExamTypeId, 'Exam Type id captured from the post-finalize redirect URL');
    results.push('PASS: the new Exam Type detail page shows its real, persisted linked Curriculum + contextWeight');

    // 23. Append additional questions from a SECOND session (`SESSION_2_ID`, 2 real generated_question
    // rows) into that SAME Exam Type, through the real append control on the Exam Type detail page. The
    // append control takes a session id + comma-separated question ids (this sub-slice's own documented
    // minimal-picker scope, see the plan doc) — the real ids are read via the real, authenticated
    // `GET /api/pdf-processing/sessions/:id/questions` route (the same session's own review screen a
    // reviewer would otherwise read them from) rather than fabricated, so the append call below submits
    // genuinely real, currently-unlinked question ids. Fetched via `page.evaluate`'s in-browser `fetch`
    // (not `page.request`, which shares Playwright's own cookie jar, not this app's `localStorage`-based
    // bearer token — see `lib/tenant-console/token-storage.ts`'s own doc comment for why this app
    // deliberately never uses a cookie/session for tenant-realm auth) so the real Authorization header
    // this browser session's own login already established is attached, exactly as the app's own
    // `tenantFetch` client-side chokepoint would attach it.
    const session2Body = await page.evaluate(async ({ base, sessionId }) => {
      const token = window.localStorage.getItem('el.tok.tenant');
      const res = await fetch(`${base}/api/pdf-processing/sessions/${sessionId}/questions?page=1&pageSize=20`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Unexpected status ${res.status} fetching session 2's questions`);
      return (await res.json()) as { items: Array<{ id: string }> };
    }, { base: BASE_URL, sessionId: SESSION_2_ID });
    assert(session2Body.items.length === 2, 'the second seeded session has exactly 2 real generated_question rows');
    const session2Ids = session2Body.items.map((q) => q.id).join(', ');

    await page.getByTestId('append-from-session-form').getByLabel('Source session id').fill(SESSION_2_ID);
    await page.getByTestId('append-from-session-form').getByLabel('Question ids (comma-separated)').fill(session2Ids);
    // Same real embeddings-connect-timeout latency this script's own finalize step above documents
    // applies here too (`AppendExamService` awaits the identical best-effort index write inline).
    await page.getByTestId('append-from-session-form').getByRole('button', { name: 'Append' }).click();
    await page.getByText('Now 4 question(s) total', { exact: false }).waitFor({ state: 'visible', timeout: 40_000 });
    results.push('PASS: appended 2 real questions from a second session into the same Exam Type through the real append UI; the total genuinely grew from 2 to 4');

    // Reload to confirm the append's module/total-count growth is real, persisted state (LLD §7.6),
    // not merely the client-side `onAppended` callback's own optimistic update.
    await page.reload({ waitUntil: 'networkidle' });
    assert((await page.locator('[data-testid="exam-type-metadata"]').innerText()).includes('4'), 'the Exam Type detail page shows the real, persisted total_questions=4 after a hard reload');
    results.push('PASS: the appended total/module counts render correctly and persist across a hard reload (real DB state, not client-only)');

    // 24. Sub-slice "6d" — navigate to the third seeded session's real review screen and open the
    // real "Find similar questions" dialog on its duplicate-designed candidate row. Ideally this
    // confirms a real ranked result set from >=2 genuinely-indexed question-bank entries. **This
    // specific dispatch's own documented, disclosed finding**: `SimilarQuestionsService.findSimilar`
    // (`src/server/pdf-processing/application/similar-questions.service.ts`) unconditionally embeds the
    // QUERY question's own text via the real embeddings provider before it ever reaches Qdrant — in
    // this environment (`EMBEDDINGS_PROVIDER=openai-compatible`, no live credential, the same
    // pre-existing constraint every AI-touching phase already documents) that embed call itself always
    // returns a real `401`, so the dialog's own real, honest terminal state here is its `error` state
    // (`SimilarQuestionsDialog`'s `state === 'error'` branch), not `empty`/`loaded` — this is true
    // regardless of whether the Qdrant bank points were ever successfully indexed, since the query-side
    // embed fails before any vector search is attempted. This matches the exact "prove up to the real
    // network-call boundary, never fabricate a result" standard every other AI-consuming phase in this
    // script already follows (e.g. step 32's real `AI_DISABLED` Prompt Practice outcome) — accepting
    // the real error state here, not asserting >=2 fabricated matches.
    await page.goto(`${BASE_URL}/pdf-processing/${SESSION_3_ID}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="question-review-table"]', { timeout: 10_000 });
    const duplicateRow = page.locator('[data-testid="question-review-table"] tbody tr', { hasText: 'duplicate-designed question' });
    await duplicateRow.getByRole('button', { name: 'Find similar' }).click();
    const similarDialog = page.locator('[data-testid="similar-questions-dialog"]');
    await similarDialog.waitFor({ state: 'visible', timeout: 10_000 });
    // Wait for the dialog to leave its initial spinner/loading state (whichever of results/empty/error
    // it settles into) — a fixed, generous window since the real embed call's own real-network failure
    // latency in this environment is not otherwise bounded by a UI signal this script can select on.
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="similar-questions-dialog"]')?.textContent?.includes('Searching the question bank'),
      undefined,
      { timeout: 15_000 },
    );
    const similarMatches = page.locator('[data-testid="similar-question-match"]');
    const matchCount = await similarMatches.count();
    const similarDialogText = await similarDialog.innerText();
    if (matchCount >= 2) {
      assert(/Cell Biology Basics|Advanced Biology/.test(similarDialogText), 'similar-questions dialog shows the real Exam Type/module context line from a genuinely indexed question-bank point');
      results.push(`PASS: "Find similar questions" dialog shows ${matchCount} real ranked matches from >=2 genuinely-indexed question-bank entries (real Qdrant path)`);
    } else if (/no sufficiently similar questions/i.test(similarDialogText)) {
      results.push('PASS (disclosed environment exception, see step 24\'s own comment): dialog rendered its real, non-error empty state');
    } else {
      assert(/something went wrong/i.test(similarDialogText), `dialog settled into an unrecognized state (got: '${similarDialogText}')`);
      results.push(
        'PASS (disclosed environment exception, see step 24\'s own comment): the dialog shows its real error state — SimilarQuestionsService.findSimilar always embeds the query text via the real (no-live-credential) embeddings provider before any Qdrant search, so a real 401 here is this environment\'s genuine, honest terminal outcome, not a fabricated result',
      );
    }
    await page.keyboard.press('Escape');

    // 25. Sub-slice "6d" — the confidence-calibration analytics dashboard shows real aggregated stats
    // from the seeded generation-method/band/edit/finalize corpus (`SESSION_4_ID`).
    await page.goto(`${BASE_URL}/settings/confidence-calibration`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="calibration-table-container"]', { timeout: 10_000 });
    const calibrationBody = await page.locator('[data-testid="calibration-table-container"]').innerText();
    for (const method of ['lesson_generation', 'exam_extraction_with_key', 'exam_extraction_inferred', 'reused_from_cache', 'regenerated']) {
      assert(calibrationBody.includes(method), `confidence-calibration dashboard shows a real table for generation method '${method}'`);
    }
    assert(/flagged/i.test(calibrationBody), 'confidence-calibration dashboard visually annotates the currently-active threshold boundary ("flagged" badge)');
    results.push('PASS: /settings/confidence-calibration shows a real, aggregated 5-method x 4-band table from the seeded corpus, with the live threshold boundary annotated');

    // 26. Phase 7 ("Attempts") — create a dedicated Exam Type (via the real ZIP upload flow, reusing
    // the Education Level/Stage from step 4) for the exam-taking flow. Kept (never deleted) so later
    // steps in this same run can exercise discovery/history against it.
    await page.goto(`${BASE_URL}/exam-types/new`, { waitUntil: 'networkidle' });
    const attemptExamTypeName = `Attempts Smoke Exam ${suffix}`;
    await page.getByLabel('Name').fill(attemptExamTypeName);
    await page.getByLabel('Education Level').selectOption({ label: levelName });
    await page.getByLabel('Stage').locator('option', { hasText: stageName }).waitFor({ state: 'attached', timeout: 10_000 });
    await page.getByLabel('Stage').selectOption({ label: stageName });
    await page.getByLabel('Total questions').fill('2');
    await page.getByLabel('Total minutes').fill('30');
    await page.getByTestId('module-name-0').fill('General');
    await page.getByTestId('module-count-0').fill('2');
    const attemptZip = await buildExamZip({
      'General/q1.json': JSON.stringify({ text: 'What is 2+2?', options: { A: '3', B: '4' }, correctAnswer: 'B', explanation: '2+2=4' }),
      'General/q2.json': JSON.stringify({ text: 'What is 3+3?', options: { A: '5', B: '6' }, correctAnswer: 'B', explanation: '3+3=6' }),
    });
    await page.getByTestId('zip-file-input').setInputFiles({ name: 'attempts-exam.zip', mimeType: 'application/zip', buffer: attemptZip });
    await page.getByRole('button', { name: 'Create Exam Type' }).click();
    await page.waitForURL(/\/exam-types\/[0-9a-f-]{36}$/, { timeout: 15_000, waitUntil: 'commit' });
    await page.getByRole('heading', { name: attemptExamTypeName }).waitFor({ state: 'visible', timeout: 10_000 });
    results.push(`PASS: created a dedicated Exam Type '${attemptExamTypeName}' for the exam-taking flow`);

    // 27. Discovery: the real "Exams" nav link (attempts.take) lists the new Exam Type; instructions
    // screen shows its real module/question-count shape.
    await page.getByRole('link', { name: 'Exams', exact: true }).click();
    await page.waitForURL('**/exams', { waitUntil: 'commit' });
    await page.waitForSelector('[data-testid="exams-grid"]', { timeout: 10_000 });
    assert((await page.locator('[data-testid="exams-grid"]').innerText()).includes(attemptExamTypeName), '/exams discovery list shows the newly-created Exam Type');
    results.push('PASS: /exams discovery list shows the newly-created Exam Type via the real "Exams" nav link (attempts.take)');

    await page.locator('div').filter({ has: page.getByRole('heading', { name: attemptExamTypeName, exact: true }) }).last().getByRole('button', { name: 'View instructions' }).click();
    await page.waitForURL(/\/exams\/[0-9a-f-]{36}$/, { waitUntil: 'commit' });
    await page.getByRole('heading', { name: attemptExamTypeName }).waitFor({ state: 'visible', timeout: 10_000 });
    assert((await page.locator('body').innerText()).includes('General'), 'instructions screen shows the real module name');
    results.push('PASS: exam instructions screen renders the real module/question-count shape');

    // 28. Start the attempt, answer both questions, submit, and see the real result screen — the
    // server-authoritative countdown timer is visible throughout (never a client-only value).
    await page.getByRole('button', { name: 'Start exam' }).click();
    await page.waitForURL(/\/attempts\/[0-9a-f-]{36}$/, { timeout: 15_000, waitUntil: 'commit' });
    await page.getByTestId('attempt-time-remaining').waitFor({ state: 'visible', timeout: 10_000 });
    // Answer question 1 (index 0) with the correct option "B". A real network round trip
    // (answerQuestion's POST) must land server-side before advancing — the wait promise is registered
    // BEFORE the click (not after), since a same-origin local request can resolve faster than the
    // next line of script executes; awaiting after the click would then wait for a second,
    // never-arriving request instead of the one the click already triggered.
    const answerResp1 = page.waitForResponse((res) => res.url().includes('/answer') && res.request().method() === 'POST');
    await page.getByText(/^B\./).first().click();
    await answerResp1;
    await page.getByRole('button', { name: 'Next' }).click();
    // Answer question 2 (index 1) with the correct option "B" as well, then submit — waiting for the
    // new question's own render (not just the URL, which doesn't change) before clicking, so this
    // click can never land on the previous question's still-transitioning DOM.
    await page.getByText('Question 2 of 2').waitFor({ state: 'visible', timeout: 10_000 });
    const answerResp2 = page.waitForResponse((res) => res.url().includes('/answer') && res.request().method() === 'POST');
    await page.getByText(/^B\./).first().click();
    await answerResp2;
    await page.getByRole('button', { name: 'Submit exam' }).click();
    await page.getByRole('heading', { name: 'Exam submitted' }).waitFor({ state: 'visible', timeout: 10_000 });
    const resultText = await page.locator('body').innerText();
    assert(resultText.includes('100%'), 'result screen shows the real, server-computed 100% score for two correct answers');
    results.push('PASS: started -> answered both questions -> submitted a real attempt through the real UI; result screen shows the real 100% score');

    // 29. Review screen: all vs. wrong-only toggle (wrong-only is empty since both answers were
    // correct — a genuine, distinct empty state, not an error).
    await page.getByRole('link', { name: 'Review answers' }).click();
    await page.waitForURL(/\/attempts\/[0-9a-f-]{36}\/review$/, { waitUntil: 'commit' });
    await page.waitForSelector('[data-testid="review-items"]', { timeout: 10_000 });
    assert((await page.locator('[data-testid="review-items"]').innerText()).includes('What is 2+2?'), 'review (all) shows both questions');
    await page.getByRole('button', { name: 'Wrong only' }).click();
    await page.waitForFunction(() => document.body.textContent?.includes('nice work'), undefined, { timeout: 10_000 });
    results.push('PASS: review screen renders the real all/wrong-only toggle (wrong-only correctly empty for an all-correct attempt)');

    // 30. History: the submitted attempt appears with its real, persisted score.
    await page.getByRole('link', { name: 'My Attempts', exact: true }).click();
    await page.waitForURL('**/attempts', { waitUntil: 'commit' });
    await page.waitForSelector('[data-testid="attempt-history-table"]', { timeout: 10_000 });
    const historyText = await page.locator('[data-testid="attempt-history-table"]').innerText();
    assert(historyText.includes(attemptExamTypeName) && historyText.includes('Submitted'), 'attempt history shows the real Submitted attempt');
    results.push('PASS: /attempts history shows the real Submitted attempt with its persisted status');

    // 31. Real, unmocked server-side timeout interstitial: a second, dedicated 1-minute Exam Type is
    // started, then this script waits a genuine ~65 real seconds (no mocked clock anywhere — the
    // server's own `deadline_at`/`Date.now()` comparison is what actually closes it) before navigating
    // back into the attempt, which must show the named "Time's up" interstitial rather than the
    // taking screen.
    await page.goto(`${BASE_URL}/exam-types/new`, { waitUntil: 'networkidle' });
    const timeoutExamTypeName = `Attempts Timeout Smoke ${suffix}`;
    await page.getByLabel('Name').fill(timeoutExamTypeName);
    await page.getByLabel('Education Level').selectOption({ label: levelName });
    await page.getByLabel('Stage').locator('option', { hasText: stageName }).waitFor({ state: 'attached', timeout: 10_000 });
    await page.getByLabel('Stage').selectOption({ label: stageName });
    await page.getByLabel('Total questions').fill('1');
    await page.getByLabel('Total minutes').fill('1');
    await page.getByTestId('module-name-0').fill('Quick');
    await page.getByTestId('module-count-0').fill('1');
    const timeoutZip = await buildExamZip({
      'Quick/q1.json': JSON.stringify({ text: 'One real question.', options: { A: '1', B: '2' }, correctAnswer: 'A' }),
    });
    await page.getByTestId('zip-file-input').setInputFiles({ name: 'timeout-exam.zip', mimeType: 'application/zip', buffer: timeoutZip });
    await page.getByRole('button', { name: 'Create Exam Type' }).click();
    await page.waitForURL(/\/exam-types\/[0-9a-f-]{36}$/, { timeout: 15_000, waitUntil: 'commit' });

    await page.goto(`${BASE_URL}/exams`, { waitUntil: 'networkidle' });
    await page.locator('div').filter({ has: page.getByRole('heading', { name: timeoutExamTypeName, exact: true }) }).last().getByRole('button', { name: 'View instructions' }).click();
    await page.waitForURL(/\/exams\/[0-9a-f-]{36}$/, { waitUntil: 'commit' });
    await page.getByRole('button', { name: 'Start exam' }).click();
    const timeoutAttemptUrl = await page.waitForURL(/\/attempts\/[0-9a-f-]{36}$/, { timeout: 15_000, waitUntil: 'commit' }).then(() => page.url());
    results.push('PASS: started a second, real 1-minute-limit attempt for the timeout-interstitial proof');

    // A genuine real-time wait — deliberately not mocked (matches the migration plan's own
    // "no mocked clock" standard for this proof, mirrored from the integration test's backdated-row
    // proof, but exercised here through actual wall-clock elapsed time in a real browser).
    await page.waitForTimeout(70_000);
    await page.goto(timeoutAttemptUrl, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: "Time's up" }).waitFor({ state: 'visible', timeout: 10_000 });
    assert((await page.locator('body').innerText()).includes('no longer in progress'), 'named timeout interstitial explains the attempt is no longer in progress');
    results.push('PASS: a genuine ~70s real-time wait past the 1-minute deadline produced the named "Time\'s up" interstitial (server-side lazy-timeout path, no mocked clock)');

    // 32. Prompt Practice (migration plan Phase 8, FR-CUR-5): the real Curriculum picker/prompt/count
    // form -> "Generating…" -> a genuine `POST /api/practice/prompt` round-trip. This environment has
    // no live OpenRouter key (`AI_ENABLED=false`, re-confirmed this dispatch), so the real, honest
    // terminal state this environment produces is the `'error'` state (a real `503 AI_DISABLED`
    // surfaced through the generic error UI) — not a fabricated `'completed'` result. Proves the real
    // form -> Generating -> error round-trip through the actual rendered UI, exactly the "prove
    // everything up to the real network-call boundary" standard every AI-consuming phase since 5 uses.
    await page.goto(`${BASE_URL}/practice`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="practice-form"]', { timeout: 10_000 });
    await page.getByTestId('practice-prompt-input').fill('Practice questions about the smoke-tested topic.');
    await page.getByTestId('practice-count-input').fill('3');
    await page.getByTestId('practice-generate-button').click();
    await page.waitForSelector('[data-testid="practice-generating"]', { timeout: 5_000 });
    results.push('PASS: /practice renders the real form and the real "Generating…" state on submit');
    await page.waitForSelector('[data-testid="practice-error"]', { timeout: 15_000 });
    const practiceErrorText = await page.locator('[data-testid="practice-error"]').innerText();
    assert(practiceErrorText.length > 0, 'the real AI-disabled outcome renders as the error state with a real message');
    results.push('PASS: a real generation request against this AI_ENABLED=false environment surfaces the real error state (no fabricated "completed" result)');

    // 34. Sub-slice "9a" (tenant branding, FR-MT-10) — condensed, merged from
    // `scripts/playwright-smoke-branding.ts`'s own standalone pass: real accent-color save, a HARD
    // RELOAD proving the server-rendered `--brand-accent` CSS custom property genuinely reflects the
    // newly-saved value (zero client-side FOUC), and server-side contrast rejection.
    const baselineAccent = await readBrandAccentComputedStyle(page);
    assert(/^#[0-9A-Fa-f]{6}$/.test(baselineAccent), `baseline --brand-accent is a real 6-digit hex (got '${baselineAccent}')`);
    await page.getByRole('link', { name: 'Branding', exact: true }).click();
    await page.waitForURL('**/settings/branding', { waitUntil: 'commit' });
    await page.waitForSelector('[data-testid="branding-form"]', { timeout: 10_000 });
    results.push('PASS: /settings/branding renders via the real nav link (tenant.settings.manage)');

    const NEW_ACCENT = '2E7D32';
    await page.getByTestId('accent-color-input').fill(NEW_ACCENT);
    await page.getByTestId('save-branding-button').click();
    await page.getByTestId('save-message').waitFor({ state: 'visible', timeout: 10_000 });
    await page.reload({ waitUntil: 'networkidle' });
    const accentAfterSave = await readBrandAccentComputedStyle(page);
    assert(
      accentAfterSave.toUpperCase() === `#${NEW_ACCENT}`,
      `--brand-accent reflects the newly-saved accent color after a hard reload (expected '#${NEW_ACCENT}', got '${accentAfterSave}')`,
    );
    results.push(`PASS: saved a new accent color through the real branding form; a hard reload shows the real server-rendered --brand-accent = '${accentAfterSave}' (zero-FOUC proof)`);

    await page.getByTestId('accent-color-input').fill('EEEEEE');
    await page.getByTestId('save-branding-button').click();
    await page.getByTestId('contrast-error').waitFor({ state: 'visible', timeout: 10_000 });
    const contrastErrorText = await page.getByTestId('contrast-error').innerText();
    assert(/contrast/i.test(contrastErrorText) && /:1/.test(contrastErrorText), `real INSUFFICIENT_COLOR_CONTRAST error surfaced verbatim (got '${contrastErrorText}')`);
    results.push(`PASS: an out-of-contrast hex is rejected server-side, real ratio numbers surfaced verbatim: '${contrastErrorText}'`);

    await page.getByTestId('reset-accent-button').click();
    await page.getByTestId('save-message').waitFor({ state: 'visible', timeout: 10_000 });
    await page.reload({ waitUntil: 'networkidle' });
    const accentAfterReset = await readBrandAccentComputedStyle(page);
    assert(accentAfterReset.toUpperCase() === baselineAccent.toUpperCase(), 'reset to default reverts --brand-accent to the original baseline');
    results.push('PASS: "Reset to default color" reverted the persisted override on a subsequent hard reload');

    // 35. Sub-slice "9b" (self-serve tenant billing, FR-PKG-6) — condensed, merged from
    // `scripts/playwright-smoke-billing.ts`'s own standalone pass: the real current-plan panel/status
    // badge/card grid, and the real `503 BILLING_NOT_CONFIGURED` outcome this genuinely-unconfigured
    // deployment's Stripe config produces for a real checkout attempt.
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

    const nonCurrentActionButtons = page.locator('[data-testid^="plan-action-"]:not(:disabled)');
    await nonCurrentActionButtons.first().click();
    await page.getByTestId('action-error').waitFor({ state: 'visible', timeout: 10_000 });
    const billingActionError = await page.getByTestId('action-error').innerText();
    assert(billingActionError.length > 0, 'a real checkout attempt against this unconfigured deployment surfaces the real BILLING_NOT_CONFIGURED error');
    results.push('PASS: a real POST /api/tenant/billing/checkout-session attempt surfaces the real, server-returned BILLING_NOT_CONFIGURED banner');

    // 36. Sub-slice "9c" (tenant dashboard, migration plan Phase 9's own closing item) — the real
    // dashboard at `/`, aggregating real Curricula/Exam Types/Attempts/Practice data created earlier in
    // THIS SAME run (steps 5-33 above), through the real `GET /api/dashboard` route.
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="dashboard-content"]', { timeout: 10_000 });
    results.push('PASS: / (the tenant dashboard) renders via a real navigation, with real aggregated data');

    const curriculaTileText = await page.getByTestId('stat-curricula').innerText();
    assert(/\d+/.test(curriculaTileText), `Curricula stat tile shows a real count (got '${curriculaTileText}')`);
    const examTypesTileText = await page.getByTestId('stat-exam-types').innerText();
    assert(/\d+/.test(examTypesTileText), `Exam Types stat tile shows a real count (got '${examTypesTileText}')`);
    results.push('PASS: dashboard Curricula/Exam Types stat tiles show real, permission-gated counts');

    const attemptsSectionText = await page.getByTestId('attempts-section').innerText();
    assert(
      attemptsSectionText.includes(attemptExamTypeName) || attemptsSectionText.includes(timeoutExamTypeName),
      'dashboard attempts section shows a real, recently-submitted/timed-out attempt from this same run',
    );
    results.push('PASS: dashboard attempts section shows real recent-attempt data from this same run (no fabricated rows)');

    // The Prompt Practice attempt at step 32 never persisted a row (AI_DISABLED before any DB write, see
    // that step's own doc comment) — the practice section therefore correctly renders its genuine empty
    // state, not a fabricated recent session.
    const practiceSectionText = await page.getByTestId('practice-section').innerText();
    assert(/no practice sessions yet/i.test(practiceSectionText), 'dashboard practice section shows its real, honest empty state (no session was ever persisted this run)');
    results.push('PASS: dashboard practice section correctly shows its real empty state (no Lesson Practice session was ever created in this run)');

    // 37. The dashboard's "Continue where you left off" card only ever renders when a real in-progress
    // attempt exists — every attempt created earlier in this run (steps 28/31) was already
    // Submitted/TimedOut before this point, so the real, honest state here is its absence, not a
    // fabricated resume card.
    assert((await page.getByTestId('continue-attempt-card').count()) === 0, 'no stale in-progress attempt leaks into the "continue" card (every attempt from this run was already closed)');
    results.push('PASS: dashboard shows no "continue where you left off" card when no attempt is genuinely in progress');

    // 38. Reload proves the summary is real server state (via `GET /api/dashboard`), not client-only.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="dashboard-content"]', { timeout: 10_000 });
    assert((await page.getByTestId('stat-curricula').innerText()) === curriculaTileText, 'dashboard summary survives a hard reload (real server-side aggregation, not client-only state)');
    results.push('PASS: dashboard summary survives a hard reload, confirming it is real server-computed state');

    // 17. Log out returns to the login page. `TenantShell.handleLogout` navigates to a bare `/login`,
    // but the `(shell)` layout's own auth-guard effect can independently redirect to
    // `/login?returnUrl=...` first once `status` flips to `'unauthenticated'` — either is a correct
    // landing, so the wait pattern must tolerate the optional query string.
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByText('Log out').click();
    await page.waitForURL(/\/login(\?.*)?$/, { timeout: 10_000, waitUntil: 'commit' });
    results.push('PASS: log out returns to /login');

    assert(consoleErrors.length === 0, `expected zero console errors, got: ${JSON.stringify(consoleErrors)}`);
    results.push('PASS: zero console errors across every page load in this run');
  } finally {
    await browser.close();
  }

  console.log(results.map((r) => `  ${r}`).join('\n'));
  console.log('\nAll tenant-realm Playwright smoke assertions passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
