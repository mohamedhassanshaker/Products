# QA Final Confirmation Pass - D-7 (label word-break) + D-6 non-regression, BL-004

**Scope**: narrow re-verification per orchestrator dispatch. The round-3
dev fix pass claims D-7 fixed (`white-space: nowrap` added to
`td[mat-cell]::before` in
`apps/web/projects/admin/src/app/features/deployments/pages/deployments-list-page/deployments-list-page.component.scss`)
but explicitly disclosed it was **not browser-verified** (no browser available in
that sandbox). This pass closes that gap in a real browser and re-confirms D-6
(row/paginator overlap, closed in the prior QA round) has not regressed.

> Screenshots: `qa-results/phase1-admin-spa/20260819-103023-final/`

## Environment

- `apps/web` admin SPA: an `ng serve admin` dev server (Vite-based, live-compiles
  from current source) was already running on `http://localhost:4200/admin/`
  (confirmed 200). A second `pnpm start` attempt in this session correctly failed
  with "port 4200 already in use," confirming it is the live source, not a stale
  bundle - no fresh restart was needed or performed.
- Backend: unreachable in this sandbox (`docker version` hung under the tool's
  default timeout, consistent with every prior QA/dev pass in this project's
  decision log). Per the disclosed fallback used in the prior D-6 verification
  pass, stubbed only the 3 HTTP boundaries (`**/api/auth/login`, `**/api/auth/me`,
  `**/api/tenants*`) via Playwright route interception with realistic fixture
  data (6 tenants, mixed active/paused, mixed provider-configured/not, a long
  provider-stack summary string and a long slug to stress word-wrap, matching the
  real `TenantListItemDto` field names: `provider_stack_summary`, `updated_at`,
  etc., verified against `packages/contracts/src/tenants/schemas.ts`). This is
  disclosed, not hidden - no live backend, but all rendering/layout/CSS
  cascade/change-detection is the real compiled app in a real Chromium browser
  (Playwright 1.62.1), not a component harness.
- Browser: Playwright Chromium, real navigation (login form filled via
  `page.fill`/`page.click`, not direct service/router calls).
- Test data: fixture-only, no writes to any real store, no cleanup needed.

## Method

Logged in through the real login form, landed on `/admin/deployments` with 6
fixture rows, then at each of 375px / 414px / 767px (boundary) / 1280px
(desktop): took a full-page screenshot, and via `page.evaluate` measured (a)
`getBoundingClientRect` row-row and row-to-paginator overlap (same method the
original D-6 defect and its prior re-verification used), and (b)
`getComputedStyle(cell, '::before')` on the label pseudo-element to check
`white-space`/`word-break` directly, plus a zoomed screenshot of the first card
at 375px for visual confirmation. Also captured console output for the whole
session.

## Result: D-7 (label word-break)

| Width | `::before` white-space | `::before` word-break | Visual |
|---|---|---|---|
| 375px | `nowrap` | `break-word` (irrelevant once `white-space: nowrap` is set - a nowrap element does not break) | "Name", "Slug", "Providers", "Status", "Last modified", "Actions" all render on one line - screenshot `01-deployments-375w.png`, zoomed `05-label-zoom-375.png` |
| 414px | `nowrap` | same | Same, all labels intact - `02-deployments-414w.png` |
| 767px (boundary) | `nowrap` | same | Same - `03-deployments-767w.png` |
| 1280px (desktop) | `normal` (phone-only rule correctly does not apply) | `normal` | Real table header row, not a pseudo-label - `04-deployments-1280w.png`, expected and correct |

**D-7 is genuinely fixed.** Visually confirmed in the screenshots: "Providers"
(the longest label, the one originally reported breaking as "Prov"/"iders"/"s")
now renders on a single line at 375px, 414px, and 767px. The long value text
(the 84-character provider-stack summary and the long slug
`beta-industries-long-slug-example`) still wraps correctly onto its own lines -
the fix is correctly scoped to the label pseudo-element only, and did not
disable wrapping on the value cells.

## Result: D-6 non-regression (row/paginator overlap)

| Width | Row-row overlap | Row-paginator overlap | Table display |
|---|---|---|---|
| 375px | none (6 rows measured, 0 overlapping pairs) | none | `block` (stacked cards) |
| 414px | none | none | `block` |
| 767px (boundary) | none | none | `block` |
| 1280px (desktop) | none | none | real table (not stacked) |

**D-6 remains fixed** - no regression introduced by the D-7 change, confirmed
with the identical `getBoundingClientRect` measurement method used to catch the
original defect and to verify its prior fix.

## Console/network check

Zero console errors or page errors captured across the full flow (login ->
deployments -> 4 resize/measurement passes) - `console-errors.log` is empty.

## Traceability matrix

| Item | Scenario | Result | Evidence |
|---|---|---|---|
| D-7 (label mid-word break, <=414px) | 6-row fixture, `::before` computed style + visual screenshot at 375/414/767px | PASS - `white-space: nowrap` confirmed, no mid-word breaks visible | `01-*.png`, `02-*.png`, `03-*.png`, `05-*.png`, `measurements.json` |
| D-6 non-regression (row/paginator overlap) | Same fixture, `getBoundingClientRect` on every row + paginator at 375/414/767px | PASS - 0 overlaps at every width | `measurements.json` |
| Desktop regression check | 1280px, same fixture | PASS - real table, header row, not stacked | `04-deployments-1280w.png` |
| Console/network cleanliness | Full login->deployments->resize flow | PASS - 0 errors | `console-errors.log` |

## Defects

None found in this pass.

## Verdict (this file's scope)

**D-7: FIXED**, browser-verified (closing the dev agent's disclosed
verification gap). **D-6: confirmed still fixed, no regression.** Both phone
stacked-card layout defects for the deployments list (Screen 3 / UX_GUIDELINES
Section 5) are now closed with real-browser evidence.
