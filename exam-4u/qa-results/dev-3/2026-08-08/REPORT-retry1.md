# QA Report - Dev-3 (BL-03: Authentication & Registration) - Retry 1 Re-verification

**Date:** 2026-08-08
**Scope:** Re-verification of the fix pass for the 3 defects (2 blocking, 1 non-blocking) reported
in `qa-results/dev-3/2026-08-08/REPORT.md`. This is retry 1 of 3 for Dev-3.
**FR refs:** FR-IAM-1, FR-IAM-2; UX_GUIDELINES Section 2.1/2.2.

## Environment

- Dedicated, freshly provisioned MySQL 8.4 container (`qa-dev3-retry1-mysql`, port 3308),
  independent of the developer's persistent `examland-mysql` and independent of the prior QA
  session's container. Destroyed at the end of this session.
- Built the real production artifacts from source: `npm run build` (contracts + api + web).
- Booted the actual compiled `node apps/api/dist/main.js` process, `NODE_ENV=staging`, no TLS
  terminator in front - the exact repro topology that caught the original Defect 1/2 - serving the
  built Angular SPA via `ServeStaticModule` (copied `apps/web/dist/web/browser/*` into
  `apps/api/public/`, matching the project's documented image layout; removed afterward).
- One real tenant (`qa3a`) provisioned via the actual `TenantProvisioningService` (in-process,
  Nest boot against the dedicated MySQL instance), not a hand-inserted row.
  `PUBLIC_APEX_DOMAIN=localhost` for this session so `qa3a.localhost:3355` resolves to loopback
  without any hosts-file edit (`*.localhost` is RFC 6761 loopback).
- Real browser: Playwright 1.62.1 (same version used in the original QA pass), headless Chromium,
  driving the actual built SPA against the actual running API.
- No production environment touched.

## Verification performed independently

1. Suite reproduction - `npm run typecheck`/`lint` clean across all workspaces; `npm run build`
   clean; `npm run test:cov -w apps/api` -> 41 suites/277 tests, matching nexus-dev's self-report
   exactly; `npm run test:e2e -w apps/api` against the dedicated MySQL instance -> 8 suites/49
   tests, exact match; `apps/web`'s `ng test` (Vitest/jsdom) -> 8 suites/33 tests, exact match (2
   new cases for LoginComponent's query-param handling, as claimed).
2. Built-artifact source check - inspection of the actual built `index.html` confirmed zero
   `onload=`/`media="print"` remnants and a single ordinary `<link rel="stylesheet">` - the
   `inlineCritical: false` fix is genuinely present in the shipped build output, not just the
   source config.
3. HSTS-over-plain-HTTP fix (Defect 1) - both directions, via curl against the real bootstrap:
   - `curl -sD - http://127.0.0.1:3355/api/health` (plain HTTP, no `X-Forwarded-Proto`) -> no
     `Strict-Transport-Security` header in the response.
   - `curl -sD - -H "X-Forwarded-Proto: https" http://127.0.0.1:3355/api/health` (simulating the
     edge LB having confirmed TLS) -> `Strict-Transport-Security: max-age=63072000;
     includeSubDomains` is present.
   - Confirms the fix is genuinely conditional (derived from `trust proxy`/`X-Forwarded-Proto`),
     not a blanket disable.
4. Real-browser root-page load - Playwright navigated to `http://qa3a.localhost:3355/` (plain
   HTTP, no TLS in front): HTTP 200, non-empty `<app-root>` content, zero `requestfailed` network
   events (no ERR_SSL_PROTOCOL_ERROR, no HSTS-forced-upgrade blanking).
5. CSP/Material-theming fix (Defect 2) - inspected
   `document.querySelector('link[rel=stylesheet]').media` in the live browser: empty string (not
   "print"), i.e. the deferred-CSS pattern that triggered the CSP violation no longer exists.
   Computed `background-color` of the Register submit button: `rgb(63, 81, 181)` (real Material
   primary fill), and again `rgb(63, 81, 181)` on the Login button - both confirmed via
   `getComputedStyle`, not just a visual screenshot. Screenshots at
   `qa-results/dev-3/2026-08-08/retry1-screenshots/03-register-filled.png` and
   `.../04-post-register-redirect.png` visually corroborate.
6. CSP regression spot-check - captured all browser console errors and specifically filtered for
   CSP-violation text across every page visited (root, register, login twice, dashboard). Zero CSP
   violations. The one console error captured (`Failed to load resource: 401`) is the expected
   network response from the deliberate wrong-password test, not a CSP issue.
7. Login query-param fix (Defect 3) - registered a new user (`qauser-<ts>@example.test`) through
   the real UI; confirmed redirect to `/login?email=<email>&registered=1`; confirmed the email
   field was genuinely pre-filled (`inputValue()` check) and the exact banner text "Account created
   - log in to continue." rendered (screenshot `04-post-register-redirect.png`).
8. Full end-to-end flow - completed login with the correct password after first proving the
   enumeration-safe INVALID_CREDENTIALS banner on a deliberate wrong-password attempt (identical
   treatment on both fields, screenshot `05-login-invalid-credentials.png`); reached `/dashboard`,
   which rendered "Welcome, QA!" and the registered user's real email - proving the `GET /auth/me`
   authenticated round trip still works end-to-end (screenshot `06-dashboard.png`).

## Traceability matrix

| Item | Scenario | Result | Evidence |
|---|---|---|---|
| Defect 1 fix - HSTS never sent over plain HTTP | curl `/api/health`, no forwarded-proto header | PASS | header absent |
| Defect 1 fix - HSTS sent when edge confirms HTTPS | curl `/api/health` with `X-Forwarded-Proto: https` | PASS | header present, correct value |
| Defect 1 fix - real browser, plain HTTP, no TLS | Playwright root-page load | PASS | HTTP 200, non-empty app-root, 0 failed requests |
| Defect 2 fix - deferred stylesheet no longer breaks | `link.media` inspection | PASS | empty (not "print") |
| Defect 2 fix - Material primary fill renders | computed background-color of Register + Login buttons | PASS | rgb(63, 81, 181) both |
| Defect 2 fix - no new CSP violations elsewhere | console-error scan across all visited pages | PASS | 0 CSP violations |
| Defect 3 fix - email prefill + banner | register -> redirect -> login state | PASS | screenshot 04; exact banner text confirmed |
| Full backend suite reproduction | unit + e2e vs dedicated MySQL | PASS | 41/277 unit, 8/49 e2e - exact match |
| Full frontend suite reproduction | `ng test` | PASS | 8/33 - exact match |
| Typecheck/lint/build | all workspaces | PASS | clean |
| End-to-end register->login->dashboard | full browser flow | PASS | screenshot 06, email visible |

## Defects

None. All three defects from the original report (2 blocking, 1 non-blocking) are independently
confirmed fixed, using the same real-browser/real-bootstrap methodology that originally caught
them (not merely re-running nexus-dev's own test suite or trusting its self-report).

## Verdict

**Dev-3: READY - no blocking defects.** Both previously-blocking defects (HSTS-over-plain-HTTP;
CSP blocking Angular's deferred-CSS load) and the one non-blocking defect (LoginComponent ignoring
its own redirect query params) are confirmed fixed via independent re-verification against a real
production bootstrap (`node dist/main.js`, `NODE_ENV=staging`, no TLS in front) and a real headless
Chromium browser - the same conditions that originally surfaced these defects. All previously
passing backend-level exit-gate items (enumeration safety, tid-replay barrier, password policy,
per-tenant uniqueness, bcrypt storage, RBAC non-enforcement) were not re-scoped for this retry pass
since they were unaffected by the fix (confirmed unchanged: 41/277 unit, 8/49 e2e).

This was **retry 1 of 3** for Dev-3.

`qa_retry_count` reset to 0; `current_phase` remains `development`. Orchestrator should dispatch
`nexus-dev` for Dev-4 (BL-04: RBAC engine) next.
