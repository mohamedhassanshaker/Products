# QA Retry - Round 3: D-6 re-verification (deployments-list phone stacked-card overlap)

**Scope**: narrow re-verification of D-6 only (per orchestrator dispatch). D-6 was
found in QA retry-1 (BL-004): fixing the admin-shell responsive bug (D-2) unmasked a
second, independent phone-layout bug - the deployments table stacked-card rows
overlapped each other and the paginator at <=767px, because `tr[mat-row]` kept
Materials fixed ~52px row height with `overflow: visible`. Round-2 dev fix (decision
log 2026-08-19 "development (QA-driven fix pass round 2)") claims the fix but was
**only verified by inspecting the compiled `dist/admin` bundle** - no browser was
available in that dev agents sandbox. This pass closes that gap with a real browser.

Feature slug: `phase1-admin-spa`. Requirement in scope: UX_GUIDELINES Section 5 phone
responsive layout for Screen 3 (Deployments list), the same requirement D-2/D-3/D-6
were dispatched against.

## Environment

- `apps/web` admin SPA, dev server already running via `pnpm start` (`ng serve
  admin`, port 4200, `servePath: "/admin/"` - confirmed 200 on `http://localhost:4200/admin/`).
  A second `pnpm start` invocation in this session hit "port 4200 already in use" -
  the running instance was from the current round environment and is Vite-based
  (`ng serve` with esbuild/Vite dev-server), so it live-compiles from current source
  on every navigation; no stale-bundle risk.
- Backend: **unreachable in this sandbox**, reconfirmed directly (`docker version`
  under a bounded 20s timeout returned exit 124 / hang), consistent with every prior QA and
  dev pass in this project decision log. Per the dispatch disclosed fallback, the
  API network boundary was stubbed with Playwright route interception at
  `**/api/auth/login`, `**/api/auth/me`, and `**/api/tenants*` - realistic multi-tenant
  fixture data (6 deployments, mixed active/paused status, mixed provider-configured/
  not-configured, varying name/slug lengths including long slugs, one deployment with
  a long remote-provider-stack summary string to stress word-wrap). This is disclosed,
  not hidden: **no live backend was used**, and this stub only replaces the 3 HTTP
  calls named above - all UI rendering, layout, CSS cascade, and Angular
  change-detection are the real compiled app in a real Chromium browser (Playwright
  1.62.1, bundled Chromium 1148), not a component harness.
- Browser: Playwright Chromium, real navigation (login form filled and submitted via
  `page.click`, not `router.navigate` or direct service calls).
- Test data: fixture-only (`tenant-1`..`tenant-6`), no writes to any real store, no
  cleanup needed.

## Method

Logged in through the real login form (stubbed `/api/auth/login` + `/api/auth/me`),
landed on `/admin/deployments` (stubbed `/api/tenants`) with 6 fixture rows, then
resized the same live page to four widths and at each one: took a full-page
screenshot, and ran `getBoundingClientRect()` against every `tr[mat-row]` and the
`mat-paginator`, computing (a) row(i).bottom vs row(i+1).top for every adjacent pair,
(b) last row bottom vs the paginator top, and (c) `scrollWidth` vs `clientWidth` on
every `td[mat-cell]` to catch un-wrapped overflow. Also read `getComputedStyle` on the
table element to confirm block/table display mode matches the breakpoint.

## Result: row/paginator overlap (the actual D-6 defect)

| Width | Row-row overlaps | Row to paginator overlap | Table display |
|---|---|---|---|
| 375px | none (0 pairs, all bottom <= next.top) | none (last row bottom 2033 < paginator top 2049) | block (stacked cards) |
| 414px | none | none (last row bottom 1973 < paginator top 1989) | block |
| 767px (boundary) | none | none (last row bottom 1589 < paginator top 1605) | block |
| 1280px (desktop) | none | none (last row bottom 665 = paginator top 665) | table (normal table, not stacked) |

Raw measurements and screenshots:
- `01-deployments-375w.png` - full page, 6 rows + paginator, no visual overlap.
- `02-deployments-414w.png` - same, 414px.
- `03-deployments-767w-boundary.png` - same, at the 767px breakpoint boundary itself.
- `04-deployments-1280w-desktop.png` - desktop: real `<table>` (persistent sidenav,
  header row, columns aligned), confirming the phone-only media query did not leak
  into desktop and nothing regressed there.

**D-6 originally reported symptom (rows painting on top of each other and on the
paginator) is genuinely fixed.** Confirmed both visually (screenshots) and by the same
`getBoundingClientRect` measurement method the round-2 QA pass used to find the bug in
the first place - this is a like-for-like re-verification, not a weaker check.

## New finding this pass: label text breaks mid-word at <=414px (D-7, new, Low)

While checking item (c) of the dispatch - "text wraps/word-breaks correctly rather
than overflowing" - found that the *value* text wraps correctly (long slugs and the
long provider-stack string wrap cleanly, no horizontal overflow of visible content),
but the row **label** (the `data-label` content rendered via `td[mat-cell]::before`,
e.g. "Name", "Slug", "Providers") also inherits the fix cell-wide `white-space:
normal; word-break: break-word` and has no `flex-shrink: 0` / `white-space: nowrap`
override of its own. At 375px and 414px this makes short label words break mid-letter
under `justify-content: space-between` pressure: **"Name" renders as "Na" / "me" on
two lines, "Slug" as "Sl" / "ug", "Providers" as "Prov" / "iders" / "s"** - visible in
`01-deployments-375w.png`, `02-deployments-414w.png`, and the zoomed
`05-label-wordbreak-zoom-375.png`. At 767px the column has enough width and the labels
render on one line (`03-deployments-767w-boundary.png`), so this is specifically a
<=414px-width issue.

Root-cause confirmed via `getComputedStyle(cell, '::before')`: `word-break:
break-word` and `white-space: normal` are inherited by the pseudo-element from the
`td[mat-cell]` rule (deployments-list-page.component.scss lines 75-90), and the
pseudo-element `flex-shrink` computes to `1` (default) with no `white-space: nowrap`
override, so the flex layout wraps/breaks the label instead of leaving it on one line
and only wrapping the value.

This is not the same defect as D-6 (no overlap occurs - the label just becomes hard to
read) and does not block the requirement that rows must not overlap. It is a rough
edge in the same stylesheet the D-6 fix touched, worth a follow-up (`data-label`
should get its own `white-space: nowrap` / `word-break: normal` so only the value
wraps), but it should not gate closing D-6 itself.

## Traceability

| Item | Scenario | Result | Evidence |
|---|---|---|---|
| D-6 (row-row overlap, <=767px) | 6-row fixture at 375/414/767px, getBoundingClientRect on every row | PASS - 0 overlaps at every width | screenshots 01-03, raw rect data above |
| D-6 (last row vs paginator) | Same fixture, last row bottom vs paginator top | PASS - no overlap at any phone width | same |
| Desktop regression check | 1280px, same fixture | PASS - real table, not stacked, header row present | screenshot 04 |
| Text wrap/word-break correctness | Long slug + long provider string wrap | PASS (values) / FAIL (labels break mid-word at <=414px) | screenshots 01, 02, 05; computed-style dump above |

## Defects

1. **D-7 (new, Low, same file as D-6)** - `data-label::before` content breaks
   mid-word ("Na"/"me", "Sl"/"ug", "Prov"/"iders"/"s") at <=414px width because it
   inherits the cell `word-break: break-word` / `white-space: normal` with no
   `flex-shrink: 0` / `white-space: nowrap` override of its own.
   - File: `apps/web/projects/admin/src/app/features/deployments/pages/deployments-list-page/deployments-list-page.component.scss`
   - Repro: load `/admin/deployments` with >=1 row of data, resize to 375px or 414px
     width, observe the "Name"/"Slug"/"Providers" row labels split across lines.
   - Originating phase: same phase/file as D-6 (the round-2 QA-driven fix pass). Not
     blocking; does not reintroduce overlap; recommend batching with any future pass
     that touches this stylesheet, not urgent enough to force an immediate retry on
     its own.

No other defects found in this narrow scope.

## Verdict

**D-6: FIXED.** The reported row/paginator overlap at phone width is genuinely
resolved, confirmed in a real browser (not just bundle inspection) with the same
`getBoundingClientRect` method the original defect was caught with, at 375px, 414px,
and the 767px breakpoint boundary, across 6 populated fixture rows, with no desktop
regression at 1280px.

**Overall for this narrow scope: PARTIALLY-FIXED** - D-6 itself closes clean, but this
pass surfaced one new low-severity cosmetic defect (D-7) in the same stylesheet that
was not visible to the prior bundle-only check. D-7 does not block closing D-6 or
BL-004; recommend the orchestrator either batch D-7 into the next dev pass that
touches this file or accept it as a known low-severity rough edge.
