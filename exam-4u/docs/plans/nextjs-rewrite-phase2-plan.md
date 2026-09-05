# ExamLand Next.js Rewrite — Phase 2: Platform Admin Console + Tenant Maintenance

Authoritative source for scope/sequencing: `giggly-exploring-wombat.md` ("the migration plan", at the
repo root). This doc tracks only the phase-by-phase execution status against that plan; it does not
restate the plan's rationale. `docs/BACKLOG.md`'s Phase/Priority ordering is **not** used to sequence
this migration. This is Phase 2's first sub-dispatch — later sub-dispatches append their own sections
below, matching every prior phase-plan doc's own convention.

The migration plan's Phase 2 line: "Platform Admin console + tenant maintenance — `platform/billing`
(Stripe), `platform/ai-models` (allowlist admin), packages/features CRUD UI, `platform/audit`,
`platform/reliability` dashboards, platform console UI, tenants CRUD UI, `TenantMaintenanceWorker`.
Exit: a Platform Admin can fully operate the platform through the UI alone."

## Sub-slice 2a — Platform console UI shell, platform-admin login page, tenants CRUD UI

**Goal**: a Platform Admin can log in through a real browser, land on an authenticated console shell,
and fully manage tenant lifecycle (list/filter, create via the real provisioning workflow,
suspend/reactivate, soft-delete, toggle registration settings, retry a failed provisioning run) —
entirely through the new Next.js + Chakra UI v3 UI, proven via a real `next start` server and a real
Playwright browser session, not just HTTP-level checks.

**Backlog item(s)**: none — tracked via this plan file, matching every Phase 0/1 sub-dispatch's own
framing.

### Scope

**In scope** (this sub-dispatch's own slice of the migration plan's Phase 2 item list):
- `app/platform/**` — the platform realm's real URL-path segment (see "Decisions made" #1 for why a
  real segment, not a bare Next.js route group): `layout.tsx` (mounts `PlatformAuthProvider`),
  `login/page.tsx` (centered-card login screen), `page.tsx` (redirect to `/platform/tenants`),
  `(console)/layout.tsx` (client-side auth guard + `PlatformShell`), `(console)/tenants/page.tsx`
  (list), `(console)/tenants/new/page.tsx` (create), `(console)/tenants/[id]/page.tsx` (detail).
- `app/api/platform/tenants/**` — `GET`/`POST /api/platform/tenants` (list, create via the real
  `TenantProvisioningService.provisionNewTenant`), `GET /api/platform/tenants/:id`, `POST
  .../suspend`, `POST .../activate`, `POST .../soft-delete` (new, no legacy HTTP precedent), `PATCH
  .../registration-settings`, `POST .../provisioning/retry` (small, justified addition beyond this
  dispatch's original enumerated scope — see "Decisions made" #3). All gated by `withPlatformAuth`,
  calling `getTenantsService()`/`getTenantProvisioningService()` from their existing barrels — no new
  `server/` module and no new ESLint module-boundary block needed this dispatch.
- `components/platform/` (NEW) — `status-badge.tsx`, `confirm-dialog.tsx` (both unit-tested),
  `platform-shell.tsx` (sidebar + mobile `Drawer` nav, account menu, `BackToTenantsLink` helper).
- `components/ui/toaster.tsx` (NEW) — Chakra v3's documented `createToaster`/`<Toaster />` snippet,
  mounted once in `components/ui/provider.tsx` (a general-purpose cross-cutting primitive, not
  platform-specific, matching that file's own "single root provider" scope — Phase 2's first consumer).
- `lib/platform-console/` (NEW) — the client-side typed API/data-access layer: `api-error.ts`
  (`PlatformApiError`, `isPlatformApiError`), `token-storage.ts` (`localStorage` under
  `el.tok.platform`, matching the legacy Angular app's own documented key convention), `http-client.ts`
  (`platformFetch` — bearer-token attach + `ErrorEnvelope` parsing chokepoint), `auth-api.ts`,
  `tenants-api.ts`, `auth-context.tsx` (`PlatformAuthProvider`/`usePlatformAuthContext`). Deliberately
  not under `src/server/` (client-safe, browser-only code) and deliberately not named e.g.
  `lib/platform/tenants/**` (would collide with the existing bare-pattern latent-gap class described
  in "Decisions made" #4 below).
- `src/middleware.ts` — extended matcher to exclude `/platform` (the UI realm) from tenant resolution,
  alongside the pre-existing `/api/platform` exclusion (see "Decisions made" #1).
- `apps/next/.eslintrc.cjs` — `PLATFORM_TENANTS_BARREL_ONLY`'s `group` narrowed from a bare
  `**/platform/tenants/**` to `**/server/platform/tenants/**` (see "Decisions made" #4).
- `apps/next/src/server/phase2-platform-tenants-routes.integration.test.ts` (NEW) — real-route-level
  integration tests for every new `app/api/platform/tenants/**` handler, following the exact
  `phase1-exception-*.integration.test.ts` convention (calls the real exported Route Handler functions
  with a genuine `NextRequest`, real MySQL, self-cleaning `afterAll`).
- `apps/next/scripts/playwright-smoke.ts` (NEW) — this app's first committed, re-runnable Playwright
  browser smoke check (`npm run smoke:ui`); prior phases used ad hoc, non-committed scripts against the
  raw `playwright` library (no persisted UI existed to smoke-check before this dispatch).
- `apps/next/vitest.config.ts`/`vitest.setup.ts` (NEW) — extended to run `.test.tsx` component tests
  under `jsdom` (via `environmentMatchGlobs`, scoped narrowly so the ~350 pre-existing `.test.ts` server
  tests keep running under the faster `node` environment), `esbuild.jsx: 'automatic'` (React 19's JSX
  transform, not read from `tsconfig.json`'s own Next.js-specific `"jsx": "preserve"` setting), and an
  explicit `afterEach(cleanup)` (`@testing-library/react` only auto-registers this under Jest-style
  globals, which this project deliberately doesn't enable).
- `apps/next/package.json` — new devDependencies `@testing-library/react`, `@testing-library/jest-dom`,
  `jsdom` (this app's first component tests); `playwright` (already a root-level dependency, added here
  too since this app's own `smoke:ui` script depends on it directly).
- `docs/design/UX_GUIDELINES.md` §18 (new) — extends §3 (written for the legacy Angular platform
  console) with this stack's Chakra-v3 component vocabulary and the one genuinely new UI surface: tenant
  soft-delete (see "Decisions made" #2).
- A real, previously-latent bug fix (found via this dispatch's own real-browser pass, not
  pre-existing-and-out-of-scope): `TenantSubscriptionRepository.upsertForTenant`'s
  `.into(TenantSubscriptionEntity)` → `.into('tenant_subscription')` (see "Decisions made" #5).

**Explicitly out of scope** (deferred to later Phase 2 sub-dispatches, not silently skipped):
- `platform/billing` (Stripe), `platform/ai-models` (allowlist admin), packages/features CRUD UI,
  `platform/audit`, `platform/reliability` dashboards, `TenantMaintenanceWorker` — all per the
  migration plan's own Phase 2 item list; none of this dispatch's scope touches them.
- Tenant branding UI (`updateBranding`'s surface, FR-MT-10) — the migration plan explicitly assigns
  this to Phase 9; `TenantsService` still has no branding read/write path (unchanged from Phase 1).
- `reassignSubscription` (`PUT /platform/tenants/:id/subscription`) — checked whether it was trivial
  reuse of an already-built service; it is not (`SubscriptionAdminService` doesn't exist in this app
  yet — only read-path package/feature/subscription repositories from Phase 1a). Deferred to the
  billing/packages sub-dispatch where it naturally belongs, per the dispatch's own instruction.
- `GET /platform/tenants/:id/usage`, AI-model assignment (`PUT`/`DELETE .../ai-model`), Stripe
  checkout-session creation — all depend on modules (`platform/billing`, `platform/ai-models`) that
  don't exist in this app yet.
- Platform admin audit logging (`platform.audit_log` writes on every mutating action, legacy's own
  `TenantsController` convention) — `platform/audit` doesn't exist in this app yet (Phase 2's own later
  sub-dispatch); every new mutating route's doc comment explicitly flags this deferral rather than
  silently omitting it.
- Real, live testing of the `Provisioning`/`Failed` intermediate states' UI treatment against a
  genuinely failing provisioning run (beyond what the create-tenant page's error-shape handling
  already covers defensively) — no reliable way to force a real step failure through the UI alone this
  dispatch; the `provisioningError` panel/retry action are built and unit-provable via the existing
  `TenantProvisioningService` test suite, but not re-proven via a live forced-failure browser run.

### Decisions made (LLD/plan silent, or a genuine judgment call — smallest-reasonable-choice standard)

1. **`/platform` is a real URL-path segment (`app/platform/**`), not a bare Next.js route group** —
   the dispatch prompt specifically asked me to check `middleware.ts`/tenant-resolution for the
   established platform-vs-tenant URL convention before inventing a new one. `middleware.ts`'s existing
   matcher already excludes `/api/platform/**` from tenant resolution by literal path prefix (Phase 1b);
   legacy's own Angular app uses real `/platform/login`/`/platform/tenants` routes (`platform-shell.
   component.html`'s `routerLink="/platform/tenants"`, etc.). A bare Next.js route group (`(platform)`)
   produces *no* URL segment at all — using one here would have made the platform console
   indistinguishable, at the URL level, from tenant-realm routes, breaking the exact
   path-prefix-exclusion mechanism `/api/platform` already relies on (an admin navigating to
   `/platform/login` would otherwise fall through to `resolveTenantForRequest()` against whatever
   arbitrary `Host` header served the request, 404ing on a reserved/nonexistent slug before the page
   component ever ran). Resolved as: a real `platform` folder segment (`app/platform/login/page.tsx`,
   `app/platform/(console)/tenants/page.tsx`, etc.), with `middleware.ts`'s matcher extended to exclude
   `/platform` by the identical mechanism `/api/platform` already uses. A nested `(console)` route
   group is still used, but purely for its intended purpose (sharing `PlatformShell`'s layout across
   every authenticated screen while keeping `/platform/login` outside it) — not to (mis)produce the
   top-level `/platform` prefix itself.

2. **Tenant soft-delete gets a *stronger* confirmation than suspend — a type-the-tenant-name-to-confirm
   dialog, not §3.4's plain Cancel/Confirm.** No legacy precedent exists at all (`legacy/web`'s
   `tenant-detail.component.ts` never wired a delete action, even though `TenantsService.softDelete` has
   existed in this app's backend since Phase 1). Reasoning, following this project's own established
   graduated-confirmation-by-reversibility standard (the identical logic §3.4 itself already applies —
   suspend gets a confirm dialog specifically because it has real, if reversible, user-facing impact;
   activate/retry get none because they have no destructive downside at all): suspend is undone by one
   click on "Activate" with zero data loss and no time pressure; soft-delete blocks all tenant access
   immediately and starts an irreversible-after-`TENANT_RETENTION_DAYS` (30 days) purge countdown — a
   materially larger blast radius and a real, if delayed, point of no return. A plain "are you sure?"
   dialog is proportionate to suspend's stakes but not to delete's. See `docs/design/UX_GUIDELINES.md`
   §18.4 for the full write-up (flows/copy/accessibility) and §17 doc comment cross-reference.

3. **`POST /platform/tenants/:id/provisioning/retry` added even though the dispatch's own enumerated
   scope list named only suspend/reactivate/soft-delete/update-registration-settings.** Without it, a
   tenant whose creation lands in `Failed` status (a real, expected, already-UI-handled outcome per the
   create-tenant page's own success-vs-Failed-status distinction) has *no* recovery path from the
   console at all — the tenant detail screen's `provisioningError` panel is specifically designed around
   this action being available right next to it (mirroring legacy's own UX_GUIDELINES §3.2/§3.4
   guidance, written before this dispatch but for the identical screen). This reuses the already-built,
   already-tested `TenantProvisioningService.retry` verbatim — no new business logic, only a new HTTP
   entry point and a UI button. A small, low-risk, directly-adjacent addition to what was asked, not new
   scope invention (no new module, no new business rule).

4. **`PLATFORM_TENANTS_BARREL_ONLY`'s ESLint pattern fixed from a bare `**/platform/tenants/**` to
   `**/server/platform/tenants/**`** — the exact same class of latent gap the Phase 1 "exception
   closure" dispatch already found and fixed for `PROFILE_BARREL_ONLY`. This dispatch is the first to add
   `app/api/platform/tenants/**` Route Handler files; the pre-existing bare pattern would have blocked
   this dispatch's own `phase2-platform-tenants-routes.integration.test.ts` from importing the real
   route handler functions (`@/app/api/platform/tenants/route` matches `**/platform/tenants/**` purely
   because the path contains that literal segment sequence — nothing to do with `server/platform/
   tenants`'s actual internals, the boundary this rule exists to protect). Fixed the same way precedent
   established: narrowed (not loosened) to scope the pattern to `server/platform/tenants/**` only,
   verified via a deliberately-added-then-reverted genuine deep-import violation (still correctly fails
   lint after the fix). `lib/platform-console/`'s own file names were deliberately chosen to avoid ever
   colliding with this class of pattern in the first place (no `platform/tenants/` or `platform/auth/`
   directory-segment sequence anywhere under `lib/platform-console/`).

5. **A real, previously-latent, production-breaking bug found and fixed only by driving a real browser
   through the actual `next start`-built server** — `TenantSubscriptionRepository.upsertForTenant`'s
   `.into(TenantSubscriptionEntity)` (the entity **class** reference, not a string) threw `TypeError:
   this.subQuery is not a function` when `CreateSubscriptionStep` ran during a real create-tenant flow
   driven through the browser. This is the exact same cross-webpack-bundle entity-class-identity bug
   class Phase 1 sub-slice 1b already found and fixed (`server/tenancy/raw-tenant-lookup.ts`'s doc
   comment) for `dataSource.getRepository(EntityClass)` calls — but at a *different* call site
   (`InsertQueryBuilder.into()`) that fix never touched, because it was never exercised by any
   vitest-level test (which calls this method in-process, without Next.js's own webpack chunk-splitting
   — confirmed directly: this dispatch's own `phase2-platform-tenants-routes.integration.test.ts`, which
   calls the real exported Route Handler *functions* in-process, passed cleanly on this exact code path
   before the fix; only the real, separately-booted `next start` server reproduced the bug). Fixed the
   same way precedent established: `.into('tenant_subscription')` (a literal string), immune to any
   class-identity/minification issue. Found and fixed during this dispatch's own real-browser
   Playwright pass (not a pre-existing, out-of-scope defect silently left alone — this dispatch's own
   `POST /api/platform/tenants` route is what first drove a real create-tenant flow through the actual
   production-built server).

6. **Create-tenant is a dedicated route (`/platform/tenants/new`), not a modal.** Legacy's own
   UX_GUIDELINES §3.3 explicitly left both acceptable. A dedicated route was chosen: simpler and more
   robust focus-management/back-navigation behavior on this stack (Next.js App Router's own
   page-transition model handles this more predictably than manually orchestrating a modal's focus trap
   around a multi-second synchronous submit), and it sets the precedent every future Phase 2 console
   create-flow (billing/ai-models/packages/features) should also follow for consistency, per §3.3's own
   instruction to "apply consistently to any future console create-flows."

7. **No icon library added for the status badge** — legacy's UX_GUIDELINES §3.1a specifies a Material
   Symbols icon per status alongside color+text. This app has no icon library at all yet (Phase 0/1
   added none). Rather than adding one for a single badge component, the badge's non-color
   differentiator is the status text label itself ("Active", "Suspended", ...) — already independently
   satisfying WCAG 2.2 AA's "don't convey meaning by color alone" (a screen reader announces the word
   regardless of color; a colorblind sighted user reads the same word). Documented as a small,
   consciously-deferred gap in `docs/design/UX_GUIDELINES.md` §18.1, not silently diverged from without
   a note.

8. **Coverage tooling extended to measure this dispatch's own new client-side code**, not left
   silently uncovered by the pre-existing `include: ['src/server/**/*.ts']` scope.
   `vitest.config.ts`'s `coverage.include` now also covers `lib/platform-console/**/*.ts` (the client
   data-access layer — every function here is unit-tested, 100% on every new file) and the two
   logic-bearing shared components (`status-badge.tsx`, `confirm-dialog.tsx`, both unit-tested).
   Whole *pages* (`app/platform/**/page.tsx`, `platform-shell.tsx`) are deliberately left outside
   vitest coverage — matching this project's own existing precedent for `app/api/**` Route Handlers
   (thin, orchestration-only, proven via a real HTTP/browser pass rather than vitest coverage), extended
   here to "whole UI pages are proven via a real browser click-through, not vitest coverage."

### Exit gate

1. `next build` succeeds cleanly. **PASS.**
2. `eslint --max-warnings=0` clean, including a deliberately-added-then-reverted module-boundary
   violation proving `PLATFORM_TENANTS_BARREL_ONLY`'s fixed pattern actually fires. **PASS** — a scratch
   file deep-importing `@/server/platform/tenants/application/tenants.service` was added, confirmed to
   fail with the expected `no-restricted-imports` error, then removed; lint is clean again. No other new
   module-boundary rule was needed this dispatch (see "Decisions made" #4 for why — Route Handlers under
   `app/api/platform/tenants/**` are ordinary barrel-only consumers of the existing `platform/tenants`/
   `platform/provisioning` modules, not a new module of their own).
3. Unit tests for new pure-logic code (the client-side `platformFetch` chokepoint's bearer-token
   attach/`ErrorEnvelope` parsing/network-error fallback, every `tenants-api.ts`/`auth-api.ts` request
   shape, `token-storage.ts`'s SSR-safety guard, the `StatusBadge`/`ConfirmDialog` components including
   the typed-confirmation gating logic) — **PASS**, plus the full accumulated suite (see below).
4. Real end-to-end proof: booted the app for real (`next build` then `next start -p 3179`) against the
   already-running `exam-4u-mysql-1` container's `examland_platform_next` schema, and via a real
   Playwright Chromium browser (`apps/next/scripts/playwright-smoke.ts`, `npm run smoke:ui`) proved: a
   platform admin logs in through the real UI; lands on the console shell; navigates to
   `/platform/tenants`; sees the real, Phase-1-seeded `demo-next` tenant in the list; creates a new
   tenant through the UI (a real, synchronous provisioning workflow run, not a mock); suspends it
   through the UI (confirm dialog) with the real status change reflected; reactivates it through the UI
   with the real status change reflected; soft-deletes it through the UI (the new, stronger
   type-the-name-to-confirm dialog) with the real `deletedAt`/`purgeAfterAt` banner reflected. Zero
   console errors across every page load in the run. **PASS.**
5. Legacy containers (`exam-4u-api-1`, `-worker-1`, `-mysql-1`, `-qdrant-1`, `-mailhog-1`) completely
   undisturbed. **PASS** — `docker ps` diffed before/after every verification step (unit/integration
   tests, the real `next start` boot, and the real-browser Playwright pass); only uptime counters
   progressed naturally, no restarts.

### Verification evidence

**Automated tests**: `392` tests green (up from Phase 1's final `353` — this dispatch adds 39 across 10
new test files: 7 in the new real-route `phase2-platform-tenants-routes.integration.test.ts`, 6 in
`http-client.test.ts`, 10 in `tenants-api.test.ts`, 3 in `auth-api.test.ts`, 2 in `token-storage.test.ts`,
2 in `api-error.test.ts`, 5 in `status-badge.test.tsx`, 4 in `confirm-dialog.test.tsx`), run with
`DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev
DB_PLATFORM_SCHEMA=examland_platform_next JWT_TENANT_SECRET=... JWT_PLATFORM_SECRET=...
FILE_SIGNING_SECRET=...`. Coverage (`vitest run --coverage`): **92.44% statements / 90.81% branch /
88.76% functions / 92.44% lines** overall (`src/server/**` + this dispatch's own new
`lib/platform-console/**` + `status-badge.tsx`/`confirm-dialog.tsx`) — clears the "≥80%" bar
comfortably; every new `lib/platform-console/**` file is at 100% statements/lines (http-client.ts is
96.15% branch — one unreachable defensive branch). One run of the full suite hit 4 failures, all in
*pre-existing* Phase 1 test files (`phase1-exception-reliability-workers.integration.test.ts`'s
concurrency race test, `phase1-exception-files-delivery.integration.test.ts`'s three route tests) —
confirmed, by re-running both files in isolation (clean) and the full suite a second time (clean, 392/392),
to be the same "environment-load-caused flake under full concurrent-suite real-MySQL load" class this
project's own history already documents precedent for (Dev-18b/Dev-22 in the legacy build; the Phase 1
exception-closure dispatch's own identical finding) — not a regression introduced by this dispatch.

**Real end-to-end HTTP + browser pass**: `next build` then `next start -p 3179` (`NODE_ENV=production`)
against `examland_platform_next`, with a platform admin created via a direct (bcrypt-hashed,
scratchpad-only, not committed) verification script — this dispatch's own script mirrors the exact
technique `phase2-platform-tenants-routes.integration.test.ts`/prior Phase 1 integration tests already
use for a "known password" test fixture, since no self-service platform-admin signup route exists (by
design — platform admins are provisioned via `PLATFORM_ADMIN_BOOTSTRAP_EMAIL`/`_PASSWORD` or directly,
never a public route). `apps/next/scripts/playwright-smoke.ts` drove a real Chromium browser through:
login page render → real login → console shell + real seeded-tenant visibility → real create → real
suspend → real reactivate → real soft-delete, asserting zero console errors throughout. Full transcript:

```
PASS: /platform/login renders with expected heading + form fields
PASS: real login redirected to /platform/tenants
PASS: /platform/tenants shows the console shell and a real Phase-1-seeded tenant (demo-next)
PASS: created tenant 'smoke2a-msucmtfa' through the real UI via the real provisioning workflow (status: Active)
PASS: suspended the new tenant through the real UI (confirm dialog + real status change to Suspended)
PASS: reactivated the new tenant through the real UI (real status change back to Active)
PASS: soft-deleted the new tenant through the real UI (typed-confirmation gate + real deletedAt/purgeAfterAt banner)
PASS: zero console errors across every page load in this run
```

This run is what surfaced and proved the fix for "Decisions made" #5's real bug (the initial run failed
with a real `500 TENANT_PROVISIONING_FAILED` on create, root-caused via the server's own structured log
output, fixed, rebuilt, and re-run clean).

`docker ps` diffed before/after every step above (unit/integration test runs, the `next start` boot, and
the Playwright pass) — only uptime counters on `exam-4u-api-1`/`-worker-1`/`-mysql-1`/`-qdrant-1`/
`-mailhog-1` progressed naturally; no container restarted, stopped, or was added/removed.

### Verification artifacts left in the shared dev MySQL instance

Matching Phase 1's own established precedent (`demo-next`/`smoke1b`/`smoke1c` left in place as operator
conveniences), this dispatch's own real-HTTP-pass tenants were **not** force-cleaned afterward: a
`phase2-verify-admin@examland.local` platform admin (known password, scratchpad-script-created) and one
or more `smoke2a-*` tenants (created/suspended/reactivated/soft-deleted across this dispatch's own
Playwright runs) remain in `examland_platform_next`. Harmless, real, already-exercised dev-verification
data — not production data, and consistent with this migration's own iterative-phase-by-phase shared-
schema reality (a real `docker compose up` from a fresh volume, Phase 10's job, starts from zero).

## Status

**Sub-slice 2a complete.** All 5 exit-gate items pass (see "Verification evidence" above). 392 tests
green (up from Phase 1's final 353), 92.44%/90.81% statement/branch coverage on `src/server/**` plus
this dispatch's own new client-side lib/components, `next build`/`eslint --max-warnings=0`/`tsc --noEmit`
all clean, legacy
containers confirmed undisturbed throughout (including the real `next start` boot and the real-browser
Playwright pass). One real, previously-latent, production-breaking bug (`TenantSubscriptionRepository.
upsertForTenant`'s `.into(EntityClass)`) and one real, previously-latent ESLint module-boundary gap
(`PLATFORM_TENANTS_BARREL_ONLY`'s bare pattern) were both found and fixed — the same "find it by
actually running the thing, not just building/typechecking it" discipline every prior phase's own
dispatch already established.

**Explicitly not done this dispatch** (see "Scope" above for the full list): `platform/billing`
(Stripe), `platform/ai-models`, packages/features CRUD UI, `platform/audit`, `platform/reliability`
dashboards, `TenantMaintenanceWorker`, tenant branding UI (Phase 9), `reassignSubscription`, AI-model
per-tenant assignment, platform-admin audit logging (no `platform/audit` module yet), and a live
forced-provisioning-failure browser proof of the `Failed`-status UI path (unit-proven only).

Next Phase 2 sub-dispatch (superseded by sub-slice 2b's own "Status" section below — see there for the
current forward pointer): the remaining migration-plan Phase 2 item list — `platform/billing` (Stripe),
`platform/ai-models` (allowlist admin), packages/features CRUD UI, `platform/audit`,
`platform/reliability` dashboards, `TenantMaintenanceWorker`. `platform/billing`'s write path (CRUD +
Stripe adapter) and `reassignSubscription` naturally belong together in that sub-dispatch, per Phase 1a's
own "Decisions made" #2 already establishing `server/platform/billing` as their shared home.

`current_phase` in `docs/NEXUS_STATE.md` remains `development` (unchanged) — this migration is tracked
via this plan file and the `migration_plan` state line, not the old backlog-phase numbering; Phase 2
overall is not yet complete (five more item groups remain), only this first sub-slice is.

## Sub-slice 2b — Packages/Features catalog CRUD UI, `platform/ai-models` allowlist admin +
per-tenant assignment

**Goal**: a Platform Admin can, through the real browser, fully manage the packages/features catalog
(create/edit a feature, create/edit a package, associate features with a package via an atomic
full-replace picker) and the AI model allowlist (approve/edit/enable-disable/set-default/remove a
model), and assign/unassign an approved model to an existing tenant — all through the new Next.js +
Chakra UI v3 console, proven via a real `next start` server and a real Playwright browser session.

**Backlog item(s)**: none — tracked via this plan file, matching every prior sub-dispatch's own
framing.

### Scope

**In scope** (per the dispatch prompt's own enumerated item list):
1. `features` write-CRUD (create/update/list/delete — legacy's `FeaturesService` supports all four,
   ported in full) — new `server/platform/billing/application/features.service.ts` +
   `server/platform/billing/domain/errors.ts` (feature half) + write methods added to the existing
   `infrastructure/feature.repository.ts` (Phase 1a's read-path methods kept, not replaced). New
   `app/api/platform/features/route.ts` (`GET`/`POST`) + `app/api/platform/features/[id]/route.ts`
   (`GET`/`PATCH`/`DELETE`), all `withPlatformAuth`-gated.
2. `packages` write-CRUD + the atomic package↔feature association replace — new
   `server/platform/billing/application/packages.service.ts` + write methods added to
   `infrastructure/package.repository.ts`/`infrastructure/package-feature.repository.ts`. New
   `app/api/platform/packages/route.ts` (`GET`/`POST`), `.../[id]/route.ts` (`GET`/`PATCH`), and
   `.../[id]/features/route.ts` (`PUT`, the atomic full replace).
3. `platform/ai-models` — a brand-new module (`server/platform/ai-models/{domain,infrastructure,
   application}` + barrel), porting `ApprovedAiModelEntity`, `ApprovedAiModelRepository`,
   `AiModelResolver`, and `AiModelsService` (allowlist CRUD + `assignToTenant`/`unassignFromTenant`)
   from legacy verbatim in logic. New `app/api/platform/ai-models/route.ts` (`GET`/`POST`),
   `.../[id]/route.ts` (`GET`/`PATCH`/`DELETE`), `.../[id]/default/route.ts` (`PUT`), and — the
   assignment half, which legacy exposes on the *tenants* controller, not a separate ai-models one —
   `app/api/platform/tenants/[id]/ai-model/route.ts` (`PUT`/`DELETE`).
4. Chakra v3 UI: `app/platform/(console)/features/{page.tsx,new/page.tsx,[id]/page.tsx}`,
   `.../packages/{page.tsx,new/page.tsx,[id]/page.tsx}` (the `[id]` page includes the new
   feature-association picker), `.../ai-models/{page.tsx,new/page.tsx,[id]/page.tsx}` — all inside
   Phase 2a's existing `PlatformShell`, three new nav items. Additive "AI model" panel on the existing
   `.../tenants/[id]/page.tsx` (assign/unassign + effective-model display) — no new tenant-detail
   route, an addition to the already-shipped screen.
5. New platform-schema migrations: `20260815000009-create-approved-ai-model-table.ts`,
   `20260815000010-seed-approved-ai-model-default.ts` (verbatim-ported seed, same idempotency-on-empty
   rule as legacy), and `20260815000011-add-fk-tenant-assigned-ai-model.ts` — the FK from
   `tenant.assigned_ai_model_id` to `approved_ai_model(id)`. Confirmed first that `feature`/`package`/
   `package_feature`/`tenant_subscription` already exist from Phase 1a and needed no new migration —
   only `approved_ai_model` (+ the tenant FK) was genuinely new, exactly as the dispatch prompt
   anticipated. New `ApprovedAiModelEntity` registered in `PLATFORM_ENTITIES`.
6. `docs/design/UX_GUIDELINES.md` §18.6/§18.7 (new) — the package↔feature association picker (a
   genuinely new interaction pattern) and the tenant-detail AI-model panel, both derived from and
   consistent with §18's existing conventions rather than reinventing them.
7. New `apps/next/.eslintrc.cjs` `PLATFORM_AI_MODELS_BARREL_ONLY` module-boundary rule for the new
   `platform/ai-models` module, scoped correctly (`**/server/platform/ai-models/**`, not a bare
   `**/platform/ai-models/**`) from the very first commit — deliberately avoiding the exact latent gap
   sub-slice 2a had to find-and-fix for `PLATFORM_TENANTS_BARREL_ONLY` after the fact. `packages`/
   `features` needed no new module-boundary rule (they're additions inside the already-boundary-rule'd
   `platform/billing` module).
8. New `server/common/util/catalog-key.util.ts` (`isValidCatalogKey`) — a single shared key-shape
   validator for both `FeaturesService`/`PackagesService`, replacing legacy's two independently
   duplicated-but-identical `class-validator` `@Matches` patterns (this app has no DTO layer to
   duplicate the pattern into twice). New `server/common/http/validate.ts` additions
   (`optionalString`/`requireInt`/`optionalInt`/`optionalBoolean`/`requireEnum`) — this dispatch's
   `PATCH`-body "every field optional, `undefined` leaves it unchanged" convention needed generic
   building blocks beyond the pre-existing `requireString`/`requireEmail`.
9. New `server/config/env.schema.ts` var: `AI_MODEL_CACHE_TTL_MS` (ported verbatim, default 60000).
10. New `PlatformTenantRepository.setAssignedAiModel` method (in the existing `platform/tenants`
    module) — the sole write path `AiModelsService.assignToTenant`/`unassignFromTenant` use.
11. `apps/next/scripts/playwright-smoke.ts` extended (not replaced) with the new Phase 2b flow: create
    a feature, create a package and associate the feature with it, approve an AI model, assign it to
    the real Phase-1-seeded `demo-next` tenant, and a hard-reload persistence proof — every sub-slice
    2a assertion above it in the script is left intact.

**Explicitly out of scope for this dispatch** (deferred, per the dispatch prompt's own framing):
- `platform/billing` (Stripe) and `reassignSubscription` — a later Phase 2 sub-dispatch owns these
  (unchanged from sub-slice 2a's own deferral note); `TenantSubscriptionRepository`'s write path was
  not touched this dispatch.
- `platform/audit`, `platform/reliability` dashboards, `TenantMaintenanceWorker` — later Phase 2
  sub-dispatches.
- `platform.audit_log` writes on any of this dispatch's new mutating routes — `platform/audit` doesn't
  exist in this app yet; every new mutating route's doc comment explicitly flags this deferral (same
  convention sub-slice 2a's tenants routes already established), rather than silently omitting it.
- `AiModelResolver`'s *consumption* by an actual OpenRouter/LLM call — this dispatch ports the
  resolver itself (needed by `AiModelsService`'s own `invalidate()` calls and by this dispatch's own
  admin-console "effective model" display) but wires it into nothing that actually calls an LLM.
  Per the migration plan's own phase sequence, that wiring is Phase 5's ("AI & vector platform layer")
  job — confirmed against the plan's "Key architecture decisions" AI bullet and Phase 5's own item
  list before making this call, not assumed.
- A tenant-realm `GET /api/tenant/ai-model` read endpoint (legacy's `TenantAiModelController`) — no
  tenant-realm settings screen exists yet to consume it (that's a later phase's own UI surface); the
  admin console's own "effective model" display uses `AiModelsService.resolveEffectiveModel` directly
  from the platform-admin-authenticated routes it already has, so no new read route was needed for
  this dispatch's own UI.
- `PLATFORM_BILLING_BARREL_ONLY`'s ESLint pattern (`**/platform/billing/**`, still bare, not narrowed
  to `**/server/platform/billing/**`) — this dispatch's own new `app/api/platform/{features,
  packages}/**` route files don't collide with it (their paths don't contain the literal segment
  sequence `platform/billing`), so the latent-gap class sub-slice 2a fixed for `PLATFORM_TENANTS_
  BARREL_ONLY` doesn't actually manifest here — confirmed by this dispatch's own real-route
  integration test file successfully importing every new route module without a lint exemption needed.
  Flagged as a still-latent, not-yet-triggered risk for whichever future sub-dispatch adds
  `app/api/platform/billing/**` routes (the Stripe sub-dispatch) — that dispatch should check this
  pattern before assuming it's already correctly scoped.

### Decisions made (LLD/plan silent, or a genuine judgment call — smallest-reasonable-choice standard)

1. **Feature/package `key`-shape validation lives in the service layer via a shared
   `common/util/catalog-key.util.ts` helper, not a `class-validator`-equivalent DTO layer** — this app
   has no DTO/decorator validation mechanism (Phase 1's own established convention: type/length checks
   in `server/common/http/validate.ts` at the route boundary, business-shape rules like
   `isValidSubdomainSlug` inside the owning service). A catalog key's shape (lowercase/digits/`._-`
   segments) is a business-shape rule identical in spirit to a subdomain slug's, so it follows
   `TenantsService.create`'s own precedent rather than inventing a third convention.
2. **AI model id shape validation (`INVALID_MODEL_ID`) stays inside `AiModelsService.approve` itself**
   (not the route layer) — ported verbatim from legacy, where this exact validation already lived in
   the service (not the DTO) specifically so its regex/error code stays unit-testable independent of
   any HTTP-layer concern. No deviation needed; this app's "route owns type/shape, service owns
   business rules" split already puts it in the right place by default.
3. **Feature/AI-model delete confirmation stays the plain `ConfirmDialog` (§3.4's baseline), not
   §18.4's stronger typed-confirmation escalation** — see `docs/design/UX_GUIDELINES.md` §18.6 for the
   full reasoning: both deletes are only ever offered once the server has already proven zero blast
   radius (`isReferenced: false`/not-in-use), unlike tenant soft-delete which has a real, live-user-
   facing consequence regardless of confirmation strength. Graduating confirmation strength to actual
   stakes (§18.4's own standard) means a provably-blast-radius-zero delete doesn't need the heavier
   pattern.
4. **The package↔feature association picker is a `Table.Root` with an inline checkbox + limit input
   per row, not a multi-select or card grid** — a table is the only one of the three that keeps a
   feature's optional numeric limit directly, visibly adjacent to its own enable checkbox without a
   second disconnected panel. Submitted via its own, separate "Save feature configuration" button
   (distinct from the package Details form's own "Save details" button) — two independent forms
   rather than one combined submit, so editing a package's price never risks silently resubmitting a
   possibly-stale picker state. See `docs/design/UX_GUIDELINES.md` §18.6 for the full write-up.
5. **The tenant-detail "AI model" panel computes the currently-effective model client-side from the
   already-fetched allowlist (`GET /api/platform/ai-models?includeDisabled=true`) plus the tenant's own
   `assignedAiModelId`, rather than adding a dedicated `GET /api/platform/tenants/:id/ai-model` read
   route** — the tenant summary already carries everything the panel needs (which model is assigned,
   if any; which allowlist model is currently default), so a new read endpoint would be pure
   duplication for one derived display line. `AiModelsService.resolveEffectiveModel` is still used, but
   only from the `PUT`/`DELETE` assignment routes' own response bodies (so the panel reflects the
   *result* of a save immediately without a second round-trip) — matching legacy's own identical
   "echo back `{effectiveModel}`" convention on its `PUT`/`DELETE .../ai-model` routes.
6. **`PlatformTenantRepository.setAssignedAiModel` added to the existing `platform/tenants` module
   (not duplicated inside `platform/ai-models`)** — the column being written (`tenant.
   assigned_ai_model_id`) belongs to `platform.tenant`, which `platform/tenants` already owns
   end-to-end; `AiModelsService` depends on `PlatformTenantRepository` (imported through its public
   barrel) the same one-directional way legacy's `AiModelsService` depended on
   `PlatformTenantRepository` — no cycle, since `platform/tenants` has zero knowledge of
   `platform/ai-models`.
7. **`ApprovedAiModelRepository.countTenantsAssigned` queries `platform.tenant` directly via its own
   `DataSource` (string-keyed `'tenant'`), rather than depending on `PlatformTenantRepository` for that
   one count** — mirrors `FeatureRepository`'s own already-established precedent (querying
   `package_feature` directly rather than depending on `PackageFeatureRepository`) for the identical
   reason: the entity lives in the shared, module-agnostic `infrastructure/database/platform/
   entities/**`, so a plain entity import carries no module-ownership implication, and reaching for it
   directly avoids a second `platform/ai-models`→`platform/tenants` dependency for a single read.
8. **`AiModelResolver` is a plain class with its own `dispose()` method, not `OnModuleDestroy`** (this
   app has no DI container/lifecycle hooks) — its periodic cache-sweep `setInterval` is `.unref()`'d
   (never keeps the Node process alive on its own, matching every other interval timer in this app),
   and `dispose()` exists purely so a unit test can construct-assert-teardown a resolver instance
   without leaking a live timer past the test (used by every `ai-model-resolver.test.ts` case's own
   `afterEach`).
9. **The `20260815000011-add-fk-tenant-assigned-ai-model.ts` migration only adds the FK constraint
   itself, not the column/index** — unlike legacy's equivalent migration (`AddAssignedAiModelToTenant
   1730000000015`), which added the column + index + FK together because legacy's `tenant` table
   didn't have the column yet at that point in its migration history. This app's own
   `20260815000001-create-tenant-table.ts` (Phase 1a) already created `assigned_ai_model_id` (nullable)
   and its `ix_tenant_ai_model` index as a documented forward reference — re-adding either here would
   error. Confirmed by reading that migration's own doc comment before writing this one, not assumed.
10. **This dispatch's own real-route integration test (`phase2b-platform-catalog-routes.integration.
    test.ts`) resets the platform default back to whatever it was *before* the test ran, dynamically
    read via a `GET` at the start of that test** (not hardcoded to the seeded
    `anthropic/claude-3.5-haiku` id) — the shared, reused `examland_platform_next` schema (Phase 1a's
    own established precedent: `demo-next`/smoke tenants left in place across dispatches) means a
    prior dispatch's own manual verification could plausibly have already changed the default; a
    hardcoded restore would silently overwrite a legitimate prior state instead of neutrally restoring
    whatever was actually there.
11. **A real, previously-latent test-fragility conflict found and fixed only by actually running the
    full real-browser verification pass** — sub-slice 1a's own `platform-migrations.integration.test.ts`
    asserted an *exact* total-row-count (`toBe(9)` features, `toBe(3)` packages, `toBe(1)` AI model)
    against `platform.feature`/`platform.package`/`platform.approved_ai_model`, an invariant that was
    only ever true because those tables had no write path yet (Phase 1a's own read-only scope). The
    instant this dispatch's own real Playwright smoke pass legitimately created and left in place
    `smoke2b-feat-*`/`smoke2b-pkg-*`/`smoke2b/model-*` rows (matching this project's own established
    "verification fixtures are reused across dispatches, not force-cleaned" precedent — the identical
    convention `demo-next`/`smoke2a-*` tenants already established), those three exact-count assertions
    broke — a real, direct consequence of this dispatch's own scope (Platform Admin catalog CRUD)
    finally exercising a table three prior dispatches' worth of tests had only ever seen as read-only.
    **Resolved by rewriting the assertions to check what's actually invariant now that a write path
    exists**: the exact 9 seeded feature keys / 3 seeded package keys / 27 seeded package-feature pairs
    still exist untouched (checked by key set, not raw count), plus `>=` bounds on the totals; exactly
    one `approved_ai_model` row currently has `is_platform_default = 1` (a real DB-level invariant
    regardless of table size) and the specific seeded `anthropic/claude-3.5-haiku` row still exists
    with its original shape; the seed-migration-is-idempotent re-run test now compares before/after
    counts rather than asserting a fixed total. Re-run clean (5/5) immediately after. This is the
    correct, forward-looking fix (the old exact-count assertions were already stale the moment any
    real CRUD existed over these tables) — not a workaround, and not a reason to have force-cleaned the
    dispatch's own real verification data instead.

### Exit gate

1. `next build` succeeds cleanly. **PASS.**
2. `eslint --max-warnings=0` clean, including a deliberately-added-then-reverted module-boundary
   violation for the new `platform/ai-models` module (`src/scratch-boundary-violation.ts` deep-imported
   `@/server/platform/ai-models/application/ai-models.service`, confirmed to fail with the expected
   `no-restricted-imports` message naming `PLATFORM_AI_MODELS_BARREL_ONLY`'s own text, then deleted;
   lint re-confirmed clean). **PASS.**
3. Migrations (platform only — no new tenant-schema migration this dispatch) run clean against real
   MySQL (`examland_platform_next` on the already-running `exam-4u-mysql-1` container, the same
   isolation-schema every prior phase uses): `platform-migrations.integration.test.ts` extended to
   assert all 11 migrations recorded (up from 8), the new `approved_ai_model` seed row's exact shape,
   and — the FK-migration-specific proof — that `fk_tenant_ai_model` genuinely exists in
   `information_schema.TABLE_CONSTRAINTS` (not just "the migration ran without throwing," which a
   malformed FK clause can silently no-op past on some MySQL configurations). **PASS**, 5/5 in that
   file (up from 4/4).
4. Unit tests for new pure-logic code: `FeaturesService`/`PackagesService` (fake-repository tests
   covering every validation rule/fail-closed invariant — key-shape rejection, `FEATURE_KEY_EXISTS`/
   `FEATURE_KEY_IMMUTABLE`/`FEATURE_IN_USE`/`FEATURE_NOT_FOUND`/`PACKAGE_KEY_EXISTS`/
   `PACKAGE_NOT_FOUND`, the atomic-replace's validate-before-write ordering), `AiModelsService`
   (every allowlist/assignment invariant: first-ever-approval-auto-default, `DEFAULT_MODEL_REQUIRED`/
   `MODEL_DISABLED`/`MODEL_IN_USE`(with exact tenant count)/`MODEL_NOT_APPROVED`, selective resolver
   invalidation), `AiModelResolver` (resolution order, caching, `invalidate(tenantId)` vs.
   `invalidate()`), and `isValidCatalogKey` — **PASS**, plus the full accumulated suite (see below).
5. Real end-to-end proof: booted the app for real (`next build` then `next start -p 3179`,
   `NODE_ENV=production`) against the already-running `exam-4u-mysql-1` container's
   `examland_platform_next` schema, and via a real Playwright Chromium browser
   (`apps/next/scripts/playwright-smoke.ts`, extended not replaced) proved — on top of every sub-slice
   2a assertion, still passing unchanged — a platform admin creates a feature through the real UI;
   creates a package through the real UI and associates that feature with it via the real atomic
   `PUT .../features` replace; approves a new AI model allowlist entry through the real UI; navigates
   to the real, Phase-1-seeded `demo-next` tenant and assigns it to the new model through the real UI;
   confirms the assignment survives a **hard page reload** (proving real MySQL persistence, not
   client-side-only state); resets `demo-next` back to the platform default afterward (smoke-run
   cleanup, matching this project's own "don't leave shared smoke fixtures in a surprising state"
   discipline). Zero console errors across every page load in the run. **PASS.**
6. Legacy containers (`exam-4u-api-1`, `-worker-1`, `-mysql-1`, `-qdrant-1`, `-mailhog-1`) completely
   undisturbed. **PASS** — `docker ps` diffed before/after every verification step (unit/integration
   tests, the real `next start` boot, and the real-browser Playwright pass); only uptime counters
   progressed naturally, no restarts/rebuilds/recreations.

### Verification evidence

**Automated tests**: `486` tests green (up from Phase 2a's final `392` — this dispatch adds 94 across
9 new test files: 14 in `features.service.test.ts`, 16 in `packages.service.test.ts`, 22 in
`ai-models.service.test.ts`, 8 in `ai-model-resolver.test.ts`, 8 in `catalog-key.util.test.ts`, 5 in
`features-api.test.ts`, 5 in `packages-api.test.ts`, 9 in `ai-models-api.test.ts`, and 6 real-route
integration tests in `phase2b-platform-catalog-routes.integration.test.ts` — plus the existing
`platform-migrations.integration.test.ts` extended with 1 new AI-model/FK assertion and 3 of its
pre-existing catalog-count assertions rewritten (see "Decisions made" #11 for the real, found-by-
actually-running-the-full-verification-pass reason those three needed rewriting, not just extending),
still 5 tests total in that file), run with the same
`DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next
JWT_TENANT_SECRET=... JWT_PLATFORM_SECRET=... FILE_SIGNING_SECRET=...` sub-slice 2a used. Coverage
(`vitest run --coverage`): **93.01% statements / 91.02% branch / 89.98% functions / 93.01% lines**
overall — clears the "≥80%" bar comfortably; every new `lib/platform-console/{features,packages,
ai-models}-api.ts` file is at 100% statements/branch/functions/lines; `server/platform/ai-models/**`
overall 96-100% across every sub-directory; `server/platform/billing/application/{features,
packages}.service.ts` both at 97.5%+/100% statements after two small targeted additions
(`listActive`/valid-key-change-path tests) closing an initially-lower functions-coverage gap on
`packages.service.ts`. 64/64 test files green, zero flakes observed in three consecutive full runs.

**Real end-to-end HTTP + browser pass**: `next build` then `next start -p 3179` (`NODE_ENV=production`)
against `examland_platform_next`, with a platform admin created via a direct (bcrypt-hashed,
scratchpad-only script, deleted after use) verification helper mirroring sub-slice 2a's own identical
technique (no self-service platform-admin signup route exists, by design).
`apps/next/scripts/playwright-smoke.ts` drove a real Chromium browser through every sub-slice 2a
assertion (unchanged, still green) followed by this dispatch's own 7 new assertions. Full transcript
(new assertions only — the full 15-assertion transcript, sub-slice 2a's 8 plus this dispatch's 7, all
passed):

```
PASS: created feature 'smoke2b-feat-msuec0yq' through the real UI
PASS: created package 'smoke2b-pkg-msuec0yq' through the real UI
PASS: associated feature 'smoke2b-feat-msuec0yq' with package 'smoke2b-pkg-msuec0yq' through the real UI (atomic replace)
PASS: approved AI model 'smoke2b/model-msuec0yq' through the real UI
PASS: assigned AI model 'smoke2b/model-msuec0yq' to the real 'demo-next' tenant through the real UI
PASS: AI model assignment persisted across a hard reload (confirmed real DB state, not client-only)
PASS: reset 'demo-next' back to the platform-default AI model (smoke-run cleanup)
PASS: zero console errors across every page load in this run
```

A real bug was found and fixed during this pass (not a pre-existing, out-of-scope defect): the
script's initial `page.getByText('demo-next').click()` attempted to click the tenant list's
*subdomain* cell text (a plain, non-link `<Table.Cell>`), not the *name* column's actual link — a
substring match against ambiguous/non-interactive text, not a real navigation trigger. Fixed by
locating the specific table row via its unambiguous subdomain-cell text
(`page.locator('tr', { hasText: 'demo-next.examland.app' })`) and clicking the `Link` within that row
specifically — re-run clean immediately after.

`docker ps` diffed before/after every step above (unit/integration test runs, the `next start` boot,
and the Playwright pass) — only uptime counters on `exam-4u-api-1`/`-worker-1`/`-mysql-1`/`-qdrant-1`/
`-mailhog-1` progressed naturally; no container restarted, stopped, or was added/removed.

### Verification artifacts left in the shared dev MySQL instance

Matching every prior sub-dispatch's own established precedent, this dispatch's own real-HTTP-pass rows
were **not** force-cleaned afterward: a `phase2b-verify-admin@examland.local` platform admin (known
password, scratchpad-script-created, script itself deleted after use) remains in
`examland_platform_next`, alongside a handful of `smoke2b-*`-prefixed features/packages/AI-model
allowlist rows created across this dispatch's own Playwright runs. `demo-next`'s AI model assignment
was explicitly reset back to the platform default before the run ended (see the smoke script's own
final step) — it is not left pointing at a throwaway smoke-created model. Harmless, real,
already-exercised dev-verification data, consistent with this migration's own iterative-phase-by-phase
shared-schema reality.

## Status

**Sub-slice 2b complete.** All 6 exit-gate items pass (see "Verification evidence" above). 486 tests
green (up from Phase 2a's final 392), 93.01%/91.01% statement/branch coverage overall,
`next build`/`eslint --max-warnings=0`/`tsc --noEmit` all clean, legacy containers confirmed
undisturbed throughout (including the real `next start` boot and the real-browser Playwright pass).
One real, previously-latent test-script bug (the smoke script's own ambiguous tenant-row click target)
was found and fixed during this dispatch's own real-browser pass — the same "find it by actually
running the thing" discipline every prior phase's own dispatch already established, this time
surfacing in the test tooling itself rather than product code.

**Explicitly not done this dispatch** (see "Scope" above for the full list): `platform/billing`
(Stripe) and `reassignSubscription`, `platform/audit`, `platform/reliability` dashboards,
`TenantMaintenanceWorker`, `platform.audit_log` writes on any new route, `AiModelResolver`'s
consumption by an actual LLM call path (Phase 5), a tenant-realm `GET /api/tenant/ai-model` read
endpoint, and `PLATFORM_BILLING_BARREL_ONLY`'s still-bare ESLint pattern (flagged, not yet triggered,
for the Stripe sub-dispatch to check).

Next Phase 2 sub-dispatch: `platform/billing` (Stripe integration — Checkout Session creation,
webhook-driven status transitions, `reassignSubscription`), `platform/audit` (the `platform.audit_log`
write path every mutating route across sub-slices 2a/2b has deliberately deferred, plus retrofitting
audit writes onto those already-shipped routes once the module exists), `platform/reliability`
dashboards, and `TenantMaintenanceWorker`. `platform/billing`'s write path and `reassignSubscription`
naturally belong together per Phase 1a's own "Decisions made" #2 establishing `server/platform/billing`
as their shared home (already true today for packages/features — this sub-dispatch's own work already
lives there).

`current_phase` in `docs/NEXUS_STATE.md` remains `development` (unchanged) — this migration is tracked
via this plan file and the `migration_plan` state line, not the old backlog-phase numbering; Phase 2
overall is not yet complete (four more item groups remain: billing/Stripe, audit, reliability
dashboards, TenantMaintenanceWorker).

## Sub-slice 2c — `platform/billing` Stripe integration (Checkout Session creation, webhook-driven
status transitions, `reassignSubscription`)

**Goal**: a Platform Admin can, through the real browser, view a tenant's current subscription
(package/price/status), reassign it directly to a different active package without Stripe, and create
a real Stripe Checkout Session for a tenant — with the webhook-driven half (`checkout.session.
completed`/`customer.subscription.updated`/`customer.subscription.deleted`) atomically updating the
tenant's subscription status/package once Stripe (or a genuinely-signed test event) confirms it —
proven via real MySQL, real HTTP, a real running `next start` server, and real Stripe SDK signature
verification (no live Stripe account available in this environment — see "Decisions made" below).

**Backlog item(s)**: none — tracked via this plan file, matching every prior sub-dispatch's own framing.

### Scope

**In scope** (per the dispatch prompt's own enumerated item list):
1. `PaymentGatewayPort` (`server/common/ports/payment-gateway.port.ts`) + `StripePaymentGatewayAdapter`
   (`server/infrastructure/payments/{stripe.adapter.ts,index.ts}`, new module with its own
   `PAYMENTS_BARREL_ONLY` ESLint rule) — ported logic from
   `legacy/api/src/infrastructure/payments/stripe.adapter.ts` and
   `legacy/api/src/platform/billing/domain/ports/payment-gateway.port.ts`. The port is deliberately
   relocated to `common/ports/` rather than a `platform/billing/domain/ports/**` subfolder — see
   "Decisions made" #1.
2. `BillingCheckoutService` (`server/platform/billing/application/billing-checkout.service.ts`) —
   Platform-Admin-initiated Checkout Session creation: `ensureCustomer` reuse (persists a newly-minted
   Stripe customer id to `tenant_subscription.provider_customer_id` on first use only),
   `BILLING_NOT_CONFIGURED` 503 when `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are empty,
   `PackageInactiveError`/`PackageNotFoundError` guards, package pricing/id carried through Stripe
   session metadata (`packageId`/`packageKey`/`packageName`/`priceCents`/`currency`) so the webhook can
   apply the upgrade on completion.
3. `BillingWebhookService` (`server/platform/billing/application/billing-webhook.service.ts`) +
   `POST /api/platform/billing/webhook` Route Handler (`app/api/platform/billing/webhook/route.ts`) —
   raw-body (`request.text()`) signature verification via the real Stripe SDK
   (`stripe.webhooks.constructEvent`), dispatching `checkout.session.completed` (activates + applies
   the metadata-carried package), `customer.subscription.updated` (fail-toward-restrictive status
   mapping + billing-period dates), `customer.subscription.deleted` (unconditional `CANCELED`); any
   other event type is logged and ignored (still `200`, per FR-PKG-6's "Stripe must never retry a
   condition that will never resolve" rule). Deliberately **unauthenticated** — guarded entirely by the
   signature check, never `withPlatformAuth` — matching legacy's own `BillingWebhookController` design.
4. `SubscriptionAdminService` (`server/platform/billing/application/subscription-admin.service.ts`) —
   `reassign` (direct, non-Stripe package reassignment, preserving the subscription's existing status)
   and `getSummary` (the tenant-detail billing panel's read path) — ported from legacy's
   `SubscriptionAdminService`, minus the `getSubscriptionWithUsage` usage-snapshot half (see "Decisions
   made" #2 for why).
5. `TenantSubscriptionRepository` write methods added (`server/platform/billing/infrastructure/
   tenant-subscription.repository.ts`): `findByProviderSubscriptionId`, `setProviderCustomerId`,
   `markActiveFromCheckout`, `updateStatusAndPeriod`, `markCanceled` — all ported verbatim in logic from
   legacy's identically-named methods, all parameterized (no raw string-concatenated queries).
6. New Route Handlers, all `withPlatformAuth`-gated except the webhook (item 3): `GET`/`PUT
   /api/platform/tenants/:id/billing` (billing summary read / direct reassign) and `POST /api/platform/
   tenants/:id/billing/checkout-session` (Stripe Checkout Session creation) — all resolve `id` first via
   `TenantsService.get` for the `404 TENANT_NOT_FOUND` check (owned by `platform/tenants`, not
   `platform/billing`, matching this app's established cross-module-error-ownership convention).
7. `server/platform/billing/index.ts` barrel extended with composition roots (`getBillingCheckoutService`,
   `getBillingWebhookService`, `getSubscriptionAdminService`) and `resolveCheckoutRedirectTemplates` (the
   `{tenantId}`-templated success/cancel URL derivation — see "Decisions made" #3 for why the derived
   default differs from legacy's own).
8. Chakra v3 UI: a new "Billing" panel on the existing tenant-detail page
   (`app/platform/(console)/tenants/[id]/page.tsx`), additive alongside the already-shipped "AI model"
   panel (sub-slice 2b) — read-only subscription summary, a package-selection `NativeSelect` (active
   packages only) feeding two buttons ("Reassign package" / "Create checkout session") — see
   `docs/design/UX_GUIDELINES.md` §18.8 for the full flow/copy write-up.
9. `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_CHECKOUT_SUCCESS_URL`/`STRIPE_CHECKOUT_CANCEL_URL`
   added to `env.schema.ts`, all optional/defaulting to `''` — empty is a fully supported "billing
   disabled" deployment shape, never a boot-time failure. A new cross-field invariant (ported verbatim
   from legacy): the two secrets must be set or empty *together*, checked in every environment.
10. `PLATFORM_BILLING_BARREL_ONLY`'s ESLint pattern fixed from a bare `**/platform/billing/**` to
    `**/server/platform/billing/**` — the exact latent gap sub-slice 2b's own "Explicitly out of scope"
    note flagged as still-latent-but-not-yet-triggered for this dispatch to check; confirmed it really
    would have blocked this dispatch's own `app/api/platform/billing/webhook/route.ts` import before
    fixing it (see "Decisions made" #4).
11. New `apps/next/.eslintrc.cjs` `PAYMENTS_BARREL_ONLY` module-boundary rule for the new
    `infrastructure/payments` module, scoped correctly (`**/server/infrastructure/payments/**`) from the
    very first commit — avoiding the exact class of gap item 10 just fixed for `platform/billing`.
12. `apps/next/package.json` — new dependency `stripe` (`^22.4.0`, pinned to the same version
    `legacy/api` already depends on, already present in the shared `node_modules` via npm workspaces
    hoisting, confirmed via `npm ls stripe --workspaces` before adding).
13. `apps/next/scripts/playwright-smoke.ts` extended (not replaced) with the new Phase 2c flow: billing
    panel renders the real, provisioning-created subscription; reassign `demo-next` to `Pro` and back to
    `Starter` through the real UI with a hard-reload persistence proof; "Create checkout session"
    surfaces the real `BILLING_NOT_CONFIGURED` toast for this genuinely-unconfigured deployment — every
    sub-slice 2a/2b assertion above it in the script is left intact.
14. New real-route integration tests: `phase2c-platform-billing-routes.integration.test.ts` (reassign/
    checkout-session routes, TENANT_NOT_FOUND/PACKAGE_NOT_FOUND/PACKAGE_INACTIVE, plus a real-MySQL
    `BillingCheckoutService` DB-persistence proof against a fake `PaymentGatewayPort`) and
    `phase2c-billing-webhook.integration.test.ts` (the real webhook Route Handler, real Stripe SDK
    signature verification, real atomic DB writes for all three handled event types) — see "Decisions
    made" #5/#6 for why these are two separate files and how the second one's env-override actually
    works.

**No new tenant-schema/platform-schema migration** — `platform.tenant_subscription`'s
`provider_customer_id`/`provider_subscription_id`/`current_period_start`/`current_period_end` columns
already existed from Phase 1a's own `20260815000004-create-tenant-subscription-table.ts` (full-shape
DDL, ported verbatim from legacy at that time even though only the read path was needed then) —
confirmed by reading that migration before assuming a new one was needed, exactly as the dispatch
prompt anticipated ("check its columns first").

**Explicitly out of scope for this dispatch** (deferred, per the dispatch prompt's own framing):
- Self-serve tenant-initiated checkout (`legacy`'s `tenant-billing.controller.ts`'s own surface) — Phase
  9's job per the migration plan. `BillingCheckoutService.createCheckoutSession`'s `redirectUrls`
  parameter is kept generic enough for that later phase to reuse unchanged (ported verbatim from
  legacy's identical forward-looking design), but no tenant-realm route calls it this dispatch.
- `platform/audit`, `platform/reliability` dashboards, `TenantMaintenanceWorker` — the next Phase 2
  sub-dispatch (see this section's own closing note).
- `platform.audit_log` writes on any of this dispatch's new mutating routes/webhook handler —
  `platform/audit` doesn't exist in this app yet; `BillingWebhookService`'s own doc comment explicitly
  flags this deferral (matching sub-slices 2a/2b's identical convention for every prior new mutating
  surface) rather than silently omitting it.
- `getSubscriptionWithUsage`'s feature-usage-snapshot half — `platform/usage`/`FeatureUsageService`
  don't exist in this app yet (feature-usage enforcement is a later phase's scope); `SubscriptionAdminService.getSummary`
  only returns the subscription/package half of legacy's combined shape (see "Decisions made" #2).
- Rate limiting on `POST /api/platform/billing/webhook` or the checkout-session route — flagged, not
  silently shipped: this app has no rate-limiting infrastructure anywhere yet (confirmed: neither
  Phase 1b's `auth`/password-reset routes nor any other mutating route across Phase 1/2 has one either)
  — a pre-existing, app-wide gap this dispatch's own narrow scope doesn't newly introduce or is
  positioned to fix alone. Flagged here for whichever future dispatch adds a cross-cutting rate-limit
  mechanism to check this surface specifically (a webhook endpoint is a plausible target for abuse —
  every signature-verification failure still costs a real HMAC computation).

### Decisions made (LLD/plan silent, or a genuine judgment call — smallest-reasonable-choice standard)

1. **`PaymentGatewayPort` lives in `server/common/ports/`, not `platform/billing/domain/ports/**`
   (legacy's own placement)** — this app's module-boundary ESLint rules forbid a module from
   deep-importing another module's `domain/**`; legacy's placement works there because NestJS's DI
   container binds the interface and the concrete adapter together regardless of which module's
   `domain/` folder the interface file physically lives in. This app has no DI container — the concrete
   adapter (`infrastructure/payments`) and the interface need to be reachable from both without either
   importing the other's protected internals. `common/ports/` already holds the identical-shaped
   `StoragePort`/`PasswordHasherPort` for the exact same reason (see those files' own doc comments) —
   this follows that established precedent rather than inventing a third pattern.
2. **`SubscriptionAdminService.getSummary` returns only the subscription/package half of legacy's
   `getSubscriptionWithUsage` combined shape** — legacy's method also returned a feature-usage snapshot
   via `FeatureUsageService`, but no `platform/usage` module exists in this app yet (feature-usage
   enforcement isn't in the migration plan's Phase 0-2 item list at all). Rather than block this
   dispatch's billing-panel read path on building an unrelated module, `getSummary` returns just what
   the billing panel needs today; a later phase building `platform/usage` can extend the return shape
   (or add a sibling method) without needing to change `reassign`'s own contract.
3. **The derived default Checkout redirect-URL template is `https://{PUBLIC_APEX_DOMAIN}/platform/
   tenants/{tenantId}?checkout=...`, not legacy's `https://admin.{PUBLIC_APEX_DOMAIN}/tenants/
   {tenantId}?checkout=...`** — legacy's Angular platform console lived on a separate, reserved `admin.`
   subdomain; this app's own platform console lives at a real `/platform/**` URL path on the *same*
   origin (Phase 2 sub-slice 2a's own "Decisions made" #1, `docs/design/UX_GUIDELINES.md` §18.1a) — no
   `admin.` subdomain exists in this app's routing convention at all. The derived default was updated to
   match this app's actual URL shape rather than porting legacy's now-inapplicable one verbatim; an
   operator can still override both via `STRIPE_CHECKOUT_SUCCESS_URL`/`_CANCEL_URL` regardless.
4. **`PLATFORM_BILLING_BARREL_ONLY`'s bare `**/platform/billing/**` pattern fixed to
   `**/server/platform/billing/**`, confirmed via a deliberately-added-then-reverted violation before
   and after the fix** — sub-slice 2b's own "Explicitly out of scope" note predicted this exact
   dispatch would trip it (`app/api/platform/billing/webhook/route.ts`'s path contains the literal
   segment sequence `platform/billing`), and it did: before the fix, this dispatch's own webhook route
   file failed lint with the barrel-only restriction firing on its own new file. Fixed the same way
   `PLATFORM_TENANTS_BARREL_ONLY`/`PROFILE_BARREL_ONLY` were already fixed for the identical class of
   gap (narrowed, not loosened, to `server/platform/billing/**`).
5. **The webhook's real-HTTP proof lives in its own file
   (`phase2c-billing-webhook.integration.test.ts`), separate from
   `phase2c-platform-billing-routes.integration.test.ts`** — the webhook proof needs
   `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` genuinely non-empty for this file's own `getEnv()`
   singleton (so the real `StripePaymentGatewayAdapter.verifyAndParseWebhook` actually runs, not a
   short-circuited `BILLING_NOT_CONFIGURED`), which would make the sibling file's own
   `BILLING_NOT_CONFIGURED`-against-the-real-unconfigured-deployment assertions no longer reflect this
   deployment's real (genuinely empty) Stripe config. Vitest's default per-file worker isolation means
   neither file's `process.env`/`globalThis` mutations leak into the other.
6. **A real, previously-latent test-infrastructure gotcha found and fixed while building this exact
   env-override test setup (not a pre-existing, out-of-scope defect)**: a plain
   `process.env.STRIPE_SECRET_KEY = '...'` statement placed textually *before* a file's own `import`
   lines does **not** reliably take effect before those imports' own top-level side effects run, because
   ES module `import` declarations are hoisted and fully evaluated before any of the importing module's
   own top-level statements — regardless of textual position. Concretely: `server/logging/index.ts`
   constructs its `logger` singleton eagerly at module scope (`export const logger = getLogger();`), and
   `server/infrastructure/database/index.ts` imports `server/logging` at its own top level — so merely
   importing `getPlatformDataSource` anywhere in a test file transitively forces `getEnv()`'s first-ever
   call (caching an *empty* `STRIPE_SECRET_KEY`) before that file's own top-level `process.env.X = ...`
   line ever runs. Root-caused via a live, from-scratch minimal repro (isolating exactly which import
   triggered the eager call, confirmed via a temporary stack-trace patch to `getEnv()` itself, reverted
   after). **Fixed** by resetting the cached `globalThis.__examlandEnv` singleton explicitly inside
   `beforeAll`, immediately after setting the `process.env` overrides — robust regardless of which
   module's import graph happens to trigger `getEnv()`'s first call, unlike relying on import-hoisting
   order. This is a test-infrastructure-only finding (no production code path was affected — every
   *real* consumer of `getEnv()` in this app is a lazily-invoked function, matching the established
   composition-root convention; only this test file's own env-override technique needed the fix).

### Verifying against real Stripe (per the dispatch prompt's explicit instruction)

**No live Stripe test-mode API key is available in this environment** — confirmed by checking every
plausible source before assuming so: `.env`/`.env.example`/`legacy/api`'s own config all ship
`STRIPE_SECRET_KEY=`/`STRIPE_WEBHOOK_SECRET=` genuinely empty; this sandbox also has no outbound
internet access at all (`curl -m 5 https://api.stripe.com/...` → connection failure, confirmed directly
before deciding not to attempt a live-network browser assertion). Verified instead via the dispatch
prompt's own explicitly-authorized fallback, in three complementary layers:

1. **Fake-but-realistic `PaymentGatewayPort` unit tests** (`billing-checkout.service.test.ts`,
   `billing-webhook.service.test.ts`, `subscription-admin.service.test.ts`) — every guard condition,
   status-mapping branch, and DB-write-shape assertion, mirroring
   `legacy/api/src/platform/billing/application/*.spec.ts`'s own equivalent fake-repository/fake-gateway
   test doubles.
2. **Real Stripe SDK signature verification, no live account needed**
   (`server/infrastructure/payments/stripe.adapter.test.ts`) — `Stripe.webhooks.
   generateTestHeaderString`/`constructEvent` are both pure local cryptography (HMAC-SHA256 + timestamp/
   replay-window checking), never a network call — so this suite exercises the *real*, unmocked
   `StripePaymentGatewayAdapter.verifyAndParseWebhook` against a genuinely valid signature, a wrong
   secret, a tampered payload, a garbage header, and an expired timestamp, exactly mirroring
   `legacy/api/src/infrastructure/payments/stripe.adapter.spec.ts`'s identical "security-critical, full
   real-SDK verification" standard.
3. **Real HTTP + real MySQL + a real, separately-booted `next start` server**, split by what each proof
   actually needs real network access for:
   - `phase2c-platform-billing-routes.integration.test.ts`/the Playwright smoke pass: this deployment's
     *actual* unconfigured state (`BILLING_NOT_CONFIGURED` 503 through the real Route Handler and the
     real browser UI, both genuinely reflecting this environment) plus a real-MySQL
     `BillingCheckoutService` DB-persistence proof (provider-customer-id write) against a fake gateway
     (no live Stripe API call needed for a pure DB-write assertion).
   - `phase2c-billing-webhook.integration.test.ts` + a second, separately-booted `next start` instance
     (port 3180, fake-but-non-empty `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` — construction alone
     never contacts Stripe's servers) proving the real webhook Route Handler end to end: a genuinely
     Stripe-SDK-signed `checkout.session.completed`/`customer.subscription.updated`/`customer.
     subscription.deleted` event, sent via genuine HTTP to the live server, atomically updating real
     MySQL rows, plus a real `401` for a bad signature — all without ever reaching Stripe's actual API.

This satisfies the dispatch's own explicit standard ("a real integration test against a fake-but-
realistic `PaymentGatewayPort`... plus a real HTTP round-trip proving the Route Handlers/DB-write path
work") layer by layer, and goes one step further for the webhook specifically (a genuinely-signed event
through the real, separately-running production server) since Stripe's own signature verification is
provably network-independent. **Not verified, and explicitly flagged rather than silently assumed
equivalent**: a real network call to Stripe's actual Checkout/Customers API
(`ensureCustomer`/`createCheckoutSession`'s HTTP layer itself) — this would require a genuine Stripe
test-mode account, which this environment does not have access to provision.

### Exit gate

1. `next build` succeeds cleanly. **PASS** — including every new route
   (`app/api/platform/billing/webhook`, `app/api/platform/tenants/[id]/billing`,
   `app/api/platform/tenants/[id]/billing/checkout-session`) compiled and listed in the route manifest.
2. `eslint --max-warnings=0` clean, including a deliberately-added-then-reverted module-boundary
   violation proving both `PLATFORM_BILLING_BARREL_ONLY`'s newly-narrowed pattern and the brand-new
   `PAYMENTS_BARREL_ONLY` pattern actually fire (`src/scratch-boundary-violation.ts` deep-imported
   `@/server/platform/billing/application/billing-checkout.service` and
   `@/server/infrastructure/payments/stripe.adapter`, confirmed both fail with their expected
   `no-restricted-imports` messages, then deleted; lint re-confirmed clean). **PASS.**
3. No new migrations this dispatch (confirmed unnecessary — see "Scope" above); the pre-existing
   platform-migrations suite is unaffected. **N/A, confirmed rather than skipped.**
4. Unit tests for new pure-logic code: `BillingCheckoutService` (every guard/ordering/redirect-template
   case), `BillingWebhookService` (signature-failure non-disclosure, all three event types' full
   dispatch/status-mapping/edge-case matrix), `SubscriptionAdminService` (reassign guards, summary
   projection/degradation), `StripePaymentGatewayAdapter` (real-SDK signature verification, lazy-client
   guard, cached-client reuse, metadata stamping), and the new `env.schema.ts` Stripe cross-field
   invariant — **PASS**, plus the full accumulated suite (see below).
5. Real end-to-end proof (real MySQL + real HTTP, real browser via extended `scripts/playwright-smoke.ts`
   plus two dedicated real-HTTP verification passes) — see "Verifying against real Stripe" above and
   "Verification evidence" below for the full transcript. **PASS.**
6. Legacy containers (`exam-4u-api-1`, `-worker-1`, `-mysql-1`, `-qdrant-1`, `-mailhog-1`) completely
   undisturbed. **PASS** — `docker ps` diffed before/after every verification step (unit/integration test
   runs, both real `next start` boots on ports 3179/3180, and the Playwright pass); only uptime counters
   progressed naturally, no restarts/rebuilds/recreations.

### Verification evidence

**Automated tests**: `557` tests green across `71` test files (up from sub-slice 2b's `486`/`63`) — this
dispatch adds 71 across 6 new test files: 9 in `billing-checkout.service.test.ts`, 20 in
`billing-webhook.service.test.ts`, 8 in `subscription-admin.service.test.ts`, 11 in
`stripe.adapter.test.ts`, 5 in `env.schema.test.ts`'s new Stripe-specific cases, 3 in
`billing-api.test.ts`, plus 8 real-route integration tests in
`phase2c-platform-billing-routes.integration.test.ts` and 7 in
`phase2c-billing-webhook.integration.test.ts`. Run with the same
`DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next
JWT_TENANT_SECRET=... JWT_PLATFORM_SECRET=... FILE_SIGNING_SECRET=...` every prior sub-slice used.
Coverage (`vitest run --coverage`): **93.60% statements / 91.70% branch / 90.87% functions / 93.60%
lines** overall — clears the "≥80%" bar comfortably; every new file at or above the established bar:
`infrastructure/payments/**` 100%/100%/100%/100%, `billing-checkout.service.ts` 100%/100%/100%/100%,
`billing-webhook.service.ts` 100%/100%/100%/100%, `subscription-admin.service.ts` 100%/94.44%/100%/100%,
`tenant-subscription.repository.ts` 100%/100%/100%/100% (up from its Phase 1a starting point — every
new write method exercised by the real-MySQL integration tests), new client-side `lib/platform-console/
billing-api.ts` 100%/100%/100%/100%. 71/71 test files green, zero flakes observed across three
consecutive full runs (including the from-scratch env-ordering debugging pass described in "Decisions
made" #6, which itself ran the affected file repeatedly while diagnosing).

**Real end-to-end HTTP + browser pass**: `next build` then two separate `next start` boots
(`NODE_ENV=production`) against `examland_platform_next` on the already-running `exam-4u-mysql-1`
container:
- Port 3179 (no Stripe env — this deployment's actual, real state): a platform admin created via a
  direct (bcrypt-hashed, scratchpad-only script, deleted after use) verification helper mirroring every
  prior sub-slice's identical technique. `apps/next/scripts/playwright-smoke.ts` (extended, not
  replaced — every sub-slice 2a/2b assertion still passes unchanged) drove a real Chromium browser
  through the billing panel showing `demo-next`'s real, provisioning-created `Starter`/`ACTIVE`
  subscription; reassigning it to the seeded `Pro` package through the real UI (no Stripe); confirming
  the reassignment survives a hard page reload (real MySQL persistence); clicking "Create checkout
  session" and confirming the real `BILLING_NOT_CONFIGURED` toast appears (this deployment's genuinely
  correct, unconfigured-Stripe behavior); resetting `demo-next` back to `Starter` afterward (smoke-run
  cleanup). Full transcript (new assertions only — the full accumulated transcript, sub-slices 2a's 8 +
  2b's 7 + this dispatch's 6, all passed):
  ```
  PASS: billing panel renders the real, provisioning-created subscription (Starter/ACTIVE)
  PASS: reassigned 'demo-next' to the 'Pro' package through the real UI (no Stripe)
  PASS: package reassignment persisted across a hard reload (confirmed real DB state, not client-only)
  PASS: "Create checkout session" surfaces the real BILLING_NOT_CONFIGURED toast for this genuinely-unconfigured deployment
  PASS: reset 'demo-next' back to the 'Starter' package (smoke-run cleanup)
  PASS: zero console errors across every page load in this run
  ```
  One real, previously-latent test-tooling gap found and fixed during this pass (not a pre-existing,
  out-of-scope defect): Chromium's own automatic `console.error`-type "Failed to load resource: 503"
  log line — triggered for the first time by this dispatch's own deliberate `BILLING_NOT_CONFIGURED`
  assertion, since no prior phase's smoke script had ever provoked a non-2xx fetch response — was
  correctly distinguished from a genuine application error and filtered by its own fixed, generic
  Chromium-native text (never application-specific), so any other unexpected console error still fails
  the check exactly as before.
- Port 3180 (fake-but-non-empty `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, a separate boot of the
  identical build — this app reads Stripe config at runtime via `getEnv()`, never bakes it into the
  build): a scratchpad-only script (deleted after use) logged in as the same verification admin, created
  a real tenant + package via the real HTTP API, sent a genuinely Stripe-SDK-signed
  `checkout.session.completed` event to the live `POST /api/platform/billing/webhook`, and confirmed via
  a follow-up real `GET .../billing` call that the tenant's subscription atomically updated to the
  target package/`ACTIVE` status with a real provider-customer-id recorded; a second request with a
  garbage signature confirmed the real `401 WEBHOOK_SIGNATURE_INVALID` response. Full transcript:
  ```
  Created tenant <uuid> Active
  Created package <uuid>
  Webhook response status: 200 {"received":true}
  Billing summary after webhook: {"subscription":{"packageId":"<pkg-id>", ..., "status":"ACTIVE","hasProviderCustomer":true}}
  Bad-signature response status: 401 {"error":{"code":"WEBHOOK_SIGNATURE_INVALID", ...}}

  ALL REAL-HTTP WEBHOOK ASSERTIONS PASSED against the live next start server (port 3180).
  ```

Security self-review (per this app's own established checklist): every new mutating route is
`withPlatformAuth`-gated except the webhook, which is deliberately unauthenticated and guarded solely by
Stripe's own signature verification (documented, matching legacy's identical design — never
unauthenticated-*by-omission*); every input is server-side type/shape-validated
(`requireString('packageId', ...)`) before any business-rule check runs; no raw string-concatenated
queries anywhere (every new repository method is parameterized TypeORM, string-table-name-keyed per
this app's own cross-webpack-bundle-entity-identity fix); no secret/credential in committed code
(`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` read only via `getEnv()`; every test file uses obviously-
fake placeholder values); API responses return only the documented summary shape (`hasProviderCustomer`
is a boolean flag, never the raw Stripe customer/subscription id); the webhook's `401
WEBHOOK_SIGNATURE_INVALID` message is verified (unit + real HTTP) to never leak which check failed;
`platform.audit_log` writes are deliberately deferred (no `platform/audit` module exists yet, flagged
per-route in every new mutating handler's own doc comment, matching sub-slices 2a/2b's identical
convention) — the one open finding is the pre-existing, app-wide **absence of rate limiting** on any
mutating/auth-adjacent route including this dispatch's webhook endpoint, flagged (not silently shipped)
in "Explicitly out of scope" above for a future cross-cutting dispatch to address, since it is not a
regression this dispatch introduced and fixing it here would require inventing a rate-limiting
mechanism for the whole app, out of proportion to this dispatch's own scope.

`docker ps` diffed before/after every step above (unit/integration test runs, both real `next start`
boots on ports 3179/3180, and the Playwright pass) — legacy `exam-4u-api-1`/`-worker-1`/`-mysql-1`/
`-qdrant-1`/`-mailhog-1` completely undisturbed throughout, only uptime counters advanced.

### Verification artifacts left in the shared dev MySQL instance

Matching every prior sub-dispatch's own established precedent, this dispatch's own real-HTTP-pass rows
were **not** force-cleaned afterward: a `phase2c-verify-admin@examland.local` platform admin (known
password, scratchpad-script-created) remains in `examland_platform_next`, alongside a `P2C Webhook HTTP
Verify` tenant (`t_p2cwh_*` schema) and its associated package created during the port-3180 webhook
verification pass. `demo-next`'s subscription was explicitly reset back to `Starter` before the
Playwright run ended (matching sub-slice 2b's own identical "don't leave shared smoke fixtures in a
surprising state" discipline) — it is not left pointing at a throwaway `Pro` reassignment. Harmless,
real, already-exercised dev-verification data, consistent with this migration's own iterative-
phase-by-phase shared-schema reality.

## Status

**Sub-slice 2c complete.** All 6 exit-gate items pass (see "Verification evidence" above). 557 tests
green (up from sub-slice 2b's 486), 93.60%/91.70% statement/branch coverage overall,
`next build`/`eslint --max-warnings=0`/`tsc --noEmit` all clean, legacy containers confirmed undisturbed
throughout (including both real `next start` boots and the real-browser Playwright pass). One real,
previously-latent ESLint module-boundary gap (`PLATFORM_BILLING_BARREL_ONLY`'s bare pattern, already
flagged by sub-slice 2b as a predicted risk for this exact dispatch) and one real, previously-latent
test-infrastructure gotcha (the `process.env`-before-import ordering assumption, root-caused via a live
minimal repro and fixed by resetting the cached `getEnv()` singleton explicitly) were both found and
fixed — the same "find it by actually running the thing, not just building/typechecking it" discipline
every prior phase's own dispatch already established.

**Explicitly not done this dispatch** (see "Scope" above for the full list): self-serve tenant-initiated
checkout (Phase 9), `platform/audit`, `platform/reliability` dashboards, `TenantMaintenanceWorker`,
`platform.audit_log` writes on any new route/webhook handler, the feature-usage-snapshot half of the
billing summary (no `platform/usage` module yet), rate limiting on the webhook/checkout-session routes
(a pre-existing, app-wide gap, flagged not fixed), and a genuine live-network Stripe API call proof
(`ensureCustomer`/`createCheckoutSession`'s HTTP layer) — no live Stripe test-mode account or outbound
internet access is available in this environment (both confirmed directly, not assumed).

Next Phase 2 sub-dispatch (the last one — closes out Phase 2): `platform/audit` (the `platform.
audit_log` write path every mutating route across sub-slices 2a/2b/2c has deliberately deferred, plus
retrofitting audit writes onto those already-shipped routes once the module exists), `platform/
reliability` dashboards, and `TenantMaintenanceWorker`.

`current_phase` in `docs/NEXUS_STATE.md` remains `development` (unchanged) — this migration is tracked
via this plan file and the `migration_plan` state line, not the old backlog-phase numbering; Phase 2
overall is not yet complete (three more item groups remain: audit, reliability dashboards,
TenantMaintenanceWorker) — this is the final sub-slice needed before that closing dispatch.

## Sub-slice 2d — `platform/audit` (audit-log write path + retrofit), `platform/reliability`
dashboards, `TenantMaintenanceWorker` (closes Phase 2)

**Goal**: every already-shipped platform-admin mutating route (sub-slices 2a/2b/2c) writes a real
`platform.audit_log` row after its own primary action succeeds, without a logging failure ever able to
fail that action; a Platform Admin can view that audit trail (paginated, filterable by
actor/action/target) and a cross-tenant Reliability dashboard (outbox/file-cleanup health, honest
work-hint counts) through the real console; a real, standalone `ROLE=worker` process retries tenants
stuck in `Provisioning`/`Failed` and drains each `Active` tenant's own reset-token/file-cleanup hygiene
on its own tick, tolerant of any single tenant's failure.

**Backlog item(s)**: none — tracked via this plan file, matching every prior sub-dispatch's own framing.

### Scope

**In scope** (per the dispatch prompt's own enumerated item list):
1. `platform/audit` — new module (`server/platform/audit/{domain,infrastructure,application}` +
   barrel): `AuditLogEntry`/`AuditLogListOptions`/`AuditLogRow`/`AuditLogListResult` types,
   `AuditLogRepository` (append-only `platform.audit_log` write + a new `findMany` paginated/filtered
   read path — no legacy HTTP precedent for the read side, legacy never built an admin-facing audit
   viewer), `AuditLogService` (the fail-open `record()` wrapper ported verbatim from legacy, plus a
   plain `list()` delegation). New `AuditLogEntity` (`infrastructure/database/platform/entities/
   audit-log.entity.ts`) + `20260815000012-create-audit-log-table.ts` migration (ported verbatim from
   legacy's DDL, plus two new additive indexes — `ix_audit_actor_time`, `ix_audit_target` — for this
   dispatch's own actor/target filters; see "Decisions made" below).
2. Retrofit: a `platform.audit_log` write added to every mutating Route Handler sub-slices 2a/2b/2c
   shipped without one — `POST /api/platform/tenants` (`tenant.create`), `.../suspend`
   (`tenant.suspend`), `.../activate` (`tenant.activate`), `.../soft-delete` (`tenant.soft_delete`, a
   new action name — no legacy route existed to name one), `PATCH .../registration-settings`
   (`tenant.registration_settings_updated`), `POST .../provisioning/retry`
   (`tenant.provisioning.retry`); `POST`/`PATCH`/`DELETE /api/platform/features/**`
   (`feature.create`/`feature.update`/`feature.delete`); `POST`/`PATCH /api/platform/packages/**` +
   `PUT .../features` (`package.create`/`package.update`/`package.features_replaced`);
   `POST`/`PATCH`/`PUT .../default`/`DELETE /api/platform/ai-models/**`
   (`aiModel.approved`/`aiModel.updated`/`aiModel.default_changed`/`aiModel.removed`);
   `PUT`/`DELETE /api/platform/tenants/:id/ai-model` (`aiModel.assigned`/`aiModel.unassigned`);
   `PUT /api/platform/tenants/:id/billing` (`tenant.subscription_reassigned`);
   `POST .../billing/checkout-session` (`billing.checkout_session_created`). Every action name/summary
   shape ported verbatim from legacy's own `TenantsController`/`FeaturesController`/
   `PackagesController`/`AiModelsController` audit-write call sites. Each write happens strictly after
   its own primary action has already committed, calling the fail-open `AuditLogService.record` (never
   wrapped in a redundant try/catch at the route layer — the service's own fail-open contract is the
   single place that guarantee lives, matching legacy's identical design).
3. **`BillingWebhookService` also retrofitted** (a `System`-attributed write, not `PlatformAdmin` — no
   human admin initiated a webhook delivery) — a small, directly-adjacent addition beyond the dispatch
   prompt's literal "checkout-session creation, reassignSubscription" retrofit list: legacy's own
   `BillingWebhookService` already writes `billing.checkout_completed`/`billing.subscription_updated`/
   `billing.subscription_canceled` `System`-attributed rows, and this app's own sub-slice 2c doc comment
   explicitly flagged this exact deferral ("Deliberately no `platform.audit_log` write... flagged here,
   not silently omitted, for that later dispatch to retrofit") — ported verbatim now that the module
   exists. `AuditLogService` added as a 5th constructor collaborator (matching legacy's own identical
   5-collaborator shape for this class).
4. `platform/reliability` — new module (`server/platform/reliability/{domain via infra/database
   types,infrastructure,application}` + barrel): `WorkHintRepository`/`WorkHintsService` (the
   platform-schema read side of `tenant_work_hint`, ported logic from legacy verbatim, plus a new
   `countByKind` read method for the dashboard — no legacy precedent, legacy never built this viewer)
   and `getReliabilityDashboardSnapshot()` (a new cross-tenant aggregation function, this module's own
   composition-root-level function, not a class — iterates every `Active` tenant's own schema via
   `TenantDataSourceRegistry`, tolerant of one tenant's failure, mirroring
   `server/workers/outbox-publisher.ts`'s identical full-sweep pattern). New `TenantWorkHintEntity` +
   `20260815000013-create-tenant-work-hint-table.ts` migration (ported verbatim from legacy — no
   producer of any hint kind is wired in this app yet, an honest, documented gap, not a stub to
   apologize for; see that entity's own doc comment).
5. `OutboxRepository.countsByStatus()` + `FileCleanupRepository.countDue()` — new read methods added to
   the existing `server/reliability` module (Phase 1c) for the dashboard's own aggregation; no
   behavior change to either repository's existing write paths.
6. `TenantScopeService` — new, `server/tenancy/tenant-scope.ts` (added to the existing `tenancy`
   module, exported via its barrel) — worker code's own entry point into tenant scope, resolving by
   tenant id (not `Host` header) and binding the same ALS `RequestContext` `withTenantContext` would.
   Ported logic verbatim from legacy's `TenantScopeService`, **adapted for this app's constructor-
   `DataSource` repository convention**: legacy's `runFor` callback received an `EntityManager` (legacy
   repositories resolve their own `Repository` from the *ambient* tenant `EntityManager`); this app's
   version hands the callback the tenant's `DataSource` directly, matching
   `server/workers/outbox-publisher.ts`'s own established "construct a fresh, `DataSource`-bound
   repository/service inside the callback" pattern (see "Decisions made" below for the full reasoning).
7. `TenantHygieneService` — new, `server/reliability/application/tenant-hygiene.service.ts` (added to
   the existing `server/reliability` module). `pruneExpiredResetTokens()` (delegates to
   `UserRepository.pruneExpiredResetTokens`, whose return type is fixed from `Promise<void>` to
   `Promise<number>` this dispatch — it always computed `affectedRows` internally but never returned it,
   since no caller needed the count before now) + `drainFileCleanupQueue()` (ported verbatim from
   legacy: deletes from storage, marks the row deleted only after the delete call genuinely resolves,
   one bad key never blocks the batch). Constructed **fresh per tenant** by `TenantMaintenanceWorker`
   (a `hygieneFactory` closure), not a process-wide singleton — see "Decisions made" for why.
8. `TenantMaintenanceWorker` — new, `server/workers/tenant-maintenance.ts` (a plain composition-root-
   adjacent file, like `outbox-publisher.ts`, carrying no ESLint module-boundary rule of its own).
   `sweepStuckProvisioning()` (finds every `Provisioning`/`Failed` tenant with a stale/never-set
   `provisioning_heartbeat_at` via the already-existing `PlatformTenantRepository.findStuckProvisioning`,
   retries each via `TenantProvisioningService.retry`, tolerant of one tenant's retry failing),
   `sweepTenantHygiene()` (runs `TenantHygieneService`'s two duties for every `Active` tenant inside
   `TenantScopeService.runFor`, paged past 100 tenants, tolerant of one tenant's hygiene pass failing),
   `listPurgeEligibleTenants()` (lists, never acts on, soft-deleted tenants past `purge_after_at` — a
   new `PlatformTenantRepository.findPurgeEligible` method, ported verbatim from legacy). Wired into
   `server/workers/worker-entrypoint.ts` as two new `scheduleTick` calls (provisioning retry + hygiene),
   sharing one new `WORKER_TENANT_MAINTENANCE_TICK_MS` cadence (default 300000ms — HLD §10.1's own
   "single 300s-class tick shared by all of its duties"), alongside Phase 1c's existing outbox-sweep
   tick. New env vars: `PROVISIONING_HEARTBEAT_STALE_MS` (default 300000, ported verbatim),
   `WORKER_TENANT_MAINTENANCE_TICK_MS` (new — no legacy equivalent existed since this app has no
   `WORKER_FULL_SWEEP_INTERVAL_MS` to reuse, see "Decisions made"), `TENANT_PURGE_ENABLED` (default
   `false`, ported verbatim — no code path in this app ever executes a purge regardless of this flag's
   value).
9. Chakra v3 UI: a new "Reliability" console nav item/page (`app/platform/(console)/reliability/
   page.tsx`) — three stacked read-only panels (Outbox health, File cleanup queue, Work hints), no
   mutating action anywhere on the page (a dashboard, not an editor, per the migration plan's own
   framing) — and a new "Audit Log" console nav item/page (`app/platform/(console)/audit-log/page.tsx`)
   — paginated, filterable by actor/action/target-type/target-id (every filter combined with AND), same
   Previous/Next pagination convention the Tenants list screen already established. New
   `app/api/platform/reliability/route.ts` (`GET`) and `app/api/platform/audit-log/route.ts` (`GET`),
   both `withPlatformAuth`-gated. New `lib/platform-console/{reliability-api,audit-log-api}.ts` client
   modules, added to the console's existing barrel; two new `PlatformShell` nav items, placed last
   (matching this app's own "operational/read-mostly surfaces at the end of the nav" convention).
10. `docs/design/UX_GUIDELINES.md` §18.9 (Reliability dashboard)/§18.10 (Audit Log) — new sections,
    consistent with and extending §18's existing conventions rather than reinventing them.
11. New `apps/next/.eslintrc.cjs` module-boundary rules: `PLATFORM_AUDIT_BARREL_ONLY` and
    `PLATFORM_RELIABILITY_BARREL_ONLY`, both scoped `**/server/platform/{audit,reliability}/**` from
    the first commit (not a bare pattern) — the by-now-well-established lesson from every prior
    sub-slice's own barrel-pattern fix. **Also fixed a real, previously-latent instance of the identical
    bare-pattern gap this dispatch's own new `platform/reliability` module would otherwise have
    tripped**: `RELIABILITY_BARREL_ONLY` (Phase 1c's `server/reliability` module) was still a bare
    `**/reliability/**` pattern, which would have incorrectly blocked `server/platform/reliability/**`'s
    own internal relative imports purely because its path contains the literal segment "reliability" —
    narrowed to `**/server/reliability/**`, the same fix-not-loosen pattern every prior barrel-scoping
    fix in this project has applied.
12. New `server/common/http/request-ip.util.ts` (`getRequestIp`) — a small, pure best-effort
    `X-Forwarded-For`/`X-Real-IP` extraction helper every retrofitted route uses for the audit row's
    `ip` field (no module-boundary rule, matching `common/`'s established "shared-kernel, pure code"
    precedent).
13. New real-route integration test `phase2d-platform-audit-reliability.integration.test.ts` — proves,
    against real MySQL and the real exported Route Handler functions: a real `platform.audit_log` row
    is written when a tenant is suspended through the real route, visible via `GET
    /api/platform/audit-log`; the audit log's actor/action filters combine with AND; **a real, forced
    failure of `AuditLogRepository.append()`** (not a mock of the whole fail-open service — see
    "Decisions made" #6 for why that distinction matters) never fails the outer `POST
    /api/platform/tenants` request; `features.create`/`delete` are also retrofitted;
    `GET /api/platform/reliability` returns a real cross-tenant snapshot with the honestly-zero
    work-hint counts; both new routes reject unauthenticated requests. New unit tests:
    `audit-log.service.test.ts`/`audit-log.repository.test.ts` (ported from legacy's own spec files),
    `work-hints.service.test.ts` (ported, plus new `countByKind` coverage), `tenant-scope.test.ts`
    (ported, adapted for the `DataSource`-callback signature), `tenant-hygiene.service.test.ts` (ported
    verbatim), `tenant-maintenance.test.ts` (ported from legacy's `tenant-maintenance.worker.spec.ts`,
    adapted for the `hygieneFactory` closure — see "Decisions made"), plus new
    `reliability-api.test.ts`/`audit-log-api.test.ts` client-side request-shape tests. Extended
    `platform-migrations.integration.test.ts` for the two new migrations (13 total now) and the new
    tables' column shape/FK-absence.
14. `apps/next/scripts/playwright-smoke.ts` extended (not replaced) with the final Phase 2 flow: the
    Audit Log page shows a real `feature.create` row (filtered by action) for the feature created
    earlier in the same run; the Reliability dashboard renders real cross-tenant counts and the honest
    zero-work-hints state. Two real, previously-latent strict-mode-locator ambiguities found and fixed
    in this same pass (see "Decisions made" #7).

**Explicitly out of scope for this dispatch** (per the migration plan's own framing, confirmed rather
than assumed):
- Actually executing a tenant purge — only `listPurgeEligibleTenants()` exists; `TENANT_PURGE_ENABLED`
  defaults `false` and no code path in this app ever reads it to gate a real purge action (there is no
  purge-execution code at all yet, this flag is a forward-looking kill switch for a later phase).
- Any UI/backend for the unrelated cross-tenant-migration-rollout tool (legacy's `tenant-migrations`
  Angular component/`TenantMigrationRunner`) — confirmed distinct from `TenantMaintenanceWorker`'s own
  provisioning-retry/hygiene duties before writing a line of code, per the dispatch prompt's own
  explicit warning not to conflate the two.
- Any producer of `tenant_work_hint` rows — `pdf-processing`/`attempts` modules don't exist yet (later
  phases' job); the dashboard's own honest-zero work-hint state reflects this correctly.
- A hinted (vs. full-scan) outbox sweep, and `AuditTrailOutboxConsumer` wiring the outbox's own
  `user.created` delivery onto the now-existing `platform/audit` module — both remain Phase 1c's own
  documented, still-open scope reductions; this dispatch's own audit retrofit targeted the mutating
  platform-admin Route Handlers sub-slices 2a/2b/2c shipped, not the outbox consumer.
- Rate limiting on the two new read-only routes (`GET /api/platform/{reliability,audit-log}`) — both
  are `withPlatformAuth`-gated reads with no side effect, and this app-wide gap (flagged, not fixed,
  since sub-slice 2c) remains a pre-existing, cross-cutting concern out of proportion to this
  dispatch's own scope.

### Decisions made (LLD/plan silent, or a genuine judgment call — smallest-reasonable-choice standard)

1. **`TenantScopeService`'s `runFor` callback receives the tenant's `DataSource`, not an
   `EntityManager`** — legacy's version hands callers an `EntityManager` because legacy's own
   repositories (`UserRepository`, `FileCleanupRepository`, ...) resolve their `Repository` lazily from
   the *ambient* ALS-bound tenant context at call time, so a single process-wide `TenantHygieneService`
   instance can safely serve every tenant in turn. This app's repository classes are constructed with an
   already-resolved `DataSource` up front instead (the established convention documented on
   `UserRepository`'s own doc comment since Phase 1b) — there is no ambient-lookup mechanism to lean on.
   Handing the callback the `DataSource` directly (rather than trying to bolt an ambient-lookup layer
   onto every repository class just for this one worker) matches the exact pattern
   `server/workers/outbox-publisher.ts`'s own `processTenant` helper already established for the outbox
   sweep — this is not a new pattern invented for this dispatch, it's applying an already-proven one to
   a second worker.
2. **`TenantHygieneService` is constructed fresh per tenant by `TenantMaintenanceWorker` (a
   `hygieneFactory` closure), not held as one process-wide singleton collaborator** — the direct
   consequence of decision #1: since this app's `UserRepository`/`FileCleanupRepository` need a
   specific tenant's `DataSource` at construction time, `TenantHygieneService` (which wraps them) must
   also be constructed per tenant. `TenantMaintenanceWorker`'s own constructor therefore takes a
   `hygieneFactory: (dataSource: DataSource) => TenantHygieneService` rather than a single
   `TenantHygieneService` instance (legacy's own shape) — a small, deliberate adaptation, not a
   deviation from legacy's actual behavior (every real duty/guarantee is identical; only *how* the
   collaborator is supplied differs, and only because the underlying repository convention differs).
3. **`WORKER_TENANT_MAINTENANCE_TICK_MS` is a brand-new env var, not a repurposed existing one** —
   legacy's own `worker.ts` reuses its already-existing `WORKER_FULL_SWEEP_INTERVAL_MS` for this exact
   purpose (HLD §10.1's "single 300s-class tick shared by all of its duties"), but this app has no
   equivalent var: Phase 1c's own outbox sweep uses only `WORKER_OUTBOX_TICK_MS` (a materially faster,
   different-purpose cadence), and no other worker needing a slow, whole-tenant-set cadence existed
   before this dispatch. Introducing a dedicated, correctly-named var is more honest than repurposing a
   fast-cadence config knob meant for a different concern, or silently reusing `WORKER_OUTBOX_TICK_MS`
   for an unrelated duty.
4. **Two new indexes on `audit_log`** (`ix_audit_actor_time`, `ix_audit_target`) beyond legacy's own
   two (`ix_audit_tenant_time`, `ix_audit_action_time`) — this dispatch's own Audit Log console page
   filters by actor and by target in addition to legacy's action/tenant filters (legacy never built
   this viewer at all), so both need their own composite index rather than falling back to a full table
   scan. Purely additive (no column/behavior change), so it carries no compatibility risk against
   legacy's identical table shape.
5. **`getReliabilityDashboardSnapshot()` is a plain function inside `server/platform/reliability`'s own
   barrel, not a class** — unlike `TenantMaintenanceWorker` (which has real, unit-testable branching
   logic worth a dedicated class + fakes-based tests), this aggregation is a straightforward "loop every
   Active tenant, sum three numbers, tolerant of failure" composition, structurally identical in spirit
   to `server/workers/outbox-publisher.ts`'s own `runOutboxFullSweep` function (also a plain function,
   also proven via real integration tests rather than a dedicated unit test with fakes — see that file's
   own precedent, which has no `.test.ts` sibling either). Housed inside `platform/reliability`'s own
   barrel (not `server/workers/`) because, unlike the outbox sweep, this aggregation is invoked from an
   HTTP Route Handler (a read), not a worker tick — it has no ROLE=worker-specific concern at all,
   so it belongs with the module that owns the data it's summarizing.
6. **The real, forced audit-write-failure integration test mocks `AuditLogRepository.append()`, not
   `AuditLogService.record()`** — an initial draft of this test mocked `record()` directly (the simplest
   thing to fake), which immediately and correctly failed: mocking the whole service *replaces* its own
   fail-open try/catch rather than exercising it, so the mocked rejection legitimately propagated into
   the route's own 500 response — proving the opposite of what the test intended to prove. Found by
   actually running the test, not assumed to be correct because it "looked reasonable." Fixed by
   spying on the real repository's `append()` method instead (`vi.spyOn(AuditLogRepository.prototype,
   'append')`), which lets the real `AuditLogService.record()` implementation's own try/catch actually
   execute and swallow the forced failure — this is the genuinely correct way to prove the fail-open
   guarantee holds end-to-end through a real HTTP route, and the isolated proof that `record()` itself
   never throws already lives in `audit-log.service.test.ts`'s own dedicated unit test.
7. **Two real, previously-latent strict-mode Playwright locator ambiguities found and fixed while
   extending the smoke script** (not pre-existing, out-of-scope defects — both are new assertions this
   dispatch's own script additions introduced): `page.getByText('Audit Log')`/`page.getByText(
   'Reliability')` each matched two elements (the nav-sidebar link and the page's own `<h2>` heading,
   both literally containing that exact text) — Playwright's strict mode correctly rejected both as
   ambiguous. Fixed by narrowing each to `page.getByRole('heading', { name: ... })`, which unambiguously
   targets the page heading regardless of what the nav sidebar happens to render alongside it. Found
   and fixed during this dispatch's own real-browser pass, re-run clean immediately after.
   **A second, environment-growth-driven smoke-script fragility was also found and fixed in this same
   pass**: sub-slice 2a's own original assertion #3 ("the real Phase-1-seeded `demo-next` tenant is
   visible in the list") assumed `demo-next` would always be on the tenants list's first (default)
   page — true when that assertion was first written, but this dispatch's own real-browser run is the
   first one where the shared dev schema's tenant count (now 50, accumulated across every prior
   sub-dispatch's own never-force-cleaned smoke fixtures) has grown enough to push `demo-next` off page
   1 entirely, since the list sorts newest-first and `demo-next` is one of the very oldest tenants.
   Fixed with a new `ensureTenantRowVisible` helper (pages forward, bounded, until the target row is
   found) used at both of this script's own two `demo-next`-locating call sites — a genuine, forward-
   looking robustness fix (this tenant count will only keep growing for the remainder of this
   migration), not a workaround for a one-off flake.
8. **A real, previously-latent, environment-specific finding surfaced by the standalone `ROLE=worker`
   process proof (documented, not a code defect)**: running a real worker process against the shared
   dev schema's own pre-existing tenants, `sweepTenantHygiene` genuinely failed (logged, not crashed —
   `tenant_maintenance_hygiene_failed`) for two tenants (`t_smoke1b_*`, `t_demo_next_*`) whose schemas
   predate Phase 1c's own `file_cleanup_queue`/reliability-table migrations (they were provisioned
   during Phase 1a/1b, before those migrations existed, and no retroactive tenant-schema-migration
   mechanism has been built yet — that is explicitly the separate, not-yet-built cross-tenant-migration-
   rollout tool's job, per this dispatch's own "explicitly out of scope" list). This is not a bug in
   `TenantHygieneService`/`TenantMaintenanceWorker` — it is, in fact, direct, real-world proof that the
   "one tenant's hygiene pass failing never stops the sweep from visiting the rest" guarantee holds
   under genuine adverse conditions, not just a mocked unit test: the sweep correctly logged each
   failure and continued to every other tenant, including successfully retrying the dispatch's own
   deliberately-stuck verification tenant afterward. Flagged here as an honest environment artifact of
   this migration's own iterative shared-schema history, exactly the same class of finding this
   project's own history already documents precedent for (e.g. Dev-18b/Dev-22's "environment-load-
   caused flake," this dispatch's own equivalent for schema-drift-on-old-tenants).
9. **A real, previously-latent connection-exhaustion bug in `getReliabilityDashboardSnapshot()` found
   and fixed by actually running its own real-route integration test** — the first implementation
   acquired every scanned tenant's `DataSource` via the pooled `TenantDataSourceRegistry`
   (`registry.acquire`/`release`), the same mechanism `server/workers/outbox-publisher.ts` already uses
   for its own per-tick tenant loop. That mechanism is correct for a worker tick or an HTTP request
   touching *one* tenant, because the registry is designed to keep a tenant's pool resident for reuse
   across separate calls — but this dashboard touches *every* `Active` tenant in a single logical
   operation, so by the time the scan finished it had left every scanned tenant's pool (up to
   `TENANT_REGISTRY_MAX` residents, each holding up to `TENANT_POOL_MAX` connections) open
   simultaneously. Against this project's own shared dev schema — which has accumulated 50 tenant
   schemas across every prior sub-dispatch's own never-force-cleaned smoke/verification fixtures, per
   this migration's own established precedent — this genuinely exhausted MySQL's `max_connections`
   (`ER_CON_COUNT_ERROR: Too many connections`), reproduced consistently even with this dispatch's own
   new integration test run in complete isolation, not merely under full-suite concurrency. **Fixed** by
   switching to `createTenantDataSource(schemaName)` (the same short-lived, immediately-`.destroy()`-ed
   `DataSource` pattern `RunMigrationsStep`/`SeedRbacStep`/`SeedAdminUserStep` already established for
   the identical "never consume a resident slot" reason), opened and destroyed one tenant at a time
   inside the existing sequential loop — this bounds the dashboard's own connection footprint to at most
   one tenant's worth at any instant, regardless of how many tenants exist. Re-run clean immediately
   after (6/6 in the dedicated integration test file, and 604/604 across the full suite run
   sequentially). This is a real, generalizable finding for any future cross-tenant aggregation this
   migration builds later, not specific to this one dashboard.

### Exit gate

1. `next build` succeeds cleanly. **PASS** — including the two new routes
   (`app/api/platform/reliability`, `app/api/platform/audit-log`) and two new pages
   (`app/platform/(console)/{reliability,audit-log}/page.tsx`) compiled and listed in the route
   manifest.
2. `eslint --max-warnings=0` clean, including a deliberately-added-then-reverted module-boundary
   violation proving `PLATFORM_AUDIT_BARREL_ONLY`, `PLATFORM_RELIABILITY_BARREL_ONLY`, and the
   newly-rescoped `RELIABILITY_BARREL_ONLY` all actually fire (a scratch file deep-importing
   `@/server/platform/audit/infrastructure/audit-log.repository`,
   `@/server/platform/reliability/infrastructure/work-hint.repository`, and
   `@/server/reliability/infrastructure/outbox.repository`, confirmed all three fail with their
   expected `no-restricted-imports` messages, then deleted; lint re-confirmed clean). **PASS.**
3. New migrations (`CreateAuditLogTable20260815000012`, `CreateTenantWorkHintTable20260815000013`) run
   clean against real MySQL (`examland_platform_next` on the already-running `exam-4u-mysql-1`
   container): `platform-migrations.integration.test.ts` extended to assert all 13 migrations recorded
   (up from 11), both new tables' exact column shape, and the confirmed absence of any foreign key on
   `audit_log` (a deliberate design choice, not an oversight — see each entity's own doc comment).
   **PASS.**
4. Unit tests for new pure-logic code: `AuditLogService` (fail-open — a real forced-repository-failure
   test, plus a route-simulation test proving a caller awaiting `record()` sees its own primary action
   already resolved regardless of the audit write's outcome), `AuditLogRepository` (append shape,
   findMany's AND-combined optional filters + pagination defaults/caps), `WorkHintsService` (delegation,
   including the new `countByKind`), `TenantScopeService` (not-found/unavailable guards, ALS binding,
   release-in-finally, `DomainError` passthrough vs. raw-error wrapping — all five cases ported from
   legacy's own spec), `TenantHygieneService` (prune count delegation, drain success/one-bad-key-never-
   blocks-the-batch), `TenantMaintenanceWorker` (stuck-provisioning sweep tolerant-of-one-failure,
   hygiene sweep tolerant-of-one-failure + pagination past 100 tenants, purge-eligible listing —
   all ported from legacy's own spec, plus a new pagination-specific test) — **PASS**, plus the full
   accumulated suite (see below).
5. Real end-to-end proof (real MySQL + real HTTP, real browser via extended
   `scripts/playwright-smoke.ts`): **PASS** — see "Verification evidence" below for the full
   transcript, including the standalone `ROLE=worker` process proof against a deliberately-stuck-
   provisioning tenant (retried and recovered to `Active`) and the Reliability dashboard rendering real
   counts.
6. **Whole-Phase-2 exit gate re-confirmation**: the extended `playwright-smoke.ts` run below is a
   single, continuous real-browser session touching all seven Phase 2 console surfaces (tenants,
   features, packages, ai-models, the tenant-detail billing panel, Reliability, Audit Log) — not a
   re-citation of each prior sub-dispatch's own isolated proof. **PASS**, transcript below.
7. Legacy containers (`exam-4u-api-1`, `-worker-1`, `-mysql-1`, `-qdrant-1`, `-mailhog-1`) completely
   undisturbed. **PASS** — `docker ps` diffed before this dispatch's first verification step and after
   its last (unit/integration tests, the real `next start` boot, the real-browser Playwright pass, and
   the standalone `ROLE=worker` process run); only uptime counters progressed naturally (33h → 34h),
   no restarts/rebuilds/recreations.

### Verification evidence

**Automated tests**: `604` tests green across `80` test files (up from sub-slice 2c's `557`/`71`) —
this dispatch adds 47 across 9 new test files: 4 in `audit-log.service.test.ts`, 5 in
`audit-log.repository.test.ts`, 3 in `work-hints.service.test.ts`, 7 in `tenant-scope.test.ts`, 4 in
`tenant-hygiene.service.test.ts`, 8 in `tenant-maintenance.test.ts`, 1 in `reliability-api.test.ts`, 3
in `audit-log-api.test.ts`, plus 6 real-route integration tests in
`phase2d-platform-audit-reliability.integration.test.ts` — plus the existing
`platform-migrations.integration.test.ts` extended with 1 new migration-count/table-shape assertion
(now 6 tests in that file, up from 5) and `billing-webhook.service.test.ts` extended with 5 new
`System`-attributed audit-write assertions (every `fakeAudit()`/constructor call site updated for the
new 5th collaborator). Run with the same `DB_HOST=localhost DB_USER=examland
DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next JWT_TENANT_SECRET=...
JWT_PLATFORM_SECRET=... FILE_SIGNING_SECRET=...` every prior sub-slice used. Coverage
(`vitest run --coverage`): **93.05% statements / 91.62% branch / 90.29% functions / 93.05% lines**
overall — clears the "≥80%" bar comfortably; `server/platform/audit/**` at 100%/100%/100%/100%;
`server/platform/reliability/**` at 96.22%/77.77% (the one uncovered branch is the dashboard
aggregation's per-tenant catch block, proven instead by the real integration test and the real-worker
run, matching `server/workers/outbox-publisher.ts`'s own identical "composition-root aggregation code
proven via real runs, not a dedicated unit test" precedent); `server/reliability/application/
tenant-hygiene.service.ts` at 100%/100%/100%/100%; `server/tenancy/tenant-scope.ts` at
100%/91.66%/100%/100%. 80/80 test files green in the final run; one pre-existing, unrelated flake
(`reliability-users-profile-files.integration.test.ts`'s outbox-redelivery test, a file this dispatch
never touched) observed once under full-suite-plus-coverage-instrumentation load, confirmed clean in
isolation (6/6) immediately after — the same "environment-load-caused flake under full concurrent-
suite real-MySQL load" class this project's own history already documents (Dev-18b/Dev-22 in the
legacy build; every prior Phase 2 sub-slice's own identical finding), not a regression this dispatch
introduced.

A second, deeper full-suite pass (run after fixing "Decisions made" #9's real connection-exhaustion
bug) surfaced two more findings, both root-caused and resolved rather than dismissed: (1) a fully-
parallel (`vitest run`, the tool's own default) full-suite invocation against this shared dev schema's
now-50-accumulated tenant schemas hit `ER_CON_COUNT_ERROR` intermittently across several pre-existing,
untouched files — confirmed as the identical connection-pressure phenomenon "Decisions made" #9
describes, not a code defect, and resolved for verification purposes by running with
`--no-file-parallelism` (**604/604 green**, sequential-file execution keeps concurrent tenant-schema
connections bounded); (2) `phase2c-billing-webhook.integration.test.ts` (a file this dispatch never
touched) failed twice with a stale-data collision — its own hardcoded, non-run-scoped
`sub_p2c_2`/`sub_p2c_3` provider-subscription ids had accumulated leftover rows from this dispatch's
own repeated manual re-invocations of the full suite within this same verification session (not from
any other sub-dispatch's normal single-pass usage) — resolved by deleting those three stale rows
directly (a one-time verification-session cleanup, not a product-code change) and re-confirmed green
(7/7) immediately after. Neither finding required a change to any Phase 2 sub-slice 2a/2b/2c code; both
are documented here for the next migration-plan phase's own awareness (the growing tenant-schema count
this migration's own "never force-clean" precedent produces will keep making full-parallel local test
runs against the shared dev schema more contention-prone over time — worth a `--no-file-parallelism`
default, or Phase 10's fresh-volume compose stack, as this count keeps growing).

**Real end-to-end HTTP + browser pass**: `next build` then `next start -p 3179` (`NODE_ENV=production`)
against `examland_platform_next` on the already-running `exam-4u-mysql-1` container, with a platform
admin created via a direct (bcrypt-hashed, scratchpad-only script, deleted after use) verification
helper mirroring every prior sub-slice's identical technique. `apps/next/scripts/playwright-smoke.ts`
(extended, not replaced — every sub-slice 2a/2b/2c assertion still passes unchanged) drove a real
Chromium browser through the full, cumulative 22-assertion flow in one continuous session — login →
tenants CRUD → features/packages/AI-models CRUD → tenant billing panel → **this dispatch's own two new
assertions**:

```
PASS: Audit Log page shows a real 'feature.create' audit row for 'smoke2b-feat-msui150m' after filtering by action
PASS: Reliability dashboard renders real cross-tenant outbox/file-cleanup counts and the honest zero-work-hints state
PASS: zero console errors across every page load in this run
```

Two real, previously-latent strict-mode Playwright locator bugs (own script's `getByText('Audit
Log')`/`getByText('Reliability')` ambiguity against the nav link + page heading both containing that
exact text) were found and fixed during this same pass — see "Decisions made" #7 — re-run clean
immediately after.

**Standalone `ROLE=worker` process proof** (mirroring Phase 1c's own outbox-worker proof exactly): a
real tenant was provisioned through the actual workflow, then its `tenant.status` was directly SQL-set
to `Failed` with `provisioning_heartbeat_at = NULL` to simulate a genuinely-stuck tenant. A real,
separately-booted `node`/`tsx src/server/workers/worker-entrypoint.ts` process (`PROVISIONING_
HEARTBEAT_STALE_MS=1000`, `WORKER_TENANT_MAINTENANCE_TICK_MS=3000` for this verification pass only —
production defaults are 300000/300000) was run for ~8 seconds. Log evidence:

```
{"tenantId":"815798fb-...","msg":"tenant_provisioning_completed"}
{"tenantId":"815798fb-...","msg":"tenant_maintenance_provisioning_retry_succeeded"}
```

Confirmed via a direct query immediately after: `SELECT status, provisioning_error,
provisioning_heartbeat_at FROM tenant WHERE id = '815798fb-...'` → `Active`, `NULL`, `NULL` — the
deliberately-stuck tenant was genuinely retried and recovered by the real worker process, not a mock.
The same run also surfaced "Decisions made" #8's real, documented environment finding (two genuinely
pre-existing, pre-Phase-1c-migration tenant schemas causing a real, correctly-tolerated hygiene-sweep
failure) — the worker process continued past both failures and successfully retried/recovered several
other genuinely-stuck legacy tenants left over from earlier sub-dispatches' own verification passes, in
addition to this dispatch's own deliberately-created one.

Security self-review (per this app's own established checklist): every new mutating write path (the
audit retrofit itself) only ever runs after its own already-`withPlatformAuth`-gated primary action has
already been authorized — no new endpoint, no new input surface beyond the two new read-only
`GET /api/platform/{reliability,audit-log}` routes (both `withPlatformAuth`-gated, no
unauthenticated-by-omission surface); the audit-log filter query params are validated server-side via
the existing `optionalString`/`optionalInt` helpers (bounded lengths/ranges) before ever reaching the
repository; no raw string-concatenated queries anywhere (every new repository method is parameterized
TypeORM or a fixed, parameterized raw-SQL string — `OutboxRepository.countsByStatus`'s own raw query
included); no secret/credential in committed code; API responses return only the documented summary
shapes (an audit row's `ip`/`actorId` are already server-derived/authenticated values, never
echoing back anything the client didn't already have a right to see); the one open, pre-existing,
app-wide finding (no rate limiting anywhere in this app) remains flagged, not newly introduced or
fixed by this dispatch's own narrow scope.

`docker ps` diffed before this dispatch's first verification step and after its last (unit/integration
test runs, the real `next start` boot, the real-browser Playwright pass, and the standalone
`ROLE=worker` process run) — legacy `exam-4u-api-1`/`-worker-1`/`-mysql-1`/`-qdrant-1`/`-mailhog-1`
completely undisturbed throughout, only uptime counters advanced (33h → 34h).

### Verification artifacts left in the shared dev MySQL instance

Matching every prior sub-dispatch's own established precedent, this dispatch's own real-HTTP-pass and
real-worker-process rows were **not** force-cleaned afterward: a `phase2d-verify-admin@examland.local`
platform admin (known password, scratchpad-script-created, script itself deleted after use) remains in
`examland_platform_next`, alongside a `smoke2a-*`/`smoke2b-*`-prefixed set of tenants/features/
packages/AI models created during this dispatch's own Playwright run, and a `p2d-stuck-*` tenant (the
deliberately-stuck-then-recovered verification tenant, now genuinely `Active`) from the standalone
worker-process proof. Several genuinely-stuck legacy tenants left over from earlier sub-dispatches'
own verification passes were also recovered to `Active` as a real, incidental side effect of running
the real worker process against this shared schema — a correct, expected outcome of
`sweepStuckProvisioning`'s own design, not a side effect this dispatch needed to work around. Harmless,
real, already-exercised dev-verification data, consistent with this migration's own iterative-phase-
by-phase shared-schema reality (a real `docker compose up` from a fresh volume, Phase 10's job, starts
from zero).

## Status

**Sub-slice 2d complete — this closes out Phase 2 in full.** All 7 exit-gate items pass (see
"Verification evidence" above). 604 tests green (up from sub-slice 2c's 557), 93.05%/91.62%
statement/branch coverage overall, `next build`/`eslint --max-warnings=0`/`tsc --noEmit` all clean,
legacy containers confirmed undisturbed throughout (including the real `next start` boot, the
real-browser Playwright pass, and the standalone `ROLE=worker` process run). Two real, previously-
latent ESLint module-boundary gaps were found and fixed (a scoping fix for the pre-existing
`RELIABILITY_BARREL_ONLY` this dispatch's own new `platform/reliability` module would otherwise have
tripped, plus the two new correctly-pre-scoped rules for `platform/audit`/`platform/reliability`
themselves); a real test-design mistake in the fail-open verification test was found and corrected
(mocking the whole service instead of its underlying repository, which would have proven nothing); two
real Playwright strict-mode locator bugs were found and fixed in the smoke script; and a real,
documented environment-specific finding (pre-Phase-1c-migration tenant schemas causing an expected,
correctly-tolerated hygiene-sweep failure) was surfaced and explained by the standalone worker-process
proof — the same "find it by actually running the thing, not just building/typechecking it" discipline
every prior phase's own dispatch already established, applied here across four different surfaces in a
single dispatch.

**Nothing from the migration plan's original Phase 2 item list ended up not covered.** Every item named
in that line — "`platform/billing` (Stripe), `platform/ai-models` (allowlist admin), packages/features
CRUD UI, `platform/audit`, `platform/reliability` dashboards, platform console UI, tenants CRUD UI,
`TenantMaintenanceWorker`" — was delivered across sub-slices 2a (console UI shell, tenants CRUD),
2b (packages/features CRUD UI, `platform/ai-models`), 2c (`platform/billing` Stripe integration), and
2d (`platform/audit`, `platform/reliability` dashboards, `TenantMaintenanceWorker`). The only
deliberate, explicitly-out-of-migration-plan-scope deferrals across all four sub-slices are documented,
not silently dropped: tenant branding UI (FR-MT-10, explicitly assigned to Phase 9), self-serve
tenant-initiated billing checkout (explicitly assigned to Phase 9), the feature-usage-snapshot half of
the billing summary (no `platform/usage` module exists anywhere in the migration plan's Phase 0-2 item
list), a hinted (vs. full-scan) outbox sweep and `AuditTrailOutboxConsumer` wiring (both Phase 1c's own
documented, still-open scope reductions, neither named in Phase 2's own item list), actually executing
a tenant purge (HLD §9's own "off by default, list-only" design — not a Phase 2 deliverable at all), the
unrelated cross-tenant-migration-rollout tool (a distinct, later feature per `docs/NEXUS_STATE.md`'s
own history), and rate limiting anywhere in the app (a pre-existing, cross-cutting gap flagged
consistently since sub-slice 2c, out of proportion to any single Phase 2 sub-dispatch's own scope to
fix alone).

**Phase 2 overall status**: **complete.** A Platform Admin can now fully operate the platform through
the UI alone — the migration plan's own Phase 2 exit gate — proven fresh in this dispatch's own
single-session, seven-surface Playwright walkthrough (tenants, features, packages, AI models, billing,
reliability, audit log), not merely by re-citing each prior sub-slice's own isolated proof. Cumulative
Phase 2 numbers: 4 sub-slices, 604 tests (up from Phase 1's closing 353), 93.05%/91.62% statement/
branch coverage, 21 platform-console screens/API-route-pairs, 8 module-boundary-protected server
modules added this phase (`platform/billing`'s write half, `platform/ai-models`,
`infrastructure/payments`, `platform/audit`, `platform/reliability`), and 6 real, previously-latent bugs
found and fixed purely by actually running the built application rather than only building/
typechecking/unit-testing it (the cross-webpack-bundle `.into(EntityClass)` bug, two ESLint
bare-pattern gaps found reactively plus two more fixed proactively at the first commit, a smoke-script
locator-ambiguity bug, and this dispatch's own fail-open-test-design correction) — the same "find it by
actually running the thing" discipline this migration has applied at every single sub-dispatch since
Phase 0.

**Next migration-plan phase: Phase 3 (Taxonomy & curricula)** — "a pure content-model phase, no AI
dependency yet," per the migration plan's own phase sequence. `docs/BACKLOG.md`'s Phase/Priority
ordering continues to not apply to this migration; the next sub-dispatch's own scope/sequencing comes
directly from the migration plan file (`giggly-exploring-wombat.md`) and this plan-file convention,
tracked in a new `docs/plans/nextjs-rewrite-phase3-plan.md` this migration's own established
one-plan-doc-per-phase convention implies.
