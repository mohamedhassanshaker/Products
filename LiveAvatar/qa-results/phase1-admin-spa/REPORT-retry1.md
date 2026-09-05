# QA Retry Report #1 - Phase 1 Admin SPA (BL-004)

Date: 2026-08-19
Scope: apps/web Angular workspace only (admin/conversation/shared) - re-verification of the D-0..D-5 fix pass from qa-results/phase1-admin-spa/REPORT.md, plus full regression on core flows already passing in the prior pass. Backend covered by a parallel nexus-qa pass.

## Environment

- apps/web on Angular 20 (Vite dev server), Jest 30, ESLint.
- Backend/Docker still unreachable in this sandbox (consistent with both prior QA passes) - the scenarios below that need the API are stubbed at the network boundary (page.route) with spec-shaped envelopes; every stub is disclosed per scenario. Scenarios that do not need a JSON response (guard redirects, invite missing-token, plain ng serve admin bring-up, autofocus, icon-font/favicon delivery) ran against the real, unstubbed dev server.
- Dev server: pnpm start (i.e. the literal ng serve admin command from package.json, no flags) on port 4200, started and re-verified alive before and after every scenario batch; stopped at the end of this pass (test hygiene - no lingering processes left running).
- Browser: real Chromium via Playwright 1.62 (ad hoc, no permanent e2e harness added - consistent with the dev agent logged Phase-3 deferral of axe-core/full e2e).
- Screenshots: qa-results/phase1-admin-spa/20260819-032927/*.png (16 captures).
- Tooling note for the record, not a product defect: my first attempt at a single long-lived Playwright script driving all scenarios through one shared browser context repeatedly hung/timed out for reasons internal to that script once 3-4 pages had been opened against the Vite dev server in the same context; switching to one fresh browser context per scenario resolved it completely and every scenario below ran cleanly and reproducibly. Flagging so a future QA pass does not rediscover the same non-issue from scratch.

## Full regression toolchain (claimed vs verified)

| Check | Claimed | Verified this pass |
|---|---|---|
| npx jest --coverage | 26/26 suites, 167/167 tests | Confirmed: 26/26 suites, 167/167 tests passed, ~99%/95% coverage |
| npx eslint projects/**/*.ts | clean | Confirmed: 0 errors, 0 warnings |
| ng build admin | clean | Confirmed: clean production build (pre-existing informational warning about @liveavatar/contracts not being ESM - present before this fix pass too, not a regression) |
| ng build conversation | clean | Confirmed: clean production build |

No regressions found in the toolchain.

## Defect-by-defect re-verification

### D-0 (High) - ng serve admin / pnpm start served a blank page - FIXED
angular.json now sets serve.options.servePath = "/admin/" on the admin project. Verified live: ran the exact ng serve admin --port 4200 command (no --serve-path flag), then:
- curl http://localhost:4200/admin/login -> 200
- curl http://localhost:4200/admin/main.js / /polyfills.js / /styles.css / /favicon.ico -> all 200
- Loaded in a real browser: full app bootstraps, "Sign in" heading renders.
Evidence: 20260819-032927/01-d0-plain-ng-serve-login.png.
Verdict: fixed, no caveats.

### D-1 (Medium) - Login email not focused on first paint - FIXED
Loaded /admin/login fresh (real dev server, no stub, 500ms settle) and read document.activeElement: tag=INPUT, formcontrolname=email - the email input is focused on first paint, matching UX_GUIDELINES 2.2 ("Default: Email focused on first paint"). Visually confirmed via screenshot (blue Material focus outline on the Email field with no user interaction).
Evidence: 20260819-032927/01-d0-plain-ng-serve-login.png (same capture, shows the focus ring).
Verdict: fixed, no caveats.

### D-2 (Medium) - Admin shell had zero responsive behavior - FIXED
Verified live at 375x800 (authenticated, stubbed session/tenants):
- Persistent sidenav is not shown; a hamburger button (aria-label="Open navigation") is shown in the toolbar.
- Main content area (.la-shell__content) takes the full 375px width (no squeeze) - boundingBox().width = 375.
- Clicking the hamburger opens the sidenav as a CDK mode="over" overlay drawer (mat-drawer-over mat-drawer-opened), confirmed both by DOM class and screenshot.
- Clicking outside the drawer panel (a point genuinely outside its 256px width, not the backdrop element's own bounding-box center, which itself overlaps the drawer) closes it - confirmed via mat-drawer-backdrop interaction. Escape also closes it (CDK default).
- At 1366px (desktop, >=1280 breakpoint): hamburger is not rendered; the persistent 256px sidenav is shown and takes no toolbar space. No overlap, clean layout (screenshot 06).
Evidence: 20260819-032927/03,04,05,06-*.png.
Verdict: fixed, no caveats - the shell-level responsive/hamburger behavior itself is correct and matches UX_GUIDELINES 1.4/4.6.

### D-3 (Low, as originally scoped) - data-label never set on table cells - FIXED, but exposes a new, more serious defect (see D-6 below)
The specific original claim - td[mat-cell] elements have no data-label attribute, so the phone stacked-card ::before { content: attr(data-label) } CSS renders blank labels - is verified fixed: every cell now has the correct data-label ("Name", "Slug", "Providers", "Status", "Last modified", "Actions"), and getComputedStyle(cell, '::before').content returns the matching label text for all 6 columns on both rows tested.
However, now that D-2 no longer masks the phone layout (which was previously unusable/unreadable due to the un-collapsible sidenav), a new defect is now visible and reproducible: see D-6.
Evidence: 20260819-032927/07,08-*.png; raw label/content pairs captured via getComputedStyle.

### D-6 (NEW, High) - Deployments table stacked-card rows visually overlap at phone width, and the paginator overlaps the last row
Not part of the original defect list - only became visible/testable once D-2 was fixed and the sidenav stopped squeezing the table into an unreadable 120px column. At 375px width:
- Screenshot 07-d3-deployments-phone-375-stacked.png and the zoomed crop 08-d3-table-zoom.png show row 1's "Providers" line directly overlapping row 2's "Name" line, row 1's "Actions" line overlapping row 2's "Status" line, and the mat-paginator overlapping the final row's "Last modified"/"Actions" lines. Text from adjacent rows is genuinely illegible where it overlaps.
- Root cause (confirmed via getBoundingClientRect on every cell): each stacked td[mat-cell] is display:flex and lays out fine internally, but the parent tr[mat-row] keeps Angular Material's own row-height CSS (height: 52px, overflow: visible) with no override in deployments-list-page.component.scss's phone media query. Six stacked label/value lines need roughly 190px of vertical space per row, but the row's own box only reserves ~77px (a partially-auto-expanded value, still short of the real content height) before the next sibling row starts its own layout - so cell content for a given row visibly overflows tens of pixels into the space where the next row (and the paginator) is positioned. Measured concretely: row 1's cells span y=321-515px; row 2's cells start at y=398px - a ~117px overlap zone.
- This means the phone/stacked-card requirement (UX_GUIDELINES 1.4, "Phone <768: ... stacked definition-list cards") is still not met after this fix pass, just via a different mechanism than originally reported (blank labels -> now correct labels, but illegible row overlap instead).
Repro: authenticate, resize to <=767px width, view the Deployments table with 2+ rows.
Evidence: 20260819-032927/07-d3-deployments-phone-375-stacked.png, 08-d3-table-zoom.png (zoomed crop of .la-deployments-table, unambiguous).
Originating phase: BL-004 (deployments-list-page component/SCSS) - discovered during this retry pass, not present in the original defect list because D-2 masked it.
Severity: High / blocks the requirement - the UX_GUIDELINES phone layout requirement for this screen is explicitly called out as required ("this product ... is not a fixed-form-factor appliance ... required"), and the table is the primary content of the one live screen in Phase 1. This should go back to nexus-dev in the same retry cycle as any other still-open item, not be deferred with the low-severity items.

### D-4 (Low) - Icon font CDN-only, no self-hosted fallback - FIXED
styles.scss now @font-face-registers a self-hosted "Material Symbols Outlined" (assets/fonts/material-symbols-outlined.woff2, shipped in the bundle) and maps .material-icons (MatIconModule's actual default fontSet class - the dev agent's write-up correctly identifies this was never targeted by a font before, a second, previously-undiscovered bug) to it.
Verified live with fonts.googleapis.com and fonts.gstatic.com both blocked (simulating an egress-restricted deployment, page.route(...).abort()):
- mat-icon elements still resolve font-family: "Material Symbols Outlined" and render actual glyphs (confirmed visually - smart_toy, inbox, etc all render as icons, not text ligatures) in the screenshot.
- GET /admin/assets/fonts/material-symbols-outlined.woff2 -> 200 (served from the app's own origin, not a CDN).
- Only one request was blocked during the whole flow: fonts.googleapis.com/css2?family=Roboto... - the body font, which the index.html comment explicitly and correctly documents as an accepted graceful-degradation case (falls back to the sans-serif stack), not the icon font.
Evidence: 20260819-032927/09-d4-icons-cdn-blocked-deployments.png.
Verdict: fixed, no caveats.

### D-5 (Low) - Missing favicon.ico, 404 console noise - FIXED
projects/admin/src/favicon.ico now exists and is wired into angular.json's assets glob. Verified GET /admin/favicon.ico -> 200 (both via curl against the plain ng serve admin process and via Playwright's APIRequestContext).
Verdict: fixed, no caveats.

## Regression - core flows re-verified (all previously PASS in REPORT.md)

| Requirement | Scenario | Method | Result | Evidence |
|---|---|---|---|---|
| FR-AUTH-1 - guarded route redirect | Unauthenticated GET /admin/deployments | Real browser, no stub | Pass - landed on /admin/login?returnUrl=%2Fdeployments | 10-reg-guard-redirect.png |
| FR-AUTH-3 - invite missing token | /admin/invite (no token) | Real browser, no stub | Pass - "Invite unavailable" empty-state heading rendered | 11-reg-invite-missing-token.png |
| FR-TENANT-2 - deployments list populated, status chips, providers em-dash, pagination | Login (stubbed) -> deployments list, 3 tenants | Stubbed network (disclosed) | Pass - table renders correctly, icons render (see D-4), em-dash for provider_stack_summary null | 12-reg-deployments-populated.png |
| FR-TENANT-2 - search -> empty state -> clear filters | Search "zzz-no-match" then Clear filters | Stubbed network (disclosed) | Pass - "No matching deployments" then repopulates to 3 rows | 13-reg-search-empty-state.png |
| FR-TENANT-2 - status filter | Select "Paused" | Stubbed network (disclosed) | Pass - filters to the 1 paused tenant | verified via row count |
| FR-TENANT-4 - pause confirm dialog copy/buttons | Row actions -> Pause | Stubbed network (disclosed) | Pass - dialog title/body/buttons match spec verbatim, confirms and closes on click | 14-reg-pause-confirm-dialog.png |
| FR-CONFIG-5 - unknown tenant deep link -> redirect + snackbar | /admin/tenants/t404/builder with mocked 404 TENANT_NOT_FOUND | Stubbed network (disclosed) | Pass - redirected to /admin/deployments, snackbar "Tenant not found." | 15-reg-builder-404-redirect.png |
| UX 1.5 - sign-out clears session, blocks re-entry | User menu -> Sign out, then re-visit /deployments | Stubbed network (disclosed) | Pass - landed on /admin/login, re-visiting /deployments redirects back to login with returnUrl | 16-reg-signout-landed-login.png |

No regressions found in any previously-passing core flow.

## Traceability matrix (this retry's scope)

| Item | Scenario(s) | Result | Evidence |
|---|---|---|---|
| D-0 | Plain ng serve admin/pnpm start bring-up | Fixed | 01-*.png, curl 200s |
| D-1 | Login autofocus on first paint | Fixed | 01-*.png, document.activeElement |
| D-2 | Responsive shell 375px + hamburger open/close + 1366px desktop | Fixed | 03,04,05,06-*.png |
| D-3 | data-label attribute presence/content on table cells | Fixed (see D-6 for the layout defect it exposes) | 07,08-*.png |
| D-6 (new) | Stacked-card row overlap + paginator overlap at phone width | Fail - new defect | 07,08-*.png, cell geometry dump |
| D-4 | Self-hosted icon font under simulated CDN block | Fixed | 09-*.png |
| D-5 | favicon 200 | Fixed | curl/APIRequestContext 200 |
| Regression: guard redirect, invite, list/search/filter/pause/deep-link/sign-out | See regression table above | Pass (no regressions) | 10-16-*.png |
| Jest/ESLint/build x2 | Full toolchain | Pass, matches claimed counts | terminal output, see above |

## Defects (ordered by severity)

D-6 (High, NEW) - Deployments table stacked-card rows overlap illegibly at phone width (<=767px); paginator overlaps the last row. See full write-up above. Originating phase: BL-004. Discovered this retry (masked by D-2 in the prior pass). Recommend routing back to nexus-dev in the next retry alongside any other open items - this is the same UX_GUIDELINES phone requirement the original D-2/D-3 pair was meant to close, and it is not closed yet.

No other defects found. D-0, D-1, D-2 (shell-level), D-3 (as originally scoped), D-4, D-5 are all confirmed fixed with no caveats.

## Overall verdict: PASS-WITH-CAVEATS (not ready to close BL-004)

Five of the six original defects (D-0, D-1, D-2, D-4, D-5) are fixed cleanly with no caveats, and D-3's originally-reported symptom (blank data-label text) is also genuinely fixed. Full regression is clean: Jest 26/26 (167/167 tests), ESLint clean, both builds clean, and every previously-passing core flow (login, invite-accept, guarded routes, deployments list/search/filter/paginate/pause/activate, deep links, sign-out) still works correctly.

However, this is not a clean PASS because fixing D-2 (the shell's responsive behavior) removed the thing that was previously hiding a second, independent phone-layout bug in the deployments table itself (D-6): stacked rows overlap each other and the paginator, making the table still illegible at phone width, just for a different reason than before. Since UX_GUIDELINES explicitly requires this layout ("not a fixed-form-factor appliance ... required"), and this is the same feature area the retry was dispatched to close out, recommend one more retry to nexus-dev scoped narrowly to D-6 (deployments-list-page phone stacked-card row sizing/overflow) before marking BL-004 fully closed. Nothing else in this scope needs further work.
