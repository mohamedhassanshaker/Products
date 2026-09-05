# QA Report - Phase 1 Admin SPA (BL-004, Angular admin SPA / browser e2e)

Date: 2026-08-19
Scope: apps/web Angular workspace (admin, conversation, shared projects) only - browser/e2e + static QC. Backend/API covered by a parallel nexus-qa pass (qa-results/phase1-backend/REPORT.md), consulted here only to confirm environment constraints line up.

## Environment

- apps/web on Angular 20 (Vite-based dev server), Jest 30, ESLint.
- Backend (apps/api) could not be brought up: Docker daemon is unreachable in this sandbox (docker info / docker ps hang indefinitely and never return), and the locally-listening port 5432 belongs to a different, non-project Postgres instance - same finding independently confirmed by the parallel backend QA pass. No live API was available for true end-to-end integration testing.
- Consequence for this pass: golden-path scenarios that require real backend data (does the browser actually receive and render data written by a live API) are not verified end-to-end - this is an environment limitation, not a scope decision, and it is symmetric with the backend QA pass own caveat.
- What was run against the real toolchain: full Jest unit/component suite, ESLint, and a real Chromium browser (Playwright, ad hoc - no e2e harness exists yet, consistent with the dev agent logged Phase-3 deferral) driving the actual compiled Angular app served by ng serve admin, with the HTTP layer at the network boundary stubbed to spec-shaped responses only where the real backend was unreachable (disclosed per-scenario below; scenarios that do not require a JSON response - guard redirects, client validation, disabled-state gating, invite-token handling, keyboard nav, coming-soon routes, sign-out clearing local session - were driven against the real running app with no stubbing).
- Screenshots: qa-results/phase1-admin-spa/20260819/*.png (19 captures). Console-error capture: qa-results/phase1-admin-spa/20260819/console-errors.log.

### Environment defect found before testing could even start

**D-0 - High - `ng serve admin` (the exact command in package.json "start" script) renders a permanently blank white page; the documented local-dev workflow is broken.**
projects/admin/src/index.html hardcodes `<base href="/admin/">`. Angular dev server does not automatically serve the compiled bundle at that base path - running `ng serve admin` (or `pnpm start`) and opening `http://localhost:4200/admin/...` (the only base href the app declares) 404s on polyfills.js, main.js, and styles.css, and logs "Refused to apply style ... MIME type (text/html)". Nothing renders; the app never bootstraps. Verified reproducible with a bare Playwright script (network trace attached): all three core bundle requests return 404.
Workaround found and used for the rest of this pass: `ng serve admin --serve-path=/admin/` fixes it.
Impact: nobody - dev, QA, or a reviewer - can run the SPA locally with the command the project itself documents as the way to start it. This should have been caught by the dev agent own manual verification before hand-off; either it was not done, or --serve-path was used ad hoc and not captured in package.json/README.
Repro: `cd apps/web && pnpm start`, open `http://localhost:4200/admin/login` -> blank page, console 404s on polyfills.js/main.js/styles.css.
Fix suggestion (not applied - QA does not fix): add `"start": "ng serve admin --serve-path=/admin/"` (or equivalent serveConfigurations in angular.json) plus a one-line README.
**Originating phase: BL-004 (Angular workspace scaffolding).**

## What actually ran

| Check | Result |
|---|---|
| npx jest --coverage | 161/161 tests passed, 26 suites; ~99% statements/lines, 95% branches across admin/shared/conversation |
| npx eslint "projects/**/*.ts" | 0 errors, 0 warnings |
| Playwright browser pass (19 scenarios, Chromium) | See traceability matrix below |
| @axe-core/playwright automated a11y | Not run - confirmed deferred to Phase 3 per the dev agent logged deviation. Manual keyboard/contrast/semantic pass substituted (see "Accessibility" notes below). |

## Traceability matrix

| Requirement / guideline | Scenario(s) tested | Method | Result | Evidence |
|---|---|---|---|---|
| FR-AUTH-1/UX 2 - Login golden path, field errors, network error | Empty submit (button correctly disabled, not a submit-then-error case), invalid-email client validation, unknown-credentials path (real network error since no backend, so this exercises the exact transport-error code path a real 401 handler would also need) | Real browser, real dev server, no stub | Pass, with one defect (D-1, autofocus) | 20260819/02,03,04,05-*.png |
| FR-AUTH-1/UX 2.2 - Email focused on first paint | Loaded /admin/login, checked document.activeElement after render settles | Real browser | Fail - D-1 | 20260819/02-s2-login-default.png; document.activeElement = BODY, not the email input |
| FR-AUTH-1 - Guarded route redirects unauthenticated user with returnUrl | GET /admin/deployments while signed out | Real browser | Pass | 20260819/01-s1-guard-redirect-to-login.png; landed on /admin/login?returnUrl=%2Fdeployments |
| UX 2.4 - Keyboard operability, tab order (email -> password -> show/hide toggle) | Tab-traced 5 stops from page load | Real browser | Pass | Trace: BODY -> INPUT[email] -> INPUT[password] -> BUTTON[Show password] -> BODY (submit correctly excluded from tab order while disabled) |
| FR-AUTH-3/UX 3 - Invite-accept, missing token -> invalid-invite empty-state, focus management | /admin/invite (no token) | Real browser | Pass | 20260819/06-s7-invite-missing-token.png; heading received focus (la-empty-state__title), exact spec sentence rendered |
| FR-AUTH-3/UX 3.2 - Invite-accept, password rule + mismatch client validation | < 8 chars password, then confirm-mismatch | Real browser | Pass | 20260819/07,08-*.png |
| UX 1.5/4 - Session bootstrap on reload, authenticated shell chrome, role chip, sidebar IA, coming-soon nav items | Mocked login/refresh/me/tenants (real API unavailable), full reload cycles | Stubbed network (disclosed) | Pass | 20260819/09-s10-deployments-populated-shell.png |
| FR-TENANT-2/UX 5 - Deployments list: populated table, status chips, providers em-dash, pagination controls, search+filter -> empty-state, clear filters | Search for a non-matching string -> "No matching deployments" + Clear filters -> repopulates | Stubbed network (disclosed) | Pass | 20260819/11,12-*.png |
| FR-TENANT-4/UX 5.1 - Activate confirmation dialog copy and buttons | Opened row actions -> Activate | Stubbed network (disclosed) | Pass - dialog title/body/buttons match spec verbatim | 20260819/13,14-*.png |
| FR-CONFIG-5 - Unknown tenant id on builder route -> redirect + snackbar | Navigated to /admin/tenants/t404/builder with a mocked 404 TENANT_NOT_FOUND | Stubbed network (disclosed) | Pass | 20260819/15-s16-builder-unknown-tenant-redirect.png; landed on /admin/deployments, snackbar "Tenant not found." |
| UX 1.5/4.2/7 - Coming-soon reserved routes (Dashboard etc.) | /admin/dashboard | Real browser (client-side route, no network needed) | Pass | 20260819/16-s17-coming-soon-dashboard.png |
| UX 1.5 - Sign out clears session, navigates to login, blocks re-entry | Opened user menu -> Sign out | Stubbed logout (disclosed) | Pass | 20260819/17,18-*.png; landed back on /admin/login |
| UX 1.4/1.5/4.6/5.6 - Responsive breakpoints (persistent sidenav >=1280px, temporary/hamburger drawer <1280px, stacked cards on phone tables) | Resized viewport to 375x800 while authenticated | Real browser (CSS/layout, no network dependency) | Fail - D-2, D-3 | 20260819/10-s11-shell-phone-width.png |
| NFR-4/UX 1.2 - Contrast, focus rings, semantic landmarks, skip link, aria-current, aria-labels on icon buttons, form labels/mat-error wiring, role=alert banners | Manual pass over rendered DOM + screenshots across all scenarios above | Real browser | Pass, with caveats (D-1 focus; D-4 icon font) | all screenshots |
| FR-TENANT-1 - Create-tenant dialog: slug auto-suggest, fresh idempotency key per submit, validation regex | Static code review (create-tenant-dialog.component.ts, slug.util.ts, deployments.service.ts) - not driven live in-browser this pass (no backend to accept the POST meaningfully beyond an already-stubbed 200, which would not add signal beyond the code review) | Static review | Pass | projects/admin/src/app/features/deployments/components/create-tenant-dialog/*, services/deployments.service.ts |
| LLD 3.2 - workspace/project structure (admin/conversation/shared, core/features/shared-ui split) | Directory comparison against LLD 3.2 | Static review | Pass (Phase-1-scoped subset present; admin/shared/ reusable-component folder and unbuilt Phase-2+ features correctly absent, not a defect) | apps/web/projects/** |
| Conversation SPA - unauthenticated placeholder only, no admin chrome | Code review of projects/conversation/src/app | Static review | Pass | projects/conversation/src/app/app.component.ts |

## Defects (ordered by severity)

**D-0 - High - see Environment section above.** Documented local-dev command produces a blank page (base-href/dev-server serve-path mismatch). Originating phase: BL-004.

**D-1 - Medium - Login email field is not focused on first paint (UX_GUIDELINES 2.2 "Default: Email focused on first paint").**
Verified: document.activeElement is BODY immediately after /admin/login renders (500ms settle). login-page.component.ts/.html contain no autofocus, cdkFocusInitial, or ElementRef.focus() call. Low functional impact (mouse/tab users are unaffected - the field is still the first tab stop) but it is an explicit, named requirement and currently absent.
Repro: open /admin/login, inspect document.activeElement.
Evidence: 20260819/02-s2-login-default.png.
Originating phase: BL-004 (login page component).
Severity: Rough edge - does not block the flow, but is a named, testable requirement that is unmet.

**D-2 - Medium - Admin shell has no responsive behavior at all: sidenav is hardcoded mode="side"/persistent at every viewport width, no hamburger toggle exists anywhere in the codebase.**
UX_GUIDELINES 1.4/4.6 require a temporary/overlay drawer with a hamburger (aria-label="Open navigation") below 1280px, and a persistent 256px sidenav only at >=1280px. shell.component.html/.scss contain no breakpoint logic, no BreakpointObserver usage, and no hamburger button. Verified live: at 375x800 the fixed 256px sidenav remains open and un-collapsible, squeezing all page content (page-header, search box, table) into ~120px of remaining width, with table cell text visibly overlapping/illegible ("Ch A", "openai/deep", "pa Pau" running together - see screenshot).
Repro: resize an authenticated session to 375px wide.
Evidence: 20260819/10-s11-shell-phone-width.png; grep confirms no mode="over", hamburger, BreakpointObserver, or "Open navigation" anywhere in core/layout.
Originating phase: BL-004 (shell component).
Severity: Rough edge on tablet, but a real usability blocker at phone width - the phone breakpoint is not a nice-to-have per the guidelines ("this product ... is not a fixed-form-factor appliance - the layouts above are required").

**D-3 - Low - Deployments table phone-width stacked-card CSS references a data-label attribute that is never set in the template, so field labels ("Name", "Slug", "Status" ...) would be blank on the one path that is implemented.**
deployments-list-page.component.scss has a @media (max-width: 767px) block using td[mat-cell]::before { content: attr(data-label); }, but no [attr.data-label] is set on any <td> in deployments-list-page.component.html. This CSS cannot be exercised in isolation because D-2 (shell has no way to reach a legible 375px layout) masks it, but it is independently verifiable by reading the two files together - the labels would render as empty strings even if the shell were fixed.
Evidence: deployments-list-page.component.html (no data-label attrs) vs. deployments-list-page.component.scss lines 57-61.
Originating phase: BL-004.
Severity: Low-likelihood-compounding - currently unreachable/unverifiable live due to D-2, but is itself a second bug in the same responsive feature.

**D-4 - Low - Icon font (Material Symbols Outlined) is loaded only from Google Fonts CDN with no self-hosted fallback; when the CDN is unreachable, every "icon + text" status chip, action button, and toggle renders as a truncated text ligature instead of an icon (e.g., "Active" chip icon renders as literal text "ch", the account-menu chevron as "ar", password-visibility icon as "vis").**
This was observed throughout this sandbox pass (no general internet egress) and is disclosed here primarily as a portability/resilience note rather than a confirmed production defect - production environments with normal internet egress would not see this. However, UX_GUIDELINES 1.2 requires "status is never color alone: every chip ... is icon + text," and the current implementation icon delivery has no offline/self-hosted fallback, so any egress-restricted deployment (a plausible one for an enterprise on-prem admin console) would silently degrade this a11y guarantee to unreadable text fragments with no icon and no error.
Evidence: 20260819/09-s10-deployments-populated-shell.png, 20260819/14-s15-activate-confirm-dialog.png.
Originating phase: BL-004.
Severity: Low-likelihood edge case (environment-dependent), but worth a deliberate accept/reject decision rather than silent reliance on external CDN availability.

**D-5 - Low - favicon.ico is referenced in index.html but the file does not exist in the admin project, producing a console 404 on every page load.**
Cosmetic, but is genuine console noise the QA dispatch specifically asked to check for.
Evidence: 20260819/console-errors.log; find apps/web/projects -iname "favicon*" -> no results.
Originating phase: BL-004.
Severity: Low-likelihood edge case / cosmetic.

## Not applicable / out of scope, not flagged

- True golden-path integration (real API round-trip) - environment-limited (Docker unreachable), symmetric with the backend QA pass; not counted as a defect against either phase.
- @axe-core/playwright automated report - confirmed intentional Phase-3 deferral; manual a11y pass substituted above.
- Conversation SPA screens 9-11 - out of Phase 1 per UX_GUIDELINES 6; confirmed the placeholder page is minimal and unauthenticated, nothing more expected.
- Agent Builder functional content - confirmed placeholder-only per FR-CONFIG-5 scope; deep-link reachability tested, functionality correctly absent.

## Overall verdict: PASS-WITH-CAVEATS

The implemented Phase 1 admin SPA is substantively correct: error codes/sentences match the spec verbatim everywhere checked, the role matrix (operator vs. admin) is respected in the templates, idempotency-key minting and confirm-dialog gating are implemented as specified, session bootstrap/guard/interceptor wiring is sound, Jest coverage is excellent, and lint is clean.

This is not a full PASS because:
1. D-0 - the project own documented local-dev command (pnpm start / ng serve admin) does not work out of the box; this should be fixed regardless of how the SPA is deployed in CI/production, because it blocks every future manual verification pass (dev, QA, or human) that does not happen to know the --serve-path workaround.
2. D-2 - the responsive/phone-breakpoint requirement in UX_GUIDELINES 1.4/4.6/5.6, which is written as required ("not a fixed-form-factor appliance"), is entirely unimplemented for the shell, and is a live, screenshotted usability failure at 375px, not a theoretical gap.
3. D-1 - a specifically named, testable requirement (autofocus) is unmet.

None of these are auth/tenant-isolation/payment-class blockers, and the core admin functionality (login, invite-accept, deployments list/search/filter/paginate/pause/activate, deep links, sign-out) all behave correctly on desktop. Recommend routing D-0/D-1/D-2/D-3 back to nexus-dev for the next retry; D-4/D-5 are low-priority, can be batched with the next dev pass.
