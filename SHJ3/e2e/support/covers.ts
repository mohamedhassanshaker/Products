/**
 * Requirement-coverage annotation for Playwright specs — the E2E-layer counterpart to
 * `docs/testing.md` §1.2's `covers()`/`@pytest.mark.covers` convention on the Vitest/pytest
 * side.
 *
 * ## Why this is a narrower implementation than the doc's full contract
 *
 * `docs/testing.md` §1.2 describes `covers()` as feeding `scripts/requirement-coverage.ts`,
 * a cross-runtime aggregator that joins Vitest/pytest/Playwright/k6 JSON reports against
 * `requirements.md`'s ID inventory. Neither `scripts/requirement-coverage.ts` nor a Vitest-
 * side `test/covers.ts` exists yet anywhere in this repository (checked directly, not
 * assumed) — building that aggregator is a cross-cutting piece spanning both test runtimes,
 * out of scope for this pass, which is E2E infrastructure and initial backoffice coverage
 * only. `docs/requirements-traceability.md` records the gap explicitly.
 *
 * What this file gives, on its own and honestly: every requirement id a test covers is
 * pushed onto Playwright's own `TestInfo.annotations`, which the built-in `json` reporter
 * already serialises per test into `reports/e2e-results.json` (see `playwright.config.ts`).
 * That is real, inspectable machine-readable output today — `grep`-able, and a straight
 * upgrade path to a real aggregator later (it would read this exact field) — without
 * inventing a parallel, uninspected annotation format.
 *
 * ## Usage
 *
 * Call inside a `test(...)` body, not inside `test.describe(...)` — unlike Vitest's
 * `describe` callback, Playwright's `test.describe` callback runs at *collection* time,
 * before `test.info()` exists, so `covers()` has nothing to attach to there.
 *
 * ```ts
 * test("an Entity Admin can invite a user", async ({ page }) => {
 *   covers("FR-IAM-01", "FR-IAM-05");
 *   // ...
 * });
 * ```
 */

import { test } from "@playwright/test";

/** Record the requirement ids this test proves, onto the currently-running test's own report entry. */
export function covers(...requirementIds: readonly string[]): void {
  const info = test.info();
  for (const id of requirementIds) {
    info.annotations.push({ type: "covers", description: id });
  }
}
