# QA Report — Dev-3 (BL-03: Authentication & Registration)

**Date:** 2026-08-08
**Scope:** Dev-3 only (BL-03). Dev-0a/Dev-0b/Dev-1/Dev-2 already QA-green and out of scope.
**FR refs:** FR-IAM-1 (Authentication), FR-IAM-2 (Registration); HLD §5.1 (tenant-realm JWT design).

## Environment

- Dedicated, freshly provisioned MySQL 8.4.11 container (`qa-dev3-mysql`, port 3307),
  independent of the developer's persistent `examland-mysql` container. Destroyed, with all
  seeded schemas, at the end of this session.
- Backend booted three ways: (1) `npm run test:cov`/`test:e2e` in-process (Jest,
  `Test.createTestingModule`), (2) a bare `node apps/api/dist/main.js` production-style
  process (`NODE_ENV=staging`, since FR-MT-2 only does subdomain routing in
  production/staging — confirmed by first hitting `TENANT_NOT_FOUND` under `NODE_ENV=development`
  before correcting this), used for all curl/manual verification, (3) a real Chromium browser
  (Playwright 1.62.1, headless) driven against that same `node dist/main.js` process serving
  the built Angular SPA via `ServeStaticModule`, for the browser e2e smoke test.
- Two real tenants provisioned via the actual `TenantProvisioningService` (not hand-inserted
  rows): `qa3-tenant-a` / `qa3-tenant-b`.
- `PUBLIC_APEX_DOMAIN` was overridden from `examland.app` to `examland-qa.test` for the browser
  pass only, because `.app` is on Chrome's HSTS-preload list and forces HTTPS-only navigation
  regardless of server response headers, which would have made a plain-HTTP local browser test
  impossible independent of any app defect. All API/curl testing used the real
  `*.examland.app` hostnames.
- No production environment was touched.

## Verification performed independently (not just re-running nexus-dev's suite)

1. **Full local reproduction of the self-reported numbers**, against the dedicated MySQL
   instance: `npm run typecheck`/`lint`/`build` clean across all 4 workspaces;
   `npm run test:cov -w apps/api` -> 41 suites/277 tests, matching self-report exactly;
   `npm run test:e2e -w apps/api` -> 8 suites/49 tests, matching self-report exactly;
   `npx ng test` (apps/web) -> 8 suites/31 tests, matching self-report exactly.
2. **Enumeration safety (exit gate)** — hit `/api/auth/login` directly via curl with (a) an
   unknown email, (b) a real email + wrong password, (c) a real, invited-but-password-less
   account. All three returned byte-identical 401 bodies (`INVALID_CREDENTIALS`, aside from
   `requestId`/`timestamp`). Measured 15 rounds of unknown-vs-wrong-password timing at
   `BCRYPT_COST=10` (a realistic cost, not the test suite's cost-4): median 58.25ms vs 57.52ms,
   ratio 1.013 — no statistically meaningful difference. Confirms the dummy-hash path genuinely
   pays the real bcrypt cost, not just in the unit test's construction.
3. **`tid`-vs-tenant replay** — registered+logged in for real against tenant A via curl, took the
   resulting signed JWT, and presented it against tenant B's subdomain. Rejected with 401
   `UNAUTHENTICATED` ("This token is not valid for the current tenant."); the same token
   succeeded (200) against tenant A. Read `JwtAuthGuard` directly — the `tid`-vs-resolved-tenant
   check is unconditional and fails closed on every branch (missing header, invalid token, tid
   mismatch); no path returns `true` without it.
4. **Password policy, bypassing any client-side check** — sent raw curl POSTs (no browser, no
   client JS) with a too-short password, a no-uppercase password, and a no-digit password.
   All three rejected server-side with 400 `WEAK_PASSWORD` naming the specific unmet rule.
   Cannot be bypassed since the client was never involved in these requests.
5. **Per-tenant email uniqueness** — registered `alice@example.test` in tenant A (201), the
   identical email in tenant B (201, succeeds), then the identical email in tenant A again
   (409 `EMAIL_ALREADY_REGISTERED`). Matches FR-IAM-2/FR-MT-8 exactly.
6. **Bcrypt verification via direct SQL** — after a real registration, queried
   `t_qa3_tenant_a_*.user.password_hash` directly (not through the app) and confirmed a genuine
   bcrypt hash: `$2b$10$xzg9f3xueU1gXiodf5I0BuPG/xeGr46i9tvi2WboSLp/j3Ogf.isK` — `$2b$` prefix,
   cost `10` matching the configured `BCRYPT_COST`, 60-char format. Not plaintext, not a weak
   hash.
7. **RBAC not prematurely enforced** — grepped `modules/auth/**` for any
   `PermissionsGuard`/`@Roles`/RBAC-guard usage: none found. Read `JwtAuthGuard` directly:
   it authenticates only, deliberately does not attach permissions, with an explicit code
   comment stating this is `PermissionsGuard`'s (Dev-4's) job. Confirmed self-registered users
   get zero roles (`alice@example.test` has no `user_role` rows) while the provisioning-seeded
   admin correctly holds "Tenant Admin" — matches FR-IAM-2's "no roles by default unless a
   default self-register role is configured."
8. **Browser e2e smoke test (Playwright/Chromium, real DOM+CSS+JS execution)** — drove the
   actual built SPA against the actual running API: landing -> register (client + server
   validation, `WEAK_PASSWORD` per-field, `EMAIL_ALREADY_REGISTERED` per-field with a working
   "Log in instead" link) -> login (`INVALID_CREDENTIALS` banner with identical treatment on
   both fields, matching the mandated non-leaking copy) -> authenticated dashboard
   (`GET /auth/me` round trip rendering the real user's name/email). Screenshots in
   `qa-results/dev-3/2026-08-08/screenshots/`. This is the first real-browser pass in the
   project (prior UI verification was Vitest/jsdom only) and it surfaced two real,
   browser-only-visible defects (below) that no API-level or jsdom test could have caught.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-IAM-1 — auth, generic `INVALID_CREDENTIALS` | unknown email, wrong password, no-password account; byte-identical bodies; timing | PASS | curl transcripts above; timing check (ratio 1.013) |
| FR-IAM-1 — bcrypt storage | direct SQL read of `password_hash` post-registration | PASS | `$2b$10$...` hash confirmed |
| FR-IAM-1 — token expiry / bearer usage | `GET /auth/me` with/without token | PASS | 200 with valid token, 401 `UNAUTHENTICATED` with none |
| HLD §5.1 — `tid`-vs-tenant replay | token minted for tenant A presented to tenant B | PASS | 401 `UNAUTHENTICATED`, distinct message in guard code |
| FR-IAM-2 — per-tenant email uniqueness | same email registered in two tenants (success) and twice in one tenant (409) | PASS | curl transcripts above |
| FR-IAM-2 — `WEAK_PASSWORD`, server-side, unbypassable | too-short / no-uppercase / no-digit via raw curl | PASS | 400 `WEAK_PASSWORD` naming the unmet rule each time |
| FR-IAM-2 — no roles by default | `alice@example.test`'s `user_role` rows | PASS | 0 rows via direct SQL |
| RBAC not prematurely enforced | grep + guard source read | PASS | no `PermissionsGuard`/`@Roles` usage in `modules/auth/**` |
| Backend test suite reproduction | unit + e2e vs dedicated MySQL 8.4 | PASS | 41/277 unit, 8/49 e2e — exact match to self-report |
| Frontend test suite reproduction | `ng test` (Vitest/jsdom) | PASS | 8/31 — exact match to self-report |
| UX_GUIDELINES §2.1 Login states/copy | browser: default, validation, `INVALID_CREDENTIALS` banner, success->dashboard | PASS | screenshots 08-10 |
| UX_GUIDELINES §2.2 Registration states/copy | browser: validation, `WEAK_PASSWORD` per-field, `EMAIL_ALREADY_REGISTERED` per-field+link | PASS | screenshots 02-05, 07 |
| UX_GUIDELINES §2.2 step 3 — post-registration redirect UX (pre-filled email + confirmation banner) | browser: register success -> `/login?email=...&registered=1` | FAIL | screenshot 06; see Defect 3 |
| UX_GUIDELINES §1c — primary button = filled/raised Material button | browser: computed style of submit buttons | FAIL | see Defect 2 |
| Real-browser app bootstrap over plain HTTP | browser: navigate to `/` | FAIL (environment-dependent) | see Defect 1 |
| Typecheck/lint/build | all 4 workspaces | PASS | clean, matches self-report |

## Defects

### Defect 1 — BLOCKING: `Strict-Transport-Security` sent unconditionally over plain HTTP blanks the entire app in a real browser

**Expected:** The login/register flow is usable in a real browser (this phase's explicit exit
criterion; UX_GUIDELINES' full state matrix is meant to be genuinely renderable).

**Actual:** `apps/api/src/main.ts` calls `app.use(helmet())` with Helmet's defaults, which
include an HSTS (`Strict-Transport-Security`) header on every response, sent regardless of
whether the current connection is HTTP or HTTPS and regardless of `NODE_ENV`. The very first
navigation to `/` (over plain HTTP) causes Chromium to record HSTS for that origin+port; every
subsequent same-origin request in that same page load (the JS/CSS bundles) is then
force-upgraded by the browser to `https://`, which the dev/staging server does not serve —
all bundle requests fail with `ERR_SSL_PROTOCOL_ERROR` and the page renders completely blank
(confirmed via `page.$eval('app-root', el => el.innerHTML)` returning empty, and
`requestfailed` events for every JS/CSS asset). Worse, HSTS is browser-cached for the
`max-age` duration (1 year by Helmet's default) once triggered, so the *same browser* remains
broken against that host:port for a full year even after the defect is fixed server-side,
unless the developer manually clears HSTS state.

**Why this matters now / severity:** Production (behind the confirmed wildcard-TLS load
balancer per HLD §14 item 4) is unaffected, since the browser only ever talks to the LB over
HTTPS there. But this breaks: any local developer running `node dist/main.js` or the literal
Docker image directly without a TLS-terminating proxy in front (a completely standard way to
smoke-test a "one image/one process/one port" deployment, which is this project's own stated
architecture), any CI/QA browser-based e2e run against a plain-HTTP instance, and any on-prem/
trial deployment without a fronting LB. This is exactly the class of defect a real-browser QA
pass exists to catch and that the project's existing curl-based e2e/API tests structurally
cannot see. Rated **blocking** because it defeats the browser-facing exit criterion under a
completely ordinary, undocumented-as-unsupported deployment/testing topology, and because of
the year-long HSTS-poisoning side effect on any browser that hits it once.

**Repro:** `NODE_ENV=staging node apps/api/dist/main.js` (no TLS in front) -> open a real
browser (on a hostname not on Chrome's HSTS-preload list, e.g. not `*.app`, to avoid a
compounding, unrelated effect specific to `.app` domains) -> navigate to
`http://<host>:<port>/` -> observe blank page; DevTools Network tab shows all JS/CSS requests
upgraded to `https://` and failing with `ERR_SSL_PROTOCOL_ERROR`.

**Suggested area to fix (not prescribing the fix):** gate Helmet's `strictTransportSecurity`
option off when the request isn't confirmed to be behind TLS termination (e.g. env-flag it, or
only enable it in `NODE_ENV=production` once TLS-termination is a documented hard requirement
in front of it).

### Defect 2 — BLOCKING: CSP's default `script-src-attr 'none'` silently breaks the Angular build's deferred-CSS loading, so most Material component styling never loads, in every environment including production

**Expected:** UX_GUIDELINES §1c: "primary action = filled/raised button... Material Design
conventions... apply throughout." The Login/Register screens should render with real Material
theming per the spec's state guidance.

**Actual:** The Angular production build's `index.html` inlines only *critical* CSS and defers
the rest via `<link rel="stylesheet" href="styles-*.css" media="print" onload="this.media='all'">`
— a standard Angular CLI (Beasties/Critters) optimization that requires executing an inline
`onload` event-handler attribute to "promote" the stylesheet from `media="print"` (inert) to
`media="all"` (active). Helmet's default CSP includes `script-src-attr 'none'`, which blocks
all inline event-handler attributes. Confirmed directly: after full page load,
`document.querySelector('link[rel=stylesheet]').media` is still `"print"` (never flipped), and
a submit button — which does carry the correct Material classes
(`mdc-button mat-mdc-button-base mdc-button--unelevated mat-mdc-unelevated-button mat-primary`)
— computes to a plain white background (`rgb(255,255,255)`) with no box-shadow, i.e. it never
receives Material's actual primary-color fill. This is unrelated to Defect 1 and affects every
environment, including a correctly-TLS-fronted production deployment, since it's a same-origin
CSS load blocked by CSP, not a network/HSTS issue.

**Severity:** Blocking. This is a production-affecting, guideline-violating rendering defect on
the very first UI-facing phase — not a local-testing footgun like Defect 1. It directly
contradicts UX_GUIDELINES §1c's explicit requirement and plausibly affects WCAG 2.2 AA
conformance too (color-contrast-dependent Material tokens for error/success states live in the
same deferred stylesheet).

**Repro:** load `/register` in a real browser with default Helmet CSP active -> inspect
`document.querySelector('link[rel=stylesheet]').media` (stays `"print"`) -> inspect the
"Create account" button's computed `background-color` (plain white, not the primary-color fill
a `mat-mdc-unelevated-button.mat-primary` should have).

**Suggested area to fix (not prescribing the fix):** either disable the Angular build's
critical-CSS-inlining/deferred-load optimization (simplest, small perf cost) so all CSS loads
via a normal `<link>` with no `onload`, or adjust Helmet's CSP to permit this specific pattern
— the former is the lower-risk direction (a nonce/hash for inline event handlers reintroduces
broader XSS-adjacent risk than it's worth for a perf optimization).

### Defect 3 — Non-blocking: post-registration redirect ignores the `email`/`registered` query params it sends itself

**Expected:** UX_GUIDELINES §2.2 step 3, and nexus-dev's own documented judgment call: since
`/auth/register` returns `{ user }` only (no token), the UI redirects to `/login` "with a
pre-filled email and a confirmation banner ('Account created — log in to continue')."

**Actual:** `RegisterComponent.onSubmit()`'s success handler does
`router.navigate(['/login'], { queryParams: { email, registered: '1' } })` — so the intent is
clearly implemented on the sending side. But `LoginComponent` never reads either query param:
it only reads `returnUrl` from `ActivatedRoute.snapshot.queryParamMap`. The result, confirmed
in the browser: after a successful registration, the user lands on a completely blank `/login`
form (empty email field, no banner of any kind) with `?email=...&registered=1` sitting unused
in the URL. This is exactly the "bare success screen with no next-action confirmation"
UX_GUIDELINES explicitly says to avoid, and re-requires the user to retype an email they just
entered seconds earlier.

**Severity:** Non-blocking (rough edge, not a security/correctness issue — registration and
login both still work correctly end-to-end; a user only loses convenience, not access). Flagged
because it's a concrete, verified gap against an explicit UX_GUIDELINES requirement nexus-dev's
own completion notes claim to have implemented.

**Repro:** register a new user in the browser -> observe successful redirect to
`/login?email=<email>&registered=1` -> observe the email field is empty and no confirmation
banner is rendered.

## Non-blocking items carried over (not new, per orchestrator's instruction)

- No rate limiting on `/auth/login`/`/auth/register` — already flagged by nexus-dev as an
  accepted, tracked-for-later gap; not re-flagged as new here.

## Verdict

**Dev-3: NOT READY — 2 blocking defects** (Defect 1: HSTS-over-HTTP blanks the app in any
non-TLS-terminated real-browser context; Defect 2: CSP blocks the deferred stylesheet load,
so Material theming never actually renders in any environment). Backend business logic
(enumeration safety, `tid`-replay barrier, password policy, per-tenant uniqueness, bcrypt
storage, RBAC non-enforcement) is excellent and independently re-verified as correct — every
backend-level exit-gate item passes. Both blocking defects are in the cross-cutting Nest
bootstrap (`helmet()` configuration, originally added in Dev-0a before any UI existed) and only
became *visible, user-facing* failures once this phase shipped the first real UI and this pass
drove it with a real browser — exactly the gap a first browser-facing QA pass exists to close.
Defect 3 (non-blocking) is a genuine Dev-3 UI logic gap, independent of the helmet issue.

`current_phase` left unchanged; `qa_retry_count` left for the orchestrator to manage the retry
loop. Recommend the retry target Helmet's HSTS/CSP configuration (likely best owned as a
follow-up to Dev-0a's `main.ts`, since Dev-3 code itself did not introduce it) plus
`LoginComponent`'s query-param handling (Dev-3's own gap).
