/**
 * `e2e/backoffice/evaluation.spec.ts` — golden path (create a golden set, add a case, run
 * it now against a real published agent version), a real validation error, and a
 * permission boundary for `/evaluation` (B13: Evaluation & testing). Gated on
 * `evaluation:manage`, granted only to `SuperAdmin`/`EntityAdmin` — Ahmed Saeed is the only
 * one of the three seeded sessions who holds it.
 *
 * `e2e/global-setup.ts`'s own module comment names why there is no dedicated seed step for
 * this screen: this suite creates its own golden set rather than depending on a fixture
 * script. `sharjah.GoldenSets` has zero rows before this file's own golden path runs
 * (confirmed live), so every set this file sees is one this file (or a prior run of it,
 * since this suite's fixtures are shared and mutating under `workers: 1`) created.
 *
 * The "Run now" step targets the real, deterministically-seeded "General FAQ Agent" v2.4
 * (`scripts/seed-agents-tools-demo-data.ts` — `major: 2, minor: 4, status: "Published"`,
 * wired into `global-setup.ts`'s own `db:seed:agents` step) rather than an agent this suite
 * creates itself, so this test needs no dependency on `agents.spec.ts` having run first.
 * Its ids are hardcoded from a direct, live query against the real dev database rather than
 * guessed — `tasks/lessons.md`'s own "a hand-typed identifier that isn't exactly right
 * silently corrupts every later comparison" lesson applies to test fixtures too, so these
 * were copied verbatim from `SELECT id FROM sharjah.Agents/AgentVersions`, not retyped.
 */
import { test, expect } from "@playwright/test";
import { covers } from "../support/covers.js";

// `SELECT id, slug FROM platform.Tenants` — real, 26-char ULID (GoldenSets.ownerTenantId is
// `CHAR(26)`; a shorter hand-typed value would silently space-pad and corrupt every later
// equality comparison, per `tasks/lessons.md`).
const SHARJAH_TENANT_ID = "01M21Y2GKN6HR2VG8MFE6QGVFZ";
// The real, deterministically-seeded "General FAQ Agent" v2.4 (`SELECT a.id, av.id, av.label,
// av.status FROM sharjah.Agents a JOIN sharjah.AgentVersions av ...`).
const GENERAL_FAQ_AGENT_ID = "01M0Z65YPRFTA3GH9935XKNKGP";
const GENERAL_FAQ_AGENT_V24_ID = "01M0Z65YPREY25GB7ANR0QSA9P";

test.describe("Evaluation — Super Admin (Ahmed Saeed, sharjah, holds evaluation:manage)", () => {
  test.use({ storageState: "e2e/.auth/super-admin.json" });

  test("golden path: create a golden set, add a case, and run it now", async ({ page }) => {
    covers("FR-EVAL-01", "FR-EVAL-02", "FR-EVAL-04");
    const setName = `E2E Golden Path Set ${Date.now()}`;

    await page.goto("/en/evaluation");
    await expect(page.getByRole("heading", { name: "Evaluation & testing" })).toBeVisible();
    await page.getByRole("tab", { name: "Golden sets" }).click();

    await page.getByPlaceholder("Set name").fill(setName);
    await page.getByPlaceholder("Owner tenant id").fill(SHARJAH_TENANT_ID);
    await page.getByRole("button", { name: "Create set" }).click();

    const setRow = page.locator("tr", { has: page.getByText(setName, { exact: true }) });
    await expect(setRow).toBeVisible();
    await expect(setRow.getByText("Not yet run")).toBeVisible();

    // Expand the row and add one case. `DataTable`'s expand toggle names itself
    // "Expand ⁨{row label}⁩", falling back to the row's own raw id when no `getRowLabel`
    // is supplied (as here) — not the generic "Expand row" (that string is the visually-
    // hidden *column header*, `EXPAND_COLUMN_LABEL`, a different element entirely). The
    // `data-row-action="expand"` attribute is the one stable, id-agnostic way to find it.
    await setRow.locator('[data-row-action="expand"]').click();
    await page.getByPlaceholder("Prompt").fill("What are your working hours?");
    await page.getByPlaceholder("Expected behaviour").fill("States the published working hours.");
    await page.getByRole("button", { name: "Add case" }).click();
    await expect(page.getByText("What are your working hours?")).toBeVisible();

    // Run it now against the real, seeded "General FAQ Agent" v2.4 — a real call into
    // `apps/ai`'s live orchestration/embedding endpoints, not a mock. `renderRowActions`
    // renders `RunNowControls` (its own "Agent id"/"Agent version id" inputs) for EVERY
    // row, not just an expanded one — this suite's own prior runs left other golden-set
    // rows in the table, each with an identically-labelled pair, so these must be scoped
    // to this test's own `setRow`, never looked up page-wide.
    await setRow.getByLabel("Agent id").fill(GENERAL_FAQ_AGENT_ID);
    await setRow.getByLabel("Agent version id").fill(GENERAL_FAQ_AGENT_V24_ID);
    await setRow.getByRole("button", { name: "Run now" }).click();

    // A real run either passes, fails or errors — any of the three is a real, completed
    // regression run and proves FR-EVAL-02's "produces a fresh score" golden path. What
    // matters here is that the set's own "Last score" is no longer "Not yet run".
    await expect(setRow.getByText("Not yet run")).toHaveCount(0, { timeout: 30_000 });

    // `DataTable`'s own `data-row-id` — the real golden set's own id — since
    // `regression-runs-tab.tsx`'s own doc comment names its "Set" column as showing
    // `goldenSetId` by id, not by name (a named, deferred polish item, not a bug).
    const goldenSetId = await setRow.getAttribute("data-row-id");
    await page.getByRole("tab", { name: "Regression runs" }).click();
    const runRow = page
      .locator("tr", { has: page.getByText(goldenSetId!, { exact: true }) })
      .first();
    await expect(runRow).toBeVisible();
  });

  test("validation error: a LanguageParity set with no locale is rejected", async ({ page }) => {
    covers("FR-EVAL-01");
    await page.goto("/en/evaluation");
    await page.getByRole("tab", { name: "Golden sets" }).click();

    await page.getByPlaceholder("Set name").fill(`E2E Invalid Parity Set ${Date.now()}`);
    await page.getByPlaceholder("Owner tenant id").fill(SHARJAH_TENANT_ID);
    await page.getByLabel("Kind").selectOption("LanguageParity");
    // Locale left blank deliberately — `CreateGoldenSet`'s own `CK_GoldenSets_parityHasLocale`
    // pre-check (`evaluation.language_parity_requires_locale`) fires before any insert.
    await page.getByRole("button", { name: "Create set" }).click();

    await expect(page.getByText("evaluation.language_parity_requires_locale")).toBeVisible();
  });
});

test.describe("Evaluation — permission boundary (Sara, AgentDesigner)", () => {
  test.use({ storageState: "e2e/.auth/agent-designer.json" });

  test("Sara (AgentDesigner) is denied /evaluation entirely", async ({ page }) => {
    covers("FR-IAM-12");
    await page.goto("/en/evaluation");
    await expect(
      page.getByRole("heading", { name: "You don't have access to this screen" }),
    ).toBeVisible();
  });
});

test.describe("Evaluation — permission boundary (Omar, LiveAgent)", () => {
  test.use({ storageState: "e2e/.auth/live-agent.json" });

  test("Omar (LiveAgent) is denied /evaluation entirely", async ({ page }) => {
    covers("FR-IAM-12");
    await page.goto("/en/evaluation");
    await expect(
      page.getByRole("heading", { name: "You don't have access to this screen" }),
    ).toBeVisible();
  });
});
