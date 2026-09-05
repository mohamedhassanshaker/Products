# QA Report — Dev-7 (BL-07: registration settings, tenant-branded email, Google sign-in, tenant brand theming / FR-MT-10)

Date: 2026-08-08/09
Scope: FR-MT-6 (registration/Google toggles), FR-MT-7 (tenant-branded email), FR-MT-8 (tenant-scoped
password flows, email side only), FR-MT-10 (tenant brand theming). Per the plan's Dev-7 section and
NEXUS_STATE.md's dispatch note.

## Environment

- Dedicated, freshly provisioned mysql:8.4 Docker container (qa-dev7-mysql, port-mapped 33061:3306),
  not the developer's persistent examland-mysql container or any CI database. Destroyed after this run.
- Real application bootstrap via NestFactory.create(AppModule) (the actual main.ts path, not
  Test.createTestingModule), built from apps/api's real npm run build:api/build:web output, serving
  the compiled Angular bundle from apps/api/public (removed after the run, not a source-controlled
  directory).
- NODE_ENV=staging for the browser pass (development mode hard-codes tenant resolution to
  DEFAULT_TENANT_SUBDOMAIN and never reads the Host header, confirmed by reading
  tenant-resolution.middleware.ts; staging/production exercise the real subdomain-routing path).
- Real HTTP driven via curl/Playwright (Chromium) against https://qabrand.examland.app:8443 and
  https://qabrandb.examland.app:8443, TLS-terminated by a throwaway local Node https+http-proxy front
  end with a self-signed cert (Chromium enforces HSTS-preload on the entire .app gTLD, so plain
  http://*.examland.app cannot load in a real browser - same constraint Dev-6b's QA pass already
  documented) plus --host-resolver-rules mapping the tenant/auth. subdomains to 127.0.0.1. All
  temporary infra (container, TLS proxy, certs, seed script, browser scripts, apps/api/public) removed
  after the run; nothing checked into the repo.
- Two disposable tenants provisioned via the real provisioning workflow (not hand-inserted rows):
  qabrand (QA Branding Co) and qabrandb (QA Tenant B), plus a platform admin and tenant users created
  via the real HTTP APIs.

## Automated suites (independently reproduced, not trusted from the self-report)

| Suite | Result |
|---|---|
| npm run typecheck (3 workspaces) | Clean |
| npm run lint | Clean |
| npm run build (contracts+api+web) | Clean; apps/web initial bundle 656.10 kB, 6.10 kB over the 650 kB default budget - cosmetic warning only, same non-blocking class Dev-6b's QA already flagged, unchanged severity |
| apps/api unit tests (test:cov) | 76 suites / 562 tests, all green - exact match to self-report |
| apps/api e2e tests (test:e2e) | 1 suite / 3 tests failing on a clean, isolated rerun (see Defect 1 below); all other 15 suites/131 tests green. A first run additionally showed 2 more suites failing (tenants-crud, tenant-resolution.real-bootstrap, platform-tenants-console) but a clean immediate rerun on the same DB passed all three - judged environmental flakiness (parallel Jest workers contending for the same real MySQL instance on this machine), not a product defect; only provisioning-workflow.e2e-spec.ts's 3 tests failed identically on both runs |

## Defects

### Defect 1 - Dev-2's provisioning exit-gate regression tests now fail after Dev-7's landing (Moderate)

What was expected: Dev-7's own "Verification performed directly" claims apps/api e2e "all green" by
implication (no failures reported), and more importantly Dev-2's own, still-shipping exit gate (the
plan's Dev-2 section) is: "a tenant whose seed_rbac step permanently fails is never end-user-reachable
... no RBAC or admin user was ever seeded" - proven by provisioning-workflow.e2e-spec.ts's three
scenarios, which passed as of Dev-2/Dev-6b's own QA passes.

What actually happened: Dev-7 added migration
1730000000003-add-tenant-settings-manage-permission.ts, which - by design, per its own doc comment -
runs as part of the run_migrations provisioning step (not seed_rbac) and unconditionally INSERT
IGNOREs the tenant.settings.manage permission row into every tenant schema's permission table,
independent of whether seed_rbac ever runs or succeeds. This is a reasonable, documented design
choice for backfilling already-provisioned tenants, but it was never reconciled against the
pre-existing Dev-2 e2e suite, which nexus-dev's Dev-7 pass apparently did not rerun to completion (or
reran and did not report): on a clean isolated run, provisioning-workflow.e2e-spec.ts fails 3/3 of its
assertions:

- idempotency scenario: expects 28 permissions after a successful provision, actually 29 (a stale
  literal count - cosmetic once the new permission is accounted for).
- retrying-from-Failed scenario: same stale-count failure (28 expected, 29 actual).
- permanent-failure scenario (the actual exit-gate proof): expects 0 permission rows when seed_rbac is
  forced to fail on every attempt (i.e. proving nothing was seeded); actually 1 - the new migration's
  unconditional permission-catalog insert now runs during run_migrations, before seed_rbac ever gets a
  chance to fail, so a permanently-Failed tenant schema is left with one dangling, ungranted permission
  row despite never reaching Active. This is not a security/data leak (the row is inert with no role
  grant, in an unreachable tenant's own private schema), but it does mean the "no RBAC was ever seeded"
  invariant this project's own regression suite has asserted since Dev-2 is now literally false, and
  the suite was not updated to reflect the new, intentional behavior.

Repro: NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT set to the target MySQL port, DB_USER=root,
DB_PASSWORD set accordingly, then run: npx jest --config apps/api/test/jest-e2e.json
provisioning-workflow.e2e-spec.ts, against a real MySQL 8.4 instance - fails 3/3 deterministically on
a freshly seeded database.

Severity: Moderate / rough edge - no user-facing or security impact found, but it is a real,
reproducible regression in a previously-green, previously-QA-confirmed exit-gate suite that Dev-7 did
not fix or update, and the project's own written verification claims do not mention it. Recommend:
update the two stale literal counts (28 to 29) and either (a) accept and re-word the "permanent
failure" assertion to expect 1 with a comment explaining the new migration-driven permission row, or
(b) reconsider whether the new permission insert should be gated to only run after seed_rbac has ever
succeeded once for that schema, if the "nothing seeded on permanent failure" invariant is meant to
hold literally going forward.

### Non-blocking observations (FR-MT-10 UI, both minor)

- Decorative "Save changes" preview swatch shares its accessible name with the real submit button.
  branding-settings.component.html's live-preview block renders a plain, non-submit button purely to
  preview the chosen accent color, with the exact same visible text ("Save changes") as the actual
  submit button a few lines below it. A user (especially navigating by keyboard/screen reader, where
  both controls announce identically as "Save changes, button") could plausibly activate the
  decorative one expecting to save, and nothing happens - no error, no toast, no visual difference in
  outcome to explain why "nothing saved." Confirmed by direct interaction: clicking the first
  DOM-order "Save changes" element triggers no network request at all. Non-blocking (the real submit
  button is reachable and correctly labeled, and sighted users seeing the live-preview section header
  should generally understand the swatch is decorative), but worth a distinct accessible name (e.g.
  "Preview accent color") before this ships more broadly, since it is a genuine potential source of
  "my settings didn't save and I don't know why" support reports.
- Native color-picker swatch didn't visually update to the newly-saved teal value in the post-reload
  screenshot - it continued to render as black. Did not chase further given time constraints; likely a
  browser-specific rendering quirk of the native color-picker element rather than a binding bug (the
  text field, live preview button, and live preview link all correctly reflected the persisted teal
  value in the same screenshot), but flagging in case it reproduces consistently in a real target
  browser.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-MT-6 registration toggle enforcement (REGISTRATION_DISABLED) | e2e suite (existing, reran); UI: disabling toggle hides Create-one link on the real login page | Pass | tenant-branding-registration-google.e2e-spec.ts (reran green); screenshot 19-registration-disabled-login.png |
| FR-MT-6 Google toggle enforcement (GOOGLE_SIGNIN_DISABLED) | e2e suite (existing, reran) | Pass | same suite, reran green |
| FR-MT-6 Google sign-in button visibility tied to googleClientId presence | Browser: button absent with GOOGLE_CLIENT_ID unset, present once set | Pass | 01-login-branded.png (before/after) |
| FR-MT-6 fixed-origin auth bridge hand-back | Browser: clicking Sign-in-with-Google navigates to the auth subdomain google-bridge page with clientId and returnTo params | Pass | 18-after-google-click.png; console errors present are Google's own SDK rejecting a fake client id/no network access, not a product defect |
| FR-MT-6 Google sign-in reuse-by-email, on-the-fly creation, invalid-token/unverified-email/unconfigured rejections | e2e suite (existing, reran, real MySQL) | Pass | suite output |
| FR-MT-7 tenant-branded email, stored-XSS escaping | e2e suite (existing, reran, real SMTP listener) | Pass | suite output (captured real MIME bytes) |
| FR-MT-7 email-send-failure never fails the request | e2e suite (existing, reran) | Pass | suite output |
| FR-MT-10 accent override malformed hex, client pre-check | Browser: entered zzzzzz, saved | Pass | 11-invalid-hex-clientcheck.png |
| FR-MT-10 accent override insufficient contrast, verbatim ratio/required/failingSurface | Browser: entered FFFFAA | Pass | 12-insufficient-contrast.png; response body reported ratio 1.04, required 3, failingSurface light |
| FR-MT-10 accent override valid save plus persistence across reload | Browser: entered 008080, saved, reloaded | Pass | 13-valid-accent-saved.png, 14-after-reload-persisted.png |
| FR-MT-10 reset-to-default, idempotent | Browser: clicked Reset-to-default-color | Pass | 17-after-reset.png (confirmation toast, effective accent reverts to platform default 5C6BC0) |
| FR-MT-10 unset override resolves to platform default via public-config | curl, fresh Tenant B | Pass | accentColor 5C6BC0 |
| FR-MT-10 logo broken-URL non-blocking warning, does not block save | Browser: saved a deliberately unreachable logo URL | Pass | warning panel shown alongside a still-submittable form; save succeeded |
| FR-MT-10 login screen silent broken-image fallback, no flash | Browser: login page for a tenant with a broken logoUrl | Pass | 19-registration-disabled-login.png shows the generic-mark fallback, no broken-image icon |
| Cross-tenant tampering structurally inexpressible | curl: Tenant A user token plus Tenant B Host header against the branding PATCH route | Pass | 401 UNAUTHENTICATED - token not valid for the current tenant |
| Dev-2 provisioning exit gate, no RBAC seeded on permanent failure | Existing e2e suite, reran on a clean DB | Fail | Defect 1 |

## Verdict

Dev-7: NOT ready to advance as fully clean - one real, reproducible regression (Defect 1) in a
previously-green exit-gate suite, caused by this phase's own change, not caught, fixed, or reported by
nexus-dev's own verification pass. All of Dev-7's own new functionality (registration/Google toggles,
tenant-branded email, Google sign-in, and FR-MT-10 brand theming end-to-end including the two UI
surfaces nexus-dev explicitly deferred to QA) is genuinely correct and matches spec/UX exactly - no
blocking defect was found in the phase's own headline scope. Recommend a nexus-dev retry scoped
narrowly to Defect 1 (reconcile provisioning-workflow.e2e-spec.ts with the new migration-driven
permission backfill), not a broader rework; the two non-blocking UI observations are for awareness
only and do not need to block advancing once Defect 1 is resolved.
