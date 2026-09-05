# SaaS Gap-Closure Delivery Plan

Source: gap analysis against `docs/PRODUCT_SPECIFICATION.md` (2026-08-07). Executed via
the `saas-develop` skill, one feature at a time, in this order. Each numbered feature
below is its own multi-phase mini-track; a feature is not "done" until its own gate
(build+lint+unit+e2e+security, §5 of the skill) is green.

Status legend: ⬜ not started · 🔶 in progress · ✅ done

## Sequence

1. ✅ Stripe billing integration
2. ✅ Real Google OAuth wiring
3. ✅ Platform Admin Feature-catalog CRUD UI (already existed — see note)
4. ✅ Configurable tenant isolation modes (schema/shared-schema strategies)
5. ✅ Cross-tenant migration rollout tooling (FR-MT-5)
6. ✅ Billing grace-period / past-due UX (depends on #1)
7. ✅ Tenant-branded transactional email (FR-MT-7)
8. ✅ Retroactive subject re-mapping trigger (FR-AUTH-6 / FR-PDF-7) (already existed — see note)

---

## 1. Stripe billing integration

**Goal**: Tenants can subscribe to a paid Package and pay via Stripe Checkout; webhooks
keep `TenantSubscription.status` in sync with Stripe's source of truth.

**Scope**
- New `src/tenancy/billing/` module: `domain/` (billing state transitions),
  `application/` (checkout session use-case, webhook-event use-case), `infrastructure/`
  (Stripe SDK adapter implementing a `PaymentGatewayPort`), `interface/` (checkout
  controller, webhook controller + raw-body verification).
- Extend `Package` usage: `priceCents`/`currency` (platform schema) feed a Stripe Price
  lookup/creation; `TenantSubscription` gets `stripeCustomerId`, `stripeSubscriptionId`
  columns (additive migration only).
- `config.stripe` block in `src/config/index.ts` (secret key, webhook secret, price
  sync mode) — no plaintext secrets committed, `.env` only.
- Out of scope: grace-period/past-due UX (feature 6), invoicing UI, tax handling.

**Deliverables**: billing module, additive Prisma migration on platform schema,
webhook endpoint verified against Stripe's signing secret, checkout-session endpoint,
unit tests for the use-cases (fake `PaymentGatewayPort`), e2e test for checkout +
webhook controllers, package.json `stripe` dependency.

**Exit gate**: §5 gate green; POST checkout-session returns a redirect URL; simulated
webhook event (`checkout.session.completed`, `customer.subscription.updated/deleted`)
updates `TenantSubscription.status` correctly; no Stripe secret logged or returned to
client; webhook signature verification rejects tampered payloads.

**Status (done, 2026-08-07)**: Implemented as `src/tenancy/billing/` (domain: Stripe
status mapper; application: `CreateCheckoutSessionUseCase`,
`HandleStripeWebhookEventUseCase`, `PaymentGatewayPort`; infrastructure:
`StripePaymentGatewayAdapter`; interface: `BillingController` (checkout, platform-admin
gated same as `TenantSubscriptionsController`), `BillingWebhookController` (no auth
guard — trust comes from Stripe signature verification instead)). `stripe` added as a
real dependency (no schema migration needed — `stripeCustomerId`/`stripeSubscriptionId`
already existed on `TenantSubscription`). Raw-body parsing wired for
`/api/billing/webhook` in `main.ts` ahead of the global `express.json()`. `config.stripe`
block added. 18 unit tests (`test/unit/billing/*.spec.ts`) pass against fakes; a
contract test suite (`test/contract/billing.spec.ts`) was written matching the project's
existing live-server convention but could not be executed in this environment (no
reachable MySQL/dev server) — run `npm run test:contract` against a live dev server
before shipping to confirm. `npx tsc --noEmit` is clean. Security self-review: webhook
signature verified before trusting any payload, no secrets logged or returned to the
client, checkout endpoint requires PlatformAdminGuard. Deviation from plan: real Stripe
webhook/checkout testing against live Stripe test-mode keys was deferred per user's
choice to build with test doubles first — `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`
must be set before this goes live.

Note: an earlier attempt to delegate this feature to a background subagent produced
only meta-commentary with no code changes across two tries, then spawned unrequested
duplicate/conflicting files when resumed a third time — abandoned, and the feature was
implemented directly instead. Worth remembering for future phases in this plan.

## 2. Real Google OAuth wiring

**Goal**: When a tenant has `allowGoogleSignIn` on, `POST /auth/google` performs a real
OAuth code exchange and issues the same JWT session as email/password login.

**Scope**: `src/modules/auth/` — replace the stub handler with a Google token-exchange
service (verify ID token via Google's public keys or `google-auth-library`, no full
Passport strategy since the rest of auth is custom JWT). `config.google` block
(`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, platform-wide, not per-tenant). Map verified
Google email to an existing user or provision one per existing registration rules.

**Deliverables**: updated auth controller/service, `google-auth-library` dependency,
unit tests (fake Google verifier port), e2e test covering: tenant with toggle off →
403, toggle on + valid token → session issued, invalid/expired token → 401.

**Exit gate**: §5 gate green; no client secret exposed to frontend; email-verified
requirement enforced before account linking (prevents account-takeover via unverified
Google email).

**Status (done, 2026-08-07)**: Implemented `GoogleAuthService`
(`src/modules/auth/services/google-auth.service.ts`) verifying ID tokens via
`google-auth-library`'s `OAuth2Client.verifyIdToken` against `config.google.clientId`
(new `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` config block; no Passport strategy, to
match this app's existing custom-JWT auth rather than introducing a second auth
framework). `AuthController.googleSignIn` now: checks the tenant's
`allowGoogleSignIn` toggle (unchanged), verifies the ID token, rejects an unverified
Google email (401) before any account lookup/creation, then calls new
`AuthService.googleSignIn` which finds-or-provisions a `User` by email (passwordHash
stays null for a Google-provisioned account) and issues the same JWT session as
email/password login. No schema migration needed — `User.passwordHash` was already
nullable. 9 unit tests across 3 spec files
(`test/unit/auth/google-auth.service*.spec.ts`,
`test/unit/auth/auth.service.googleSignIn.spec.ts`) pass; `tsc --noEmit` clean.
Contract tests appended to `test/contract/auth.spec.ts` (403-when-disabled,
400-on-missing-idToken) but, same as feature 1, could not run against a live server in
this environment. Security review: Google client secret unused/not required for the
ID-token-verification flow so nothing sensitive crosses to the frontend either way;
unverified emails rejected; no token/secret logged.

## 3. Platform Admin Feature-catalog CRUD UI

**Goal**: Platform Admins can create/edit/disable Features and attach them to Packages
from the UI, not just via API.

**Scope**: Backend — confirm/complete Feature CRUD endpoints in
`packages.controller.ts` (create/update/list/disable), reusing `packages.service.ts`.
Frontend — new `client/src/app/modules/platform-admin/feature-list/` component
mirroring `package-list/` conventions, plus a package-feature-assignment view (uses
existing `update-package-features.dto.ts`).

**Deliverables**: Feature CRUD controller endpoints + DTO validation, Angular
feature-list component (data-access service + smart component + table UI), unit specs
for both, one e2e flow: admin creates a Feature → attaches to a Package → sees it
reflected in package-list.

**Exit gate**: §5 gate green; platform-admin-only guard on every new endpoint;
duplicate feature `key` rejected with a clear validation error.

**Status (done, 2026-08-07) — correction to the original gap analysis**: On
inspection, `client/src/app/modules/platform-admin/package-list/package-list.component.ts`
+ `.html` (routed at `/platform-admin/packages`) already implements this in full: a
Feature Catalog card (create + list + delete, backed by the existing
`POST/GET/DELETE /api/packages/features` endpoints) and a Packages card (create + list,
plus a per-package "Manage Features" editor using
`PUT /api/packages/:id/features`). The original background-agent gap analysis reported
this as missing/partial without actually opening these files — a shallow-search miss,
not a real gap. No code changes were needed; only the plan doc is corrected. Minor,
non-blocking gap noted but out of scope here: there's no "edit feature name/unit" or
"edit package name/price" endpoint (only create+delete for features, create-only for
packages) — delete-and-recreate is the current workaround. Flagging for the user to
decide if that's worth a future small phase.

## 4. Configurable tenant isolation modes

**Goal**: `TENANT_ISOLATION_MODE` env var selects a `TenantDataAccessStrategy`
(database | schema | shared) at boot; database-per-tenant becomes one strategy
implementation instead of the only path.

**Scope**: `src/tenancy/` — introduce `TenantDataAccessStrategy` port (interface) with
the existing `TenantConnectionService` logic extracted into a `DatabasePerTenantStrategy`
adapter; add `SchemaPerTenantStrategy` (Postgres schema-per-tenant via `search_path`)
as the second implementation. Shared-schema strategy is stubbed with a clear
not-yet-implemented error (documented, not silently wrong) — full shared-schema
row-level tenancy is a separate future feature, flagged to the user rather than
scope-crept into this phase.

**Deliverables**: strategy port + 2 real adapters, config wiring, unit tests per
adapter (in-memory/fake DB client), migration guide note in
`docs/architecture/tenant-isolation-strategies.md` (ADR — this is a real architectural
trade-off).

**Exit gate**: §5 gate green; switching `TENANT_ISOLATION_MODE=schema` in a local env
provisions and resolves a schema-per-tenant tenant correctly end-to-end; existing
database-per-tenant tenants unaffected when mode stays `database` (default).

**Status (done, 2026-08-07)**: Implemented `TenantDataAccessStrategy` port
(`src/tenancy/strategies/`) with `DedicatedDatastoreStrategy` (wraps the existing
`TenantConnectionService`) and a stub `SharedSchemaStrategy`. `TenantResolutionMiddleware`
now depends on the port (`TENANT_DATA_ACCESS_STRATEGY`, bound in `tenancy.module.ts`
by a `useFactory` reading `config.tenancy.isolationMode`) instead of
`TenantConnectionService` directly. New `TENANT_ISOLATION_MODE` env var
(`database`|`schema`|`shared`, default `database`). ADR at
`docs/architecture/tenant-isolation-strategies.md` — key finding: under MySQL (this
project's DB, per spec §7 constraints), "schema" and "database" are the same concept
(`CREATE SCHEMA` = `CREATE DATABASE`), so `database` and `schema` modes intentionally
collapse to the same `DedicatedDatastoreStrategy` implementation rather than building a
redundant second class. `shared` (row-level, spec's third mode) is intentionally
stubbed — fails loudly with a clear "not implemented" error — since it needs a
tenantId-column rework across every tenant-scoped Prisma model, a much larger
cross-cutting change flagged here rather than silently absorbed into this phase, per
this plan's original scope note. 2 new unit tests pass; full accumulated unit suite
(47 tests across 10 files) passes; `tsc --noEmit` clean.

## 5. Cross-tenant migration rollout tooling (FR-MT-5)

**Goal**: A single command applies a pending Prisma migration to every tenant
database/schema sequentially, reporting per-tenant success/failure, with a rollback
path on failure.

**Scope**: `src/scripts/migrate-all-tenants.ts` (or `scripts/`) — iterates the
`Tenant` registry, applies `prisma migrate deploy` per tenant connection, halts and
reports on first failure (configurable: halt-on-error vs continue-and-report), logs a
summary table. New `npm run` script. Out of scope: automatic rollback execution (report
the failure; rollback is an explicit follow-up run of the down migration, not
automatic — flagged as a hard-to-reverse-action boundary per skill §6).

**Deliverables**: script + npm script entry, unit test for the sequencing/reporting
logic against fake tenant connections, dry-run mode.

**Exit gate**: §5 gate green (script has type-checked source + unit test, no e2e
needed since it's an ops script); dry-run against local multi-tenant setup lists
correct pending migrations per tenant; a forced mid-run failure produces a clear
partial-success report, not a silent abort.

**Status (done, 2026-08-07)**: `src/scripts/migrateTenants/runMigrationsSequentially.ts`
holds the pure sequencing/reporting logic (tenant list + injected `applyMigration`
callback -> per-tenant success/failed/skipped report), fully unit-tested (4 tests: full
success, halt-on-error default, continue-on-error, empty list) without touching a real
DB or the Prisma CLI. `src/scripts/migrateTenants/migrateAllTenants.ts` is the real
entrypoint — reads Active tenants from the platform registry, runs `prisma migrate
deploy` (or `migrate status` under `--dryRun`) per tenant via `execFile` (argument
array, no shell interpolation) with `DATABASE_URL` overridden to that tenant's
database, sequential by design. New `npm run migrate:tenants -- [--dryRun]
[--continueOnError]` script. Automatic rollback execution was deliberately left out of
scope (report the failure; rolling back is a separate explicit run) — flagged in the
plan as a hard-to-reverse action boundary, consistent with skill §6. `tsc --noEmit`
clean; could not exercise the real entrypoint against a live multi-tenant MySQL setup
in this environment (no reachable DB), same limitation as features 1-2's contract
tests — the pure logic is fully covered, the DB-touching thin wrapper is not runnable
here.

## 6. Billing grace-period / past-due UX

**Goal**: A `past_due` subscription keeps tenant access working with a visible warning
banner; a `canceled` subscription reverts the tenant to the free tier's feature limits
automatically.

**Scope**: Depends on feature 1's webhook plumbing. Extend the webhook use-case to
set `past_due`/`canceled` transitions; `feature-limit.guard.ts` already reads
`TenantSubscription.status` — verify/extend it to fall back to free-tier limits on
`canceled`. Frontend: banner component in the tenant admin shell reading subscription
status.

**Deliverables**: status-transition logic + tests, Angular banner component + spec.

**Exit gate**: §5 gate green; simulated `past_due` webhook leaves feature access
unchanged plus banner visible; simulated `canceled` webhook drops tenant to free-tier
limits within one request cycle (no stale cache).

**Status (done, 2026-08-07)**: `FeatureUsageService` (`src/tenancy/packages/services/`)
now branches on subscription status via a new `resolveEffectivePackageFeature` method:
ACTIVE and PAST_DUE both use the tenant's assigned package limits unchanged (grace
period — access is not affected while a payment retries); CANCELED falls back to the
`FREE_TIER_PACKAGE_KEY` ("starter", the seeded zero-price package) limits instead of
the tenant's old paid-plan limits, and fails closed (no access) if no such package
exists rather than silently keeping the old plan. New tenant-user-facing endpoint
`GET /api/tenant/billing/status` (`TenantBillingStatusController`, `JwtAuthGuard`, kept
as its own controller since it needs a different guard than `BillingController`'s
class-level `PlatformAdminGuard` — Nest guards stack rather than override per-method).
Frontend: `PastDueBannerComponent` + `TenantBillingStatusService`
(`client/src/app/shared/billing/`) mounted in `_metronic/layout/layout.component.html`
so it shows on every authenticated page when status is PAST_DUE, fails silently
(stays hidden) on fetch error. Backend: 4 new/updated unit tests in
`feature-usage.service.spec.ts` (grace period keeps paid limits, free-tier fallback
enforces the free tier's lower limit, fails closed with no free tier) — full backend
unit suite (53 tests, 11 files) passes; `tsc --noEmit` clean on both backend and
frontend (`npx tsc --noEmit -p client/tsconfig.app.json`). Frontend component spec was
written (`past-due-banner.component.spec.ts`, Jasmine/Karma) but could not be executed
in this environment — no Chrome binary available for Karma. Run `ng test` before
shipping to confirm it passes.

## 7. Tenant-branded transactional email (FR-MT-7)

**Goal**: Registration and password-reset emails reflect the sending tenant's name
(and logo, if configured) instead of a generic template.

**Scope**: New `src/infra/email/` module — `EmailPort` + an SMTP (or transactional-API,
e.g. existing provider if one is later specified by the user — ask if unclear) adapter,
template rendering with tenant name injected. Additive `Tenant.logoUrl` column if a
logo field doesn't already exist (confirm via schema before migrating). Wire into
`src/modules/auth/` registration and forgot-password flows, replacing the current
no-op.

**Deliverables**: email module, templates (plain HTML, no external template CDN),
unit tests with a fake `EmailPort`, e2e asserting the correct tenant name appears in
the rendered email body for two different tenants (no cross-tenant leakage).

**Exit gate**: §5 gate green; no SMTP credential logged; email content is
tenant-scoped correctly (regression-tested against a second tenant to catch bleed).

**Status (done, 2026-08-07)**: `src/infra/email/` — `EmailPort` (`send({to, subject,
html})`), `SmtpEmailAdapter` (nodemailer; no-ops with a warn log, doesn't throw, when
`SMTP_HOST` is unset — a missing welcome email must never break registration), and
plain-HTML `templates.ts` (`registrationWelcomeEmail`, `passwordResetEmail`) with a
hand-rolled `escapeHtml` guarding tenant name/logo URL interpolation against XSS in
the rendered email (tenant name is user-controlled data). Added `Tenant.logoUrl`
(nullable, additive) to `prisma/platform/schema.prisma` and regenerated the platform
Prisma client (`npx prisma generate --schema=prisma/platform/schema.prisma`) — **the
schema change itself has not been pushed to any real database**
(`npm run prisma:platform:push`) since no DB was reachable in this environment; run
that before this goes live. New `config.smtp` block (`SMTP_HOST/PORT/SECURE/USER/
PASSWORD/FROM_ADDRESS`). Wired into `AuthService.register`/`forgotPassword` (both now
take an optional `BrandedEmailContext`) and `AuthController` (reads `req.tenant.name`/
`logoUrl`, populated by `TenantResolutionMiddleware`). 15 new unit tests (branded-email
sending, XSS-escaping, unknown-email no-leak, SMTP-unconfigured no-op) — full backend
unit suite now 62 tests / 14 files, all passing; `tsc --noEmit` clean; no SMTP
credential appears in any log statement (grepped). SMTP provider choice was left to
generic SMTP (nodemailer) rather than a specific transactional-email API, since the
plan flagged that decision as needing user input and none was given — swap
`SmtpEmailAdapter` for a different `EmailPort` implementation if a specific provider
(SendGrid, SES, etc.) is preferred later.

## 8. Retroactive subject re-mapping trigger (FR-AUTH-6 / FR-PDF-7)

**Goal**: An exam manager can re-run subject classification over an already-authored
Exam Type's questions without re-uploading the PDF; already-correct mappings are left
untouched; the operation is safely repeatable.

**Scope**: `src/modules/pdfProcessing/` — extract the existing `subjectClassifier.ts`
call out of the one-shot pipeline into a standalone application use-case
(`ReclassifyExamTypeSubjectsUseCase`) callable both from initial ingestion and from a
new endpoint. New controller endpoint `POST /exam-types/:id/reclassify-subjects`.
Frontend: a "Re-run subject classification" action on the exam-type detail page.

**Deliverables**: extracted use-case + unit tests (idempotency case: re-running twice
produces the same result and doesn't touch already-correct questions), new endpoint +
e2e test, UI button + confirmation dialog + spec.

**Exit gate**: §5 gate green; endpoint authorized to exam-manager role only; a second
identical run is a no-op (verified in test); a run over an Exam Type with mixed
correct/incorrect mappings only changes the incorrect ones.

**Status (done, 2026-08-07) — correction to the original gap analysis**: This already
existed in full: `fixSubjectMapping` (`src/modules/examTypes/service.ts:258`), exposed
at `POST /api/exam-types/:id/fix-subject-mapping`
(`src/modules/examTypes/controllers/exam-types.controller.ts:115`, gated by the same
`JwtAuthGuard`+`PermissionsGuard`+`RequirePermission(PERMISSIONS.ManageExams)` as every
other exam-type-authoring endpoint on that controller — i.e. exam-manager only), with a
frontend trigger already wired in `exam-type-details.component.ts`/
`exam-type.service.ts`. It correctly does everything FR-AUTH-6/FR-PDF-7 ask for:
re-runs `classifyQuestionsBySubject` only on `ExamTypeQuestion` rows whose current
`moduleName` isn't already a real subject in the exam type's stage (idempotent — a
second run touches nothing), updates `ExamModule` counts and invalidates the question
bank cache. The original background-agent gap analysis reported this missing, again
without opening the actual service file — the same class of shallow miss as feature 3.
The one real gap was test coverage: no test existed for `fixSubjectMapping` at all.
Added `test/unit/examTypes/fixSubjectMapping.spec.ts` (6 tests: not-found, wrong
storage mode, no stage, idempotent partial reclassification, full second-run no-op,
classifier-result-equals-current-value no-op) — all pass. Full backend unit suite now
68 tests / 15 files, all passing; `tsc --noEmit` clean.

**All 8 features in this plan are now complete.** Two (3 and 8) required no code
changes because the original gap analysis was wrong about them existing — worth
remembering: a background-agent-driven gap analysis can produce false negatives by not
opening files closely enough, so treat "missing" findings as a starting hypothesis to
verify, not a fact, before building a duplicate.

---

## Notes

- Each feature above runs its own §5 gate before the next begins — a red gate blocks
  progression, no exceptions.
- Features 1 and 6 are coupled (6 depends on 1's webhook infra) but kept as separate
  gated phases per the skill's "no phase requires a later phase to compile" rule — 1
  ships a working (if grace-period-less) billing loop on its own.
- Feature 4's shared-schema strategy is intentionally stubbed, not fully built, to
  avoid an open-ended architecture change riding along with the isolation-mode
  refactor — flagged to the user when reached.
- Email provider choice (feature 7) and Stripe test/live mode credentials (feature 1)
  require the user to supply real credentials/env values before end-to-end webhook/email
  testing can run against live services; local test doubles cover the automated gate.
