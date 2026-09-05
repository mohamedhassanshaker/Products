# ExamLand Next.js Rewrite — Phase 1: Identity & Tenancy Foundation

Authoritative source for scope/sequencing: `giggly-exploring-wombat.md` ("the migration plan", at the
repo root). This doc tracks only the phase-by-phase execution status against that plan; it does not
restate the plan's rationale. `docs/BACKLOG.md`'s Phase/Priority ordering is **not** used to sequence
this migration. This is the first Phase 1 sub-dispatch; later sub-dispatches append their own
sections below (same pattern as how the legacy build's single `examland-mvp-plan.md` accumulated
every `Dev-XX` entry).

## Sub-slice 1a — Tenants, provisioning, and the package/feature/subscription catalog

**Goal**: the fixed, ordered `create_schema -> run_migrations -> seed_rbac -> seed_admin_user ->
create_subscription -> invite_admin` provisioning workflow runs end-to-end against real MySQL,
creating a real tenant schema, applying real tenant migrations, seeding RBAC + one admin user, and
subscribing the tenant to the real, migration-seeded `starter` package — all without any auth/HTTP
layer yet (that's the next Phase 1 sub-dispatch).

**Backlog item(s)**: none from `docs/BACKLOG.md` — this migration is tracked via the plan file, not
the old backlog-phase numbering (matching Phase 0's own framing).

### Scope

**In scope** (migration plan Phase 1 item list, this dispatch's portion):
- `server/infrastructure/database/tenant/{tenant-data-source-factory.ts, tenant-data-source-
  registry.ts}` — the tenant `DataSource` registry/factory pattern, ported from
  `legacy/api/src/infrastructure/database/tenant/**`.
- `server/infrastructure/database/migrations/{platform,tenant}/**` — this dispatch's slice of the
  platform/tenant migration history (see "Decisions made" #2 for exactly which legacy migrations
  were ported and which were deliberately deferred).
- `server/infrastructure/database/platform/entities/**` — `TenantEntity`,
  `TenantProvisioningStepEntity`, `PackageEntity`, `FeatureEntity`, `PackageFeatureEntity`,
  `TenantSubscriptionEntity`.
- `server/platform/tenants/**` — tenant CRUD domain (`TenantsService`, `PlatformTenantRepository`),
  ported from `legacy/api/src/platform/tenants/**`, minus branding (Phase 9) and cache invalidation
  (next Phase 1 sub-dispatch).
- `server/platform/billing/**` — package/feature/subscription catalog read-path repositories, ported
  from `legacy/api/src/platform/{packages,features,subscriptions}/**`.
- `server/platform/provisioning/**` — the full provisioning workflow (`TenantProvisioningService`,
  `TenantProvisioningLockService`, `TenantProvisioningStepRepository`, all 6 steps), ported from
  `legacy/api/src/tenancy/provisioning/**`.
- `server/tenancy/**` — the shared provisioning-domain vocabulary (`ProvisioningStep`/
  `ProvisioningContext`/`TenantProvisioningFailedError`/`EmailPort`), ported from
  `legacy/api/src/tenancy/domain/**`.
- `server/infrastructure/mail/**` — `NoopEmailAdapter` + `branded-email.template.ts`, ported from
  `legacy/api/src/infrastructure/mail/**` (minimal — see "Decisions made" #4).
- `server/common/{errors,util}/**` — `DomainError`/`ValidationFailedError`, `isPlausibleEmail`,
  `generateTenantSchemaName`/`isValidSubdomainSlug`, ported from `legacy/api/src/common/**`.
- New env vars in `server/config/env.schema.ts`: `PUBLIC_APEX_DOMAIN`, `RESERVED_SUBDOMAINS`,
  `TENANT_POOL_MAX`, `TENANT_REGISTRY_MAX`, `TENANT_IDLE_TTL_MS`, `TENANT_RETENTION_DAYS`,
  `FALLBACK_PACKAGE_KEY`, `THEME_DEFAULT_ACCENT_COLOR`.
- Eight new `apps/next/.eslintrc.cjs` module-boundary override blocks (`tenancy`,
  `infrastructure/mail`, `platform/tenants`, `platform/billing`, `platform/provisioning`), plus a fix
  to every existing pattern (see "Decisions made" #1).
- `scripts/provision-demo-tenant.ts` — this app's equivalent of `legacy/api/src/seed-demo-tenant.ts`,
  and this dispatch's own exit-gate proof script.

**Explicitly out of scope** (deferred, not silently skipped):
- `middleware.ts` / tenant resolution from the `Host` header, and `TenantResolutionCache` — needs
  auth context to be meaningful; next Phase 1 sub-dispatch.
- `auth`, `rbac` (application layer), `users`, `profile`, `files`, `reliability` modules — later
  Phase 1 sub-dispatches.
- Any UI beyond what's needed to prove backend logic works — no admin console (Phase 2).
- `docker-compose` wiring — Phase 10's job.
- Full CRUD for packages/features/subscriptions (Platform Admin catalog management, Stripe
  integration) — Phase 2 (`platform/billing`).
- Tenant branding read/write (`getBranding`/`updateBranding`, `color-contrast.ts`'s WCAG contrast
  validator) — Phase 9, per the migration plan's own phase sequence. The `logoUrl`/
  `accentColorOverride` *columns* exist on `TenantEntity`/the migration (see "Decisions made" #2) so
  Phase 9 doesn't need a reshaping migration, but no read/write logic for them exists yet.
- Real SMTP email delivery — only a logged `NoopEmailAdapter` exists this dispatch (matching legacy's
  own multi-phase gap between provisioning and real SMTP landing); real delivery lands alongside
  password-recovery in a later Phase 1 sub-dispatch or Phase 2.
- Taxonomy/exam-authoring/curriculum/PDF-processing/attempts/reliability/media/practice tenant-schema
  tables and entities — each belongs to its own later migration-plan phase (3/4/6/7/8).

### Exit gate (this dispatch's own lightweight recipe)

1. `next build` succeeds cleanly for `apps/next`. **PASS** — verified.
2. `eslint --max-warnings=0` clean on `apps/next`, including a deliberately-added-then-reverted
   module-boundary violation proving the new rules actually fire. **PASS** — a scratch file
   deep-importing past all 6 new/fixed barrels was added, confirmed to fail with the expected
   6 `no-restricted-imports` errors (one per module, including the fixed recursive `database`
   pattern), then removed; lint is clean again.
3. Accumulated TypeORM migrations (platform + a real tenant schema) applied cleanly against real
   MySQL; seed produces the exact expected catalog dataset (row counts/shape, not just "it ran").
   **PASS** — see "Verification evidence" below.
4. Unit tests for the new pure-logic code (provisioning step sequencing/idempotency, catalog
   read-path, tenant-slug/email validation, tenant-service lifecycle rules, tenant-DataSource-registry
   LRU/eviction/idle-reaping). **PASS** — 76 tests total (58 pure-unit + hand-built fakes, 18 real-
   MySQL integration), all green; coverage 89.58% statements/lines, 90.18% branch, 78.91% functions
   on `src/server/**` — clears the dispatch's "≥80% line/branch" bar.
5. Real end-to-end proof: provisioned a tenant through the actual `TenantProvisioningService` against
   real MySQL; confirmed tenant schema created, migrations applied to it, a subscription row created
   via `CreateSubscriptionStep` referencing the seeded `starter` package, and the provisioning-step
   table shows every step `Completed`. **PASS** — via both `scripts/provision-demo-tenant.ts` (a
   durable `demo-next` tenant, left in place as an operator convenience) and a self-cleaning vitest
   integration test (`tenant-provisioning.integration.test.ts`, unique-slug-per-run, drops its own
   tenant schema + platform rows in `afterAll`).
6. Legacy containers (`exam-4u-api-1`, `-worker-1`, `-mysql-1`, `-qdrant-1`, `-mailhog-1`) completely
   undisturbed throughout. **PASS** — `docker ps` diffed before/after every verification step; the
   legacy `examland_platform.tenant` row count stayed at 1 throughout.

### Verification evidence

Ran against the already-running `exam-4u-mysql-1` container (`docker/docker-compose.dev.yml`'s own
host port/credentials, per Phase 0's precedent — see "Decisions made" #3 for why a **different**
schema name than Phase 0 used was required this time):

```
DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next \
  npx vitest run --coverage        # 11 test files, 76 tests, all green
DB_HOST=... npm run provision-demo-tenant -w apps/next     # provisions t_demo_next_*, Active
```

Platform migrations verified: `SELECT name FROM migrations` on `examland_platform_next` lists all 7
in order; `feature`/`package`/`package_feature` row counts are exactly 9/3/27; `starter`'s per-feature
limits match the approved dataset exactly (`exams.create=5`, `pdf.pages=50`, etc.); enterprise's
limits are all `NULL`.

Tenant schema verified (`t_demo_next_9d9ee796`, and separately a throwaway `t_it_*` schema the
integration test drops after asserting): `migrations` table contains `CreateRbacTables20260815000001`;
`user`/`role`/`permission`/`user_role`/`role_permission` tables exist; the invited admin user has
`password_hash IS NULL` and is granted the `Tenant Admin` role; `tenant_provisioning_step` shows all 6
steps `Completed` with `attempts = 1`; `tenant_subscription` references the seeded `starter` package
with `status = 'ACTIVE'`.

### Decisions made (LLD/plan silent, or a genuine judgment call — smallest-reasonable-choice standard)

1. **`tenancy/` vs `platform/provisioning` vs `infrastructure/database/tenant` — the three-way split
   the dispatch asked me to resolve.** Legacy has `platform/tenants` (tenant CRUD) separate from
   top-level `tenancy/provisioning` (the workflow) and `tenancy/domain/*` (shared types/ports), with
   the tenant `DataSource` registry itself living under `infrastructure/database/tenant/`. The new
   app's "New app structure" section lists a bare `server/tenancy/` alongside
   `server/platform/{tenants, billing, provisioning, ai-models}` with no further detail. Resolved as:
   - `server/infrastructure/database/tenant/` — the `DataSource` registry/factory (mechanical
     connection-pooling plumbing, matching legacy's own location exactly; Phase 0's own barrel doc
     comment already forward-referenced this exact location, so this isn't a new call so much as
     honoring a commitment Phase 0 already made).
   - `server/tenancy/` — the shared provisioning-*domain* vocabulary only
     (`ProvisioningStep`/`ProvisioningContext`/`TenantProvisioningFailedError`/`EmailPort`) — the
     types/ports both the orchestrator and every individual step depend on, mirroring legacy's
     `tenancy/domain/**` location exactly. Deliberately does **not** yet include the full tenant-
     *resolution* primitives (`TenantResolutionCache`, ALS-based `TenantContextService`/
     `TenantScopeService`) legacy also keeps under `tenancy/` — those only make sense once
     `middleware.ts` exists (next Phase 1 sub-dispatch), and an empty placeholder now would be dead
     code. That sub-dispatch adds them to this same barrel when it lands.
   - `server/platform/provisioning/` — the orchestration *workflow* itself (`TenantProvisioningService`,
     the lock service, the step ledger repository, and all 6 step implementations) — inherently a
     platform-admin operation (only a Platform Admin ever provisions a tenant), matching the
     dispatch's own framing and the migration plan's explicit `platform/provisioning` naming.

   Net effect: "primitives" (DataSource plumbing) sit in `infrastructure/`, "shared vocabulary" sits
   in `tenancy/`, and "the workflow that uses both" sits in `platform/provisioning/` — three distinct
   bounded contexts each get their own ESLint module-boundary rule, matching legacy's own
   Nest-module-per-concept granularity rather than collapsing them into one broad "provisioning"
   catch-all.

2. **Packages/features/subscriptions live under `server/platform/billing/`, not three separate
   modules matching legacy's `platform/{packages,features,subscriptions}` Nest-module split.** The
   migration plan's "New app structure" section names `billing` (not `packages`/`features`/
   `subscriptions`) as the sibling of `tenants`/`provisioning`/`ai-models`, and groups it with Phase
   2's Stripe integration ("`platform/billing` (Stripe), ... packages/features CRUD UI"). Read-path
   repositories for all three tables live together under this one module this dispatch; Phase 2 adds
   the write path (CRUD) and the Stripe adapter to the same module rather than introducing new
   top-level siblings.

3. **Consolidated tenant-table migration, rather than replaying legacy's 4-migration incremental
   history.** Legacy shipped `platform.tenant`'s full column set across `CreateTenantTable` →
   `AddPendingAdminEmailToTenant` → `AddAccentColorOverrideToTenant` → the column half of
   `AddAssignedAiModelToTenant`, each a real `ALTER TABLE` against an already-*deployed* schema with
   live rows. This app's platform schema doesn't exist until this dispatch's own migration creates it
   — there are no deployed rows to preserve across incremental `ALTER`s — so all four are
   consolidated into one `CreateTenantTable20260815000001` migration reflecting the final,
   already-settled LLD shape (including `logoUrl`/`accentColorOverride`/`assignedAiModelId` columns,
   even though their read/write logic is Phase 9/5 scope — see scope section above). Only
   `assigned_ai_model_id`'s FK constraint is deliberately omitted (the referenced `approved_ai_model`
   table doesn't exist until Phase 5) — a documented forward reference, same pattern as
   `CreateRbacTables`' own `user.education_level_id` (no FK until Taxonomy/Phase 3). Every other
   migration this dispatch ports (`tenant_provisioning_step`, `package`, `tenant_subscription`,
   `feature`, `package_feature`, the catalog seed) had exactly one legacy migration each with no later
   `ALTER`s, so those are ported 1:1, unconsolidated. Fresh timestamp-style migration names
   (`20260815NNNNNN`, today's dispatch date) were used instead of reusing legacy's exact `1730000000NNN`
   values, specifically so a reader comparing the two side-by-side never mistakes an intentionally-
   consolidated new-app migration for a byte-identical copy of the legacy one it's based on.

   Only the identity/RBAC tenant-schema migration (`CreateRbacTables`) was ported this dispatch — the
   other 14 legacy tenant migrations (taxonomy, exam-authoring, curriculum, PDF-processing, attempts,
   reliability, idempotency, media, practice) all belong to their own later migration-plan phases
   (3/4/6/7/8, and the explicitly-deferred `reliability` module) and would be dead schema with no
   application-code consumer if ported now. `TENANT_ENTITIES` (the tenant-schema TypeORM entity list)
   stays empty this dispatch for the identical reason `seed_rbac`/`seed_admin_user` use raw SQL, not
   repositories — the `auth`/`rbac`/`users` modules (next Phase 1 sub-dispatch) are what first need
   real `UserEntity`/`RoleEntity`/`PermissionEntity` repository-based access.

4. **`invite_admin` uses a minimal `EmailPort`/`NoopEmailAdapter` pair, not real SMTP.** The dispatch's
   scope list doesn't mention mail infrastructure, and legacy itself didn't add real SMTP
   (`smtp.adapter.ts`) until several phases after its own equivalent of this dispatch (Dev-7/BL-07,
   alongside password-recovery). Building only what `invite_admin` actually needs to run (a logged
   no-op adapter + the `escapeHtml`/`renderBrandedEmail` pure helpers it already depended on in
   legacy) avoids pulling forward SMTP config/wiring that has no other consumer yet. Real delivery
   lands with whichever later phase first needs a human to actually receive an email
   (password-recovery, most likely).

5. **`TenantResolutionCache` invalidation is dropped from `TenantsService`'s mutation methods this
   dispatch** (`create`/`suspend`/`reactivate`/`softDelete`/`updateRegistrationSettings` all called
   `cache.invalidate(slug)` in legacy). No such cache exists yet in this app — it's only meaningful
   once `middleware.ts`'s Host-header resolution path exists (next Phase 1 sub-dispatch, which is
   also where `TenantResolutionCache` itself gets ported). `registry.destroyFor(schemaName)` (the
   `TenantDataSourceRegistry` half of the same "invalidate on mutation" pattern) is **not** dropped —
   the registry is a real, already-built dependency this dispatch delivers, so there's no reason to
   defer wiring it in. The next sub-dispatch re-adds the cache-invalidation calls alongside its own
   `TenantResolutionCache` port.

6. **ESLint module-boundary patterns widened from a single-segment wildcard (`**/database/*`) to a
   recursive one (`**/database/**`), applied to every module, not just the new ones.** Phase 0's
   three modules (`config`/`logging`/`infrastructure/database`) happened to have no nested subfolders
   yet, so the single-segment pattern "worked" by accident — it would not have matched a genuinely
   deep import like `@/server/infrastructure/database/tenant/tenant-data-source-registry` (two path
   segments past the module directory name), which this dispatch's new `tenant/`/`migrations/`/
   `platform/entities` subfolders make a real, exploitable gap. Fixed application-wide (all 8
   modules, not just the 5 new ones) for consistency — verified by the exit-gate's deliberate-
   violation test (item 2 above), which specifically included a `tenant/`-nested deep import to prove
   the fix actually closes the gap it was meant to close. The eight-module override list is also now
   generated from one `MODULES` array (rather than hand-duplicated per Phase 0's original file) to
   keep the "verbose but correct, one override per module" convention from becoming unmaintainable at
   8 (and growing) modules.

7. **Verification against a distinct platform schema name (`examland_platform_next`), not the shared
   `examland_platform` schema Phase 0's own integration test connects to.** `exam-4u-mysql-1`'s
   `examland_platform` schema already holds `legacy/api`'s own fully-migrated tables of the identical
   names this dispatch's migrations also create (`tenant`, `package`, `feature`, ...) — running this
   app's `CREATE TABLE tenant` against it would collide outright. A new schema (`examland_platform_
   next`) plus an additive-only grant (`GRANT ALL PRIVILEGES ON examland_platform_next.* TO
   'examland'@'%'`, run once via the container's root user; confirmed not to touch legacy's own grant
   or any of its existing tables/rows) was created for this dispatch's own isolated verification. The
   **default** `DB_PLATFORM_SCHEMA` in `env.schema.ts` stays `examland_platform` — correct for a real
   standalone deployment (e.g. Phase 10's docker-compose stack, which gets its own fresh MySQL volume
   with no legacy tables to collide with); this override is a dev/verification-only concern for this
   transition period, not a change to the app's real defaults.

8. **`tsx` added as a devDependency** to run `scripts/provision-demo-tenant.ts` directly (this app has
   no NestJS `ts-node`-via-Nest-CLI equivalent). Actively maintained, MIT-licensed, widely adopted —
   passes the ADR's dependency-maturity bar; used only for this one dev/ops script, not shipped in
   the production image.

9. **`experimentalDecorators: true` re-enabled in `apps/next/tsconfig.json`** (Phase 0 had it `false`
   — no TypeORM entities existed yet). `emitDecoratorMetadata` stays `false`: every `@Column` in this
   app's entities passes an explicit `type` option, so the `reflect-metadata` runtime polyfill
   `emitDecoratorMetadata: true` would require is unnecessary — a deliberately narrower TypeORM usage
   than legacy's NestJS app (which needs `emitDecoratorMetadata` for its own constructor-parameter DI,
   unrelated to entities).

10. **`scripts/provision-demo-tenant.ts` explicitly destroys the platform `DataSource` and force-exits
    in a `finally` block.** Without this, the process never exits — the connection pool keeps at
    least one open TCP connection alive, and Node only exits once the event loop is empty. Legacy's
    identical script gets this for free from NestJS's `app.close()` lifecycle hook; this app has no
    DI container to provide that, so explicit teardown is this app's equivalent. Found by actually
    running the script (it hung past a 120s timeout) rather than assuming the composition-root
    pattern used elsewhere in this dispatch would exit cleanly on its own.

## Status

**Sub-slice 1a complete.** All 6 exit-gate items pass (see "Verification evidence" above). 76 tests
green (58 unit + 18 real-MySQL integration), 89.58%/90.18% line/branch coverage on `src/server/**`,
`next build`/`eslint --max-warnings=0`/`tsc --noEmit` all clean, legacy containers confirmed
undisturbed throughout.

**Explicitly not done this dispatch** (see "Scope" above for the full list): `middleware.ts`/tenant
resolution, `auth`/`rbac`/`users`/`profile`/`files`/`reliability`, any admin-console UI, branding
read/write, real SMTP, Stripe/full catalog CRUD, and every tenant-schema table beyond identity/RBAC.
The migration plan's "Phase 1 exception" heavier e2e pass (adapting `auth.e2e-spec.ts`/
`tenant-resolution.e2e-spec.ts`/`rbac.e2e-spec.ts`/`provisioning-workflow.e2e-spec.ts`'s core
assertions) is only fully applicable once the *whole* of Phase 1 lands — this sub-dispatch adapted
`provisioning-workflow.e2e-spec.ts`'s two highest-value scenarios its own scope can meaningfully cover
(happy path; permanent failure leaves the tenant `Failed` forever and a further retry fails
identically) as unit tests; the other three specs' subject systems (auth, RBAC, tenant resolution)
don't exist in this app yet, so adapting them now would just be testing nothing.

Next Phase 1 sub-dispatch: `auth` (dual-realm JWT), `rbac`, `users`, `profile`, `middleware.ts`/tenant
resolution (+ `TenantResolutionCache`), `reliability` (outbox), `files` (signed delivery).

## Sub-slice 1b — Auth (dual-realm JWT), RBAC, and `middleware.ts` tenant resolution

**Goal**: prove Phase 1's full exit gate — provision a tenant end-to-end (already proven by 1a, reused
here), log in to **both** JWT realms, and RBAC-deny a route — against real MySQL and **real HTTP**
(the app booted for real via `next build`/`next start`, not just vitest-level service calls), with
`middleware.ts` genuinely resolving a tenant from a `Host` header.

**Backlog item(s)**: none — tracked via this plan file, matching 1a's own framing.

### Scope

**In scope** (migration plan Phase 1 item list, this dispatch's portion):
- `server/context/` (NEW module) — `request-context.ts` (ALS `RequestContext`, extended with
  `platformAdminId`/`effectivePermissions` beyond 1a's forward-reference), `tenant-context.ts`
  (`requireTenantDataSource`/`requireTenantId`), `with-tenant-context.ts`/`with-platform-auth.ts` (the
  two Route-Handler composition wrappers named in the migration plan's "New app structure").
- `server/tenancy/` (existing module, extended) — `tenant-resolution-cache.ts` (ported verbatim from
  legacy's `TenantResolutionCache`), `tenant-resolution.ts` (`deriveTenantSlug`/`isReservedSlug`/
  `resolveTenantBySlug`/`resolveTenantForRequest`), `raw-tenant-lookup.ts` (see "Decisions made" #3 —
  not in the original plan, a real bug fix).
- `server/infrastructure/security/` (NEW module) — `bcrypt-password-hasher.adapter.ts`,
  `jwt-tenant-token.adapter.ts`, `jwt-platform-token.adapter.ts` (both via `jose`, migration plan's
  explicit library choice), `google-id-token-verifier.adapter.ts` (`google-auth-library`), `ttl.util.ts`.
- `server/auth/` (NEW module, tenant realm) — domain (`auth.types`, `errors`, `password-policy`,
  `reset-token`, ports for `TenantTokenPort`/`GoogleTokenVerifierPort`), infrastructure
  (`user.repository.ts` + the new tenant-schema `UserEntity`), application (`auth.service.ts`: register/
  login/forgotPassword/resetPassword/changePassword/signInWithGoogle), api (`require-tenant-user.ts`,
  the `JwtAuthGuard` equivalent), and Route Handlers under `app/api/auth/**` + `app/api/tenant/
  public-config`.
- `server/rbac/` (NEW module) — domain (`rbac.types`, `errors`), infrastructure (`role.repository.ts`/
  `permission.repository.ts`/`user-role.repository.ts` + the new tenant-schema `RoleEntity`/
  `PermissionEntity`), application (`permission-resolution.service.ts`, `roles.service.ts`,
  `permissions-crud.service.ts`, `user-role-assignment.service.ts`), api (`require-permission.ts`, the
  `PermissionsGuard` equivalent), and Route Handlers under `app/api/roles/**` + `app/api/permissions`.
- `server/platform/auth/` (NEW module, platform realm) — domain (`platform-admin.types`, `errors`,
  `PlatformAdminTokenPort`), infrastructure (`platform-admin.repository.ts` + the new platform-schema
  `PlatformAdminEntity`), application (`platform-admin-auth.service.ts`,
  `platform-admin-bootstrap.service.ts`), and Route Handlers under `app/api/platform/auth/**`.
- `src/middleware.ts` (NEW, Node runtime) — the migration plan's tenant-resolution entry point.
- New tenant-schema entities (`UserEntity`/`RoleEntity`/`PermissionEntity`, all mapping sub-slice 1a's
  already-migrated `user`/`role`/`permission` tables) and one new platform migration
  (`20260815000008-create-platform-admin-table.ts`, ported from legacy's `1730000000006-create-
  platform-admin-table.ts` — sub-slice 1a's own migration-index doc comment explicitly deferred this).
- `src/instrumentation.ts` extended to call `runPlatformAdminBootstrap()` once per boot (this app's
  equivalent of legacy's `OnApplicationBootstrap` lifecycle hook).
- Five new `apps/next/.eslintrc.cjs` module-boundary override blocks (`context`,
  `infrastructure/security`, `auth`, `rbac`, `platform/auth`), added to the existing generated
  `MODULES` array.
- New env vars in `server/config/env.schema.ts`: `JWT_TENANT_SECRET`/`JWT_PLATFORM_SECRET` (+ the
  cross-field "must differ" invariant, checked in every environment), `JWT_TENANT_TTL`/
  `JWT_PLATFORM_TTL`, `BCRYPT_COST`, `PLATFORM_ADMIN_BOOTSTRAP_EMAIL`/`_PASSWORD`,
  `PASSWORD_MIN_LENGTH`/`PASSWORD_REQUIRE_{UPPER,LOWER,DIGIT,SYMBOL}`, `RESET_TOKEN_TTL_MIN`,
  `GOOGLE_CLIENT_ID`/`GOOGLE_AUTH_BRIDGE_ORIGIN`, `DEFAULT_TENANT_SUBDOMAIN`,
  `TENANT_CACHE_TTL_MS`/`TENANT_CACHE_NEG_TTL_MS`.
- `server/common/errors/domain-error.ts` extended with `UnauthenticatedError`/`ForbiddenDomainError`/
  `NotFoundDomainError`/`InternalDomainError` (generic, cross-realm errors — ported verbatim from
  legacy's identical base-class file).
- `server/common/http/error-envelope.ts` (the `ErrorResponseWriter`/`AllExceptionsFilter` equivalent —
  every Route Handler's `DomainError`→`NextResponse` translation chokepoint) and
  `server/common/http/validate.ts` (minimal hand-rolled request-body validation — no `class-validator`
  equivalent exists in this app).
- `server/common/ports/password-hasher.port.ts` (shared by both realms, no module boundary — same
  "shared-kernel, stateless" precedent as `DomainError` itself).
- **Bug fix, not originally scoped** (see "Decisions made" #3): `dataSource.getRepository(EntityClass)`
  changed to `dataSource.getRepository<EntityClass>('table_name_string')` in **every** repository in
  this app (both this dispatch's five new ones and sub-slice 1a's six pre-existing ones) — a real,
  production-breaking cross-webpack-bundle bug found only by actually booting the built app and
  sending real HTTP requests.

**Explicitly out of scope** (deferred, not silently skipped):
- `users`/`profile`/`files`/`reliability` modules — next Phase 1 sub-dispatch (1c), per the dispatch's
  own instruction.
- Any login/register/admin-console UI — no UI work is scoped to Phase 1 per the migration plan's phase
  list (Phase 1's own exit gate is explicitly HTTP-only, "this can and should be proven via direct HTTP
  calls to Route Handlers, not a UI").
- Real Google OAuth verification against Google's live servers — see "Decisions made" #2.
- `PUT /users/:id/roles`-style role-assignment HTTP surface for `UserRoleAssignmentService` — matches
  legacy's own identical-phase scope (that service is proven only via direct calls; no controller
  exists in legacy either until the not-yet-built `modules/users`).
- `POST /api/permissions/:id` (delete) HTTP route for `PermissionsCrudService.delete` — matches
  legacy's own "not yet wired to a controller" precedent (the method exists and is tested to prove/
  exercise `PERMISSION_IN_USE`, exactly as legacy's e2e suite does it).
- `TenantResolutionCache.invalidate(slug)` wiring into `TenantsService`'s mutation methods (suspend/
  reactivate/etc.) — the cache now exists (this dispatch), but wiring every mutation call site is a
  small follow-up; the cache's own bounded TTL (60s positive/15s negative) already bounds the staleness
  window in the meantime.

### Exit gate

1. `next build` succeeds cleanly. **PASS.**
2. `eslint --max-warnings=0` clean, including a deliberately-added-then-reverted module-boundary
   violation proving the five new rules fire. **PASS** — a scratch file deep-importing past all five
   new modules' barrels was added, confirmed to fail with the expected 5 `no-restricted-imports`
   errors (one per module), then removed; lint is clean again.
3. Accumulated migrations (platform + tenant) run cleanly against real MySQL, in the same
   `examland_platform_next` isolation schema sub-slice 1a established. **PASS** — see "Verification
   evidence".
4. Unit tests for new pure-logic code (permission resolution/default-deny, password policy, JWT claim
   validation, reset-token logic) — **PASS**, plus substantially more (see below).
5. Real end-to-end proof against real MySQL and real HTTP (the app booted for real via `next start`,
   not vitest-level calls) — **PASS**, all five sub-items:
   - (a) tenant provisioned via the real workflow (`provision-demo-tenant.ts`, `DEMO_TENANT_*` env vars
     pointed at a new `smoke1b` tenant).
   - (b) registered + logged in a real tenant user under `Host: smoke1b.examland.app`; the issued
     `typ='tenant-user'`/`aud='tenant'` JWT was accepted on `GET /api/auth/me` (200, correct
     `email`/`permissions: []`) and rejected everywhere it shouldn't be (see below).
   - (c) logged in as the instrumentation-bootstrapped Platform Admin; the issued
     `typ='platform-admin'`/`aud='platform'` JWT was accepted on `GET /api/platform/auth/me` (200).
   - (d) a real `curl -H "Host: smoke1b.examland.app"` request resolved the correct tenant
     (`GET /api/tenant/public-config` returned that tenant's real name/branding); a nonexistent
     subdomain and a reserved subdomain (`admin`) both correctly 404'd as `TENANT_NOT_FOUND`.
   - (e) `GET /api/roles` as the newly-registered (zero-role) member returned a real `403 FORBIDDEN`
     with `"Missing required permission(s): roles.read."`.
   - Additional real-HTTP proofs performed beyond the dispatch's minimum: cross-realm rejection both
     directions (tenant-user token → `platform/auth/me` = 401; platform-admin token → tenant
     `auth/me` = 401), and no-`Authorization`-header → 401.
6. Adapted the highest-value assertions from `auth.e2e-spec.ts`/`tenant-resolution.e2e-spec.ts`/
   `rbac.e2e-spec.ts` — see "Verification evidence" for the explicit covered-vs-deferred breakdown.
7. Legacy containers (`exam-4u-api-1`, `-worker-1`, `-mysql-1`, `-qdrant-1`, `-mailhog-1`) completely
   undisturbed. **PASS** — `docker ps` diffed before/after every verification step (including the real
   HTTP smoke pass); uptimes/health progressed naturally with no restarts.

### Verification evidence

**Automated tests**: `251` tests green (running with `DB_HOST=localhost DB_USER=examland
DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next JWT_TENANT_SECRET=... JWT_PLATFORM_
SECRET=...`), combining unit tests (fakes-based, no I/O) and real-MySQL integration tests (a new
`auth-rbac-platform.integration.test.ts` provisions a throwaway tenant via the real
`TenantProvisioningService`, then exercises `getAuthService`/`getRolesService`/
`getUserRoleAssignmentService`/`withTenantContext`/`withPlatformAuth`/`requireTenantUser`/
`requirePermission` against real MySQL and real `jose`/`bcrypt`, cleaning up its own tenant schema +
platform rows in `afterAll`; plus a dedicated `raw-tenant-lookup.integration.test.ts` proving the
actual `middleware.ts` production code path resolves a real tenant). Coverage: **91.49% statements /
91.17% branch / 85.18% functions / 91.49% lines** on `src/server/**` (`vitest run --coverage`) —
clears the "≥80%, or higher of the project's own configured threshold" bar; the only files at/near 0%
are pure-type files with no executable statements (`*.types.ts`, port interfaces) or the real-Google-
verification branch of `google-id-token-verifier.adapter.ts` (see "Decisions made" #2).

**Real end-to-end HTTP pass** (the exit gate's own explicit "boot the app for real" requirement):
`next build` then `next start -p 3177` (so `NODE_ENV=production`, making `middleware.ts`'s real
`Host`-header-derivation branch — not the dev/test `DEFAULT_TENANT_SUBDOMAIN` bypass — actually run),
against the already-running `exam-4u-mysql-1` container's `examland_platform_next` schema, with a
freshly-provisioned `smoke1b` tenant (via `provision-demo-tenant.ts`) and a fresh
`PLATFORM_ADMIN_BOOTSTRAP_EMAIL`/`_PASSWORD`-seeded Platform Admin (proving `instrumentation.ts`'s
bootstrap wiring fires on a real boot). Every exit-gate-5 sub-item above was proven via real `curl`
requests against the real running server, not simulated.

**Adapted e2e assertions — explicit covered vs. deferred breakdown** (per the migration plan's Phase 1
exception and this dispatch's own instruction to document this explicitly):

| Source spec | Assertion | Status |
|---|---|---|
| `auth.e2e-spec.ts` | Login enumeration-safety: unknown email / wrong password / invited-no-password account all reject identically as `INVALID_CREDENTIALS` | **Covered** (`auth.service.test.ts`, real-HTTP smoke) |
| `auth.e2e-spec.ts` | Dummy-hash timing-equalization (hasher always invoked, even for unknown email) | **Covered** (`auth.service.test.ts`) |
| `auth.e2e-spec.ts` | Coarse timing benchmark (5-round median comparison) | **Deferred** — low-value, environment-noise-sensitive; the dummy-hash-always-invoked unit assertion already proves the mechanism exists |
| `auth.e2e-spec.ts` | Cross-tenant JWT replay barrier (`tid` mismatch → 401) | **Covered** (`require-tenant-user.test.ts` unit + real two-tenant integration test) |
| `auth.e2e-spec.ts` | Register/login/`GET /auth/me` happy path | **Covered** (integration test + real-HTTP smoke) |
| `auth.e2e-spec.ts` | Same email registrable in two different tenants | **Deferred** — structurally guaranteed by schema-per-tenant isolation (the `user` table physically doesn't exist outside its own tenant schema); not worth a second real tenant schema's provisioning cost to re-prove this dispatch |
| `auth.e2e-spec.ts` | `WEAK_PASSWORD` violation naming | **Covered** (`password-policy.test.ts` exhaustively; `auth.service.test.ts` proves the service wires it) |
| `auth.e2e-spec.ts` | `GET /tenant/public-config` shape incl. `googleClientId` omission-when-unset | **Covered** (real-HTTP smoke — exact JSON shape asserted) |
| `platform-auth.e2e-spec.ts` | Login enumeration-safety incl. deactivated-admin-identical-error | **Covered** (`platform-admin-auth.service.test.ts`) |
| `platform-auth.e2e-spec.ts` | Reachable with no `Host` header | **Covered** (real-HTTP smoke — no `Host` header sent to any `/api/platform/**` request) |
| `platform-auth.e2e-spec.ts` | Cross-realm barriers both directions + positive control | **Covered** (jwt adapter unit tests, integration test, real-HTTP smoke) |
| `rbac.e2e-spec.ts` | Fail-closed default (zero roles → 403 on a permission-gated route) | **Covered** (real-HTTP smoke, integration test) |
| `rbac.e2e-spec.ts` | Guard order (unauthenticated → 401 before any permission check) | **Covered** (real-HTTP smoke: no bearer token → 401 on `/api/roles`) |
| `rbac.e2e-spec.ts` | Tenant Admin sees full seeded role/permission catalog | **Adapted, not identical** — proven indirectly (a Tenant-Admin-promoted user passes `requirePermission('roles.read')`, a permission only that role grants) rather than asserting the literal `>10`/list-length legacy checks |
| `rbac.e2e-spec.ts` | `LAST_ADMIN_PROTECTED` (sole-admin demotion, hard-delete guard, no-partial-write, demotion-allowed-with-second-admin) | **Covered**, all four sub-scenarios (`user-role-assignment.service.test.ts`) |
| `rbac.e2e-spec.ts` | `SYSTEM_ROLE_PROTECTED` | **Covered** (`roles.service.test.ts`) |
| `rbac.e2e-spec.ts` | `ROLE_IN_USE` reject-then-deletable-after-unassignment | **Covered, split across two tests** rather than one continuous narrative (functionally equivalent) |
| `rbac.e2e-spec.ts` | `PERMISSION_IN_USE` | **Covered** (`permissions-crud.service.test.ts`) |
| `rbac.e2e-spec.ts` | Union-of-roles permission resolution | **Covered** (`permission-resolution.service.test.ts`) |
| `tenant-resolution.e2e-spec.ts` | Reserved / nonexistent slug → 404 `TENANT_NOT_FOUND`, indistinguishable | **Covered** (`tenant-resolution.test.ts` unit + real-HTTP smoke) |
| `tenant-resolution.e2e-spec.ts` | Suspended → 403; Provisioning/Failed → 503 | **Covered** (real-MySQL integration test, mutating a real tenant's `status` and re-resolving) |
| `tenant-resolution.e2e-spec.ts` | Active tenant resolves and reaches routing | **Covered** (real-HTTP smoke) |
| `tenant-resolution.e2e-spec.ts` | Cache warm-hit repeat request | **Covered** (`tenant-resolution-cache.test.ts` + `tenant-resolution.test.ts`'s "serves a cache hit without calling the repository again") |

### Decisions made (LLD/plan silent, or a genuine judgment call — smallest-reasonable-choice standard)

1. **`server/context/` vs `server/tenancy/` split** (the dispatch prompt specifically asked me to
   flag/reason about this). Legacy keeps `TenantResolutionCache` (pure lookup/cache) and
   `TenantContextService`/`TenantScopeService` (ALS-based ambient-context binding) together under one
   `tenancy/` NestJS module. This app splits them: `server/tenancy/` stays scoped to "resolve a `Host`
   header (or slug) to a tenant row" — pure domain/lookup logic with no per-request state of its own —
   while `server/context/` owns "bind the resolved tenant into the current request's ALS scope, acquire
   its pooled `DataSource`, and translate a thrown `DomainError` into an HTTP response" — genuinely
   different, request-lifecycle-shaped responsibilities. They were only co-located in legacy because
   Nest's middleware/DI-scope mechanism made that convenient there, not because they're one concern.
   This also matches the migration plan's own explicit "New app structure" naming
   (`context/ (request-context.ts ALS + withTenantContext/withPlatformAuth)` listed as its own
   top-level entry, separate from `tenancy/`).
2. **Google Sign-In: real adapter shipped, real end-to-end verification not exercisable in this
   environment.** `GoogleIdTokenVerifierAdapter` is a complete, faithful port of legacy's
   `google-auth-library`-based verifier (not a stub) — but this repo's own running `.env` has
   `GOOGLE_CLIENT_ID=` (blank), meaning no real Google Cloud OAuth client is provisioned here, matching
   legacy's own identical gap. `auth.service.test.ts` exercises `AuthService.signInWithGoogle`'s full
   branching logic (disabled/not-configured/invalid-token/create-on-the-fly/reuse-existing/inactive)
   against a fake `GoogleTokenVerifierPort`-shaped object, exactly matching legacy's own `.spec.ts`
   precedent for this identical gap. Flagged here explicitly per the dispatch's own instruction, rather
   than silently building an approximation as if it were fully verified end to end.
3. **A real, production-breaking bug found (and fixed) only by actually booting the built app and
   sending real HTTP requests — not caught by any vitest-only test.** `dataSource.getRepository
   (EntityClass)` looks up TypeORM entity metadata by reference equality on the entity class, falling
   back to matching the class's own (possibly-minified) `.name` string. Next.js always compiles
   `middleware.ts` as its own, fully separate webpack bundle from every Route Handler's shared server
   bundle — and, it turns out, can also duplicate a shared module across *different route handlers'*
   own bundles under production minification. Once any one bundle's copy of an entity class registers
   the platform `DataSource`'s metadata, every *other* bundle's copy of that same class fails lookup
   with `EntityMetadataNotFoundError`, because production minification gives each bundle's copy a
   different mangled `.name` (observed verbatim: `"No metadata for 'h'/'n'/'ea' was found."` against a
   real `next start` boot + real `curl` requests). **Fix**: every repository in this app (this
   dispatch's five new ones — `user`/`role`/`permission`/`platform-admin` — and sub-slice 1a's six
   pre-existing ones — `tenant`/`tenant_provisioning_step`/`package`/`feature`/`package_feature`/
   `tenant_subscription`) now calls `dataSource.getRepository<EntityClass>('literal_table_name_string')`
   instead of passing the class reference — TypeORM matches a plain string against `metadata.tableName`
   first, which is immune to any class-identity/minification issue since it's a literal I write, not a
   runtime-derived identifier. `middleware.ts`'s own tenant lookup goes further: it never touches the
   entity-based platform `DataSource` at all (a new `raw-tenant-lookup.ts`, a dedicated raw `mysql2`
   pool with zero TypeORM entities), both because middleware should stay lightweight per the migration
   plan's own framing and because it's the one bundle *guaranteed* to always be separate. This is the
   single most significant finding of this dispatch — flagged prominently rather than left as a latent,
   previously-undiscovered defect in sub-slice 1a's own repositories.
4. **`platform_admin` migration numbered `20260815000008` (append-only, not renumbered/inserted into
   sub-slice 1a's existing 7)** — matches that migration set's own "later phases append their own
   platform migrations here" convention; no FK dependency on anything in `PLATFORM_MIGRATIONS` forces a
   different position.
5. **`PlatformAdminAuthService` and `AuthService` deliberately have *different* deactivated-account
   behavior, ported faithfully rather than "fixed" to match each other.** The tenant realm's `login()`
   throws a distinguishable `UserInactiveError` once credentials are already proven correct (no
   enumeration-safety concern past that point); the platform realm's `login()` throws the *identical*
   `PlatformInvalidCredentialsError` for a deactivated admin even with the correct password (no separate
   code at all). Both are legacy's own real, tested behavior — reproduced verbatim rather than
   unified, since introducing consistency here wasn't in scope and legacy's own test suite pins each
   realm's distinct contract explicitly.
6. **`requirePermission`/`requireTenantUser` are plain async functions a Route Handler calls explicitly
   (not a decorator/guard mechanism)** — the migration plan's own framing ("a helper Route Handlers
   call, since there's no NestJS guard/decorator mechanism in Next.js"); every permission-gated route
   calls `requireTenantUser` then `requirePermission` in that literal order in its own handler body,
   reproducing `@UseGuards(JwtAuthGuard, PermissionsGuard)`'s left-to-right short-circuit ordering
   structurally (the second call is simply unreachable if the first throws) rather than via any
   framework-level composition.
7. **Hand-rolled request validation (`server/common/http/validate.ts`), not a `class-validator`
   equivalent.** No DTO-decorator validation library is wired into this app; each Route Handler calls
   small `requireString`/`requireEmail` helpers matching legacy's DTO field names/bounds (not its exact
   class-validator message text, which isn't part of the tested wire contract — only the
   `VALIDATION_FAILED` code and field names are).
8. **`jose` (already present transitively via `legacy/web`'s own MCP SDK dependency) and `bcrypt`/
   `google-auth-library` (already present, matching versions, via `legacy/api`'s own dependencies)
   added as explicit `apps/next` dependencies at their already-vetted versions** — no new
   dependency-maturity review needed (all three are already in production use elsewhere in this exact
   repo).

## Status

**Sub-slice 1b complete.** All 7 exit-gate items pass (see "Verification evidence" above). 251 tests
green, 91.49%/91.17% statement/branch coverage on `src/server/**`, `next build`/
`eslint --max-warnings=0`/`tsc --noEmit` all clean, legacy containers confirmed undisturbed throughout
(including the real-HTTP smoke pass). A real, previously-latent, production-breaking cross-webpack-
bundle TypeORM bug (see "Decisions made" #3) was found and fixed across every repository in the app,
not just this dispatch's own new ones.

**Explicitly not done this dispatch** (see "Scope" above for the full list): `users`/`profile`/
`files`/`reliability` modules, any UI, real Google OAuth end-to-end verification, the
`UserRoleAssignmentService`/`PermissionsCrudService.delete` HTTP surfaces, and
`TenantResolutionCache.invalidate` wiring into `TenantsService`'s mutation methods.

Next Phase 1 sub-dispatch: `users`, `profile`, `reliability` (outbox), `files` (signed delivery) — per
the migration plan's Phase 1 item list, this is the remaining, smallest slice before Phase 1's overall
exit gate ("provision a tenant end-to-end via the real workflow, log in to both realms, RBAC-deny a
route") can be declared fully closed at the whole-phase level (it is already closed at this
sub-dispatch's own scope, per the exit gate above).

## Sub-slice 1c — `users`, `profile`, `files`, `reliability`, and the `ROLE=worker` outbox publisher

**Goal**: complete Phase 1's item list — admin CRUD over users (`users`), authenticated self-service
profile read/update/avatar-upload (`profile`), HMAC-signed file delivery (`files`), and the
transactional-outbox pattern plus a real, running `ROLE=worker` process (`reliability` +
`server/workers`) — and, since this is the last planned Phase 1 sub-dispatch, re-confirm the
whole-Phase-1 exit gate end to end with everything from 1a+1b+1c present simultaneously.

**Backlog item(s)**: none — tracked via this plan file, matching 1a/1b's own framing.

### Scope

**In scope** (migration plan Phase 1 item list, this dispatch's portion):
- `server/users/` (NEW module) — domain (`user.types`, `errors`), infrastructure
  (`user-admin.repository.ts`, reusing tenant-schema `UserEntity`), application (`users.service.ts`:
  list/get/create/update/delete/replaceRoles), and Route Handlers under `app/api/users/**`. Reuses
  1b's already-built `rbac`'s `RoleRepository`/`UserRoleRepository`/`UserRoleAssignmentService`
  directly (no duplication) — `PUT /api/users/:id/roles` is this dispatch's first HTTP surface for
  `UserRoleAssignmentService`, closing 1b's own documented deferral.
- `server/profile/` (NEW module) — domain (`profile.types`, `errors`), infrastructure
  (`profile.repository.ts`), application (`profile.service.ts`: getProfile/updateProfile/
  uploadPicture), and Route Handlers under `app/api/profile/**` (including `POST /api/profile/
  picture`, this app's `multer`-free avatar-upload surface via the Fetch `FormData` API).
- `server/files/` (NEW module) — domain (`errors`), application (`file-signing.service.ts`:
  sign/verify/stat, `range.util.ts`: `parseRangeHeader`), and Route Handlers `POST /api/files/sign` +
  `GET /api/files/d/[...path]` (the latter deliberately **not** wrapped in `withTenantContext`/
  `requireTenantUser` — HMAC+expiry is the sole gate, matching legacy and the dispatch's own explicit
  instruction).
- `server/common/ports/storage.port.ts` (NEW, shared-kernel, no module boundary — matches
  `password-hasher.port.ts`'s precedent) + `server/infrastructure/storage/` (NEW module) —
  `local-disk.adapter.ts` ported verbatim, `createStoragePort()` composition point.
- `server/common/util/image-signature.util.ts` (NEW) — magic-byte sniffing for JPEG/PNG/WebP, ported
  verbatim (pure logic, no module boundary — matches `email.util.ts`/`tenant-slug.util.ts`'s
  precedent).
- `server/reliability/` (NEW module) — domain (`outbox-consumer.types.ts`), infrastructure
  (`outbox.repository.ts`, `file-cleanup.repository.ts`), application (`outbox-publisher.service.ts`,
  `consumers/logging-audit-trail.consumer.ts` — see "Decisions made" #2 for why this is a stand-in,
  not a port of legacy's `AuditTrailOutboxConsumer`).
- `server/workers/{outbox-publisher.ts, worker-entrypoint.ts}` (NEW, composition-root/entrypoint —
  deliberately **not** a module-boundary-protected barrel, matching `scripts/provision-demo-tenant.ts`'s
  own precedent: nothing imports from it, it only imports from other modules' public barrels).
  `runOutboxFullSweep` ties `reliability` + `platform/tenants` (enumerate `Active` tenants) +
  `infrastructure/database` (acquire/release each tenant's pooled `DataSource`) + `context`
  (bind an ALS scope matching `withTenantContext`'s shape) together — the orchestration legacy's own
  `OutboxPublisher.runFullSweep`/`TenantScopeService.runFor` performed. `npm run worker` (new
  `package.json` script, `tsx src/server/workers/worker-entrypoint.ts`) runs it directly today;
  real `ROLE`-based container `CMD` switching is Phase 10's docker-compose/Dockerfile job.
- New tenant-schema migration `20260815000002-create-reliability-tables.ts` (`outbox_message`,
  `processed_event`, `file_cleanup_queue`) + their entities, appended to `TENANT_ENTITIES`/
  `TENANT_MIGRATIONS`. No new `user`-table migration was needed — 1b's own `CreateRbacTables`
  migration already included `pic`/`education_level_id`/`last_login_at` as forward references
  `users`/`profile` are the first to actually read/write.
- New env vars: `STORAGE_DRIVER`/`STORAGE_ROOT`/`FILE_SIGNING_SECRET`/`SIGNED_URL_TTL_SEC`/
  `MAX_AVATAR_SIZE_BYTES` (storage/files), `WORKER_OUTBOX_TICK_MS` (reliability/workers).
  `FILE_SIGNING_SECRET` added to `REQUIRED_IN_DEPLOYED_ENVS`.
- Five new `apps/next/.eslintrc.cjs` module-boundary override blocks (`reliability`,
  `infrastructure/storage`, `files`, `profile`, `users`), added to the existing generated `MODULES`
  array (now 18 entries total).
- `server/auth/index.ts` extended to export `evaluatePasswordPolicy` (previously internal to the
  `auth` module) — `users.service.ts`'s admin-password-strength check reuses it rather than
  duplicating the policy logic.

**Explicitly out of scope** (deferred, not silently skipped, per the dispatch's own instruction):
- Any UI/pages — no UI is scoped to Phase 1 per the migration plan's phase list.
- `stale-session-recovery.worker.ts`, `attempt-timeout-sweeper.worker.ts`, `TenantMaintenanceWorker`'s
  full hygiene sweep (`drainFileCleanupQueue`, provisioning-retry sweep) — each belongs to a module
  that doesn't exist in this app yet (`pdf-processing` Phase 6, `attempts` Phase 7, the fuller
  tenant-maintenance duties spanning phases not yet built). `file_cleanup_queue` rows are correctly
  scheduled by `profile`'s avatar-replacement flow but nothing drains them yet — a documented, inert
  gap, not a bug.
- `AuditTrailOutboxConsumer` (legacy's real audit-log-backed consumer) — checked `platform/audit`
  first per instruction; it doesn't exist in this app (Phase 2 scope). See "Decisions made" #2 for
  what was built instead and why.
- The outbox **hinted sweep** / `platform.tenant_work_hint` table (HLD §10.2's throughput
  optimization) — only the full-sweep safety net is built this dispatch; see "Decisions made" #3.
- `UserDisplayResolverService` (legacy's soft-reference-on-delete display helper) — no consumer
  exists yet (`attempt`/`curriculum` tables are Phase 6/7/8); porting it now would be unused code.

### Exit gate

1. `next build` succeeds cleanly. **PASS.**
2. `eslint --max-warnings=0` clean, including a deliberately-added-then-reverted module-boundary
   violation proving the five new rules fire. **PASS** — a scratch file deep-importing past all five
   new modules' barrels (`reliability`, `infrastructure/storage`, `files`, `profile`, `users`) was
   added, confirmed to fail with the expected 5 `no-restricted-imports` errors (one per module), then
   removed; lint is clean again.
3. Accumulated migrations (platform + tenant) run cleanly against real MySQL, in the same
   `examland_platform_next` isolation schema sub-slices 1a/1b established. **PASS** — the new
   `outbox_message`/`processed_event`/`file_cleanup_queue` tables were confirmed present in a real,
   freshly-provisioned tenant schema (`information_schema.tables` query, see "Verification evidence").
4. Unit tests for new pure-logic code (range-header parsing, HMAC sign/verify, outbox claim/idempotency
   logic) — **PASS**, plus substantially more (see below).
5. Real end-to-end proof against real MySQL + real HTTP (the app booted for real via `next build`/
   `next start`) — **PASS**, all five sub-items (see "Verification evidence" for the full transcript
   summary):
   - (a) an authenticated tenant-admin created/updated another user and assigned a role via the real
     `users` API (`POST /api/users` → 201 with a generated `temporaryPassword`; `PATCH /api/users/:id`;
     `PUT /api/users/:id/roles`).
   - (b) a tenant-user read/updated their own profile via the real `profile` API (`GET`/`PATCH
     /api/profile`), and uploaded/replaced a real avatar via `POST /api/profile/picture`.
   - (c) `POST /api/files/sign` issued a signed URL and `GET /api/files/d/[...path]` served the real
     file content, including a genuine `Range: bytes=0-3` request returning `206` with the correct
     `Content-Range`, an unsatisfiable range returning `416`, a tampered signature and an expired link
     both returning `403 LINK_INVALID_OR_EXPIRED`, and a path-traversal attempt returning
     `400 PATH_TRAVERSAL_REJECTED`.
   - (d) a real `user.created` outbox message (enqueued atomically by `UserAdminRepository.insert`
     from the real `POST /api/users` call in (a)) was picked up and marked delivered by a real,
     separately-run `ROLE=worker` process (`npm run worker`'s underlying script, `tsx
     src/server/workers/worker-entrypoint.ts`) — not just unit-tested — with a genuine
     idempotent-redelivery-is-a-no-op proof: the row was reset to claimable, the worker re-ran,
     `processed_at` was set again but the consumer's own side effect (`outbox.user.created` structured
     log line) did **not** fire a second time.
6. Whole-Phase-1 exit gate re-confirmed with 1a+1b+1c all present simultaneously, by a fresh direct
   check (not re-citing 1a/1b's own prior evidence): provisioned a new tenant (`smoke1c`) via the real
   workflow; logged in to **both** realms (a promoted Tenant Admin via `POST /api/auth/login`, and the
   platform realm via `POST /api/platform/auth/login`); RBAC-denied a route (`POST /api/users` as a
   zero-role member → `403 FORBIDDEN`, and no-bearer-token → `401 UNAUTHENTICATED`); confirmed
   cross-realm token rejection both directions. **PASS.**
7. Legacy containers (`exam-4u-api-1`, `-worker-1`, `-mysql-1`, `-qdrant-1`, `-mailhog-1`) completely
   undisturbed throughout. **PASS** — `docker ps` diffed before/after every verification step
   (including the real-HTTP smoke pass and the real worker-process run); only uptime counters changed.

### Verification evidence

**Automated tests**: `339` tests green (up from 1b's 251; running with the same
`DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next
JWT_TENANT_SECRET=... JWT_PLATFORM_SECRET=...` env), combining unit tests (fakes-based, no I/O) and a
new real-MySQL integration test
(`reliability-users-profile-files.integration.test.ts`) that provisions a throwaway tenant via the
real `TenantProvisioningService`, then exercises: the reliability migration's table shapes; a real
`UsersService.create()` admin-create + role-assignment + atomic outbox enqueue; a real
`OutboxPublisherService.processTenantBatch` claim/deliver pass plus a simulated-redelivery
idempotency proof (via a spy consumer, filtering its calls to the specific message under test since
sibling tests in the same shared tenant schema also enqueue undrained `user.created` events); the
real `runOutboxFullSweep` composition root discovering and delivering a pending message for the real
`Active` tenant; a real `ProfileService` read/update/avatar-replace round trip proving
`file_cleanup_queue` scheduling; and a real `FileSigningService` sign/verify round trip against a
temp-directory-backed `LocalDiskStorageAdapter`, including the cross-tenant/tampered-signature/
expired-link rejection paths. Cleans up its own tenant schema + platform rows + temp storage
directory in `afterAll`. Coverage: **91.11% statements / 89.83% branch / 86.77% functions / 91.11%
lines** on `src/server/**` (`vitest run --coverage`) — clears the "≥80%" bar; the only near-0% files
are pure-type files (`*.types.ts`) and `server/workers/worker-entrypoint.ts` (this dispatch's process
bootstrap script, deliberately not unit-tested — see "Decisions made" #5 — proven instead by actually
running it, per exit-gate item 5(d) above; matches legacy's own identical precedent of never
unit-testing `worker.ts`'s bootstrap function).

**Real end-to-end HTTP pass**: `next build` then `next start -p 3178` (`NODE_ENV=production`) against
the already-running `exam-4u-mysql-1` container's `examland_platform_next` schema, with a
freshly-provisioned `smoke1c` tenant (via `provision-demo-tenant.ts`). Every exit-gate-5/6 sub-item
above was proven via real `curl` requests against the real running server — full transcripts are not
reproduced here, but the concrete assertions were: `201` on user create with a real generated
temporary password; `200`/`404` on user read/update depending on existence; `200` on role assignment
reflecting the granted role in the response; `200` on profile read/update; `200` with a real,
tenant-namespaced `pictureKey` on avatar upload; `400 UNSUPPORTED_IMAGE_TYPE` for non-image content;
`413 FILE_TOO_LARGE` for an oversized upload (see "Decisions made" #4 for a real bug found and fixed
here); `200`/`206`/`416` on file download depending on the `Range` header; `403`/`400` on the
files-sign/download rejection paths; `403 FORBIDDEN`/`401 UNAUTHENTICATED` on the RBAC-deny checks;
`200` on both realms' login/`*.../me` routes; `401` on both directions of cross-realm token replay.

**Real worker-process pass**: `npm run worker`'s underlying script run directly (`tsx
src/server/workers/worker-entrypoint.ts`, `WORKER_OUTBOX_TICK_MS` lowered for a fast test tick) as a
genuinely separate OS process from the `next start` web process — confirmed via `ps`/PID tracking
that only this one process serviced the tick, no zombie process from an earlier run interfered (an
earlier attempt's ambiguous timing was re-run cleanly with `timeout`-bounded, PID-verified process
lifecycles to remove any doubt). Real MySQL rows before/after each run are quoted directly in this
dispatch's own transcript: a genuine pending `user.created` message reached `processed_at IS NOT
NULL` after one real tick; resetting it to claimable and re-running produced zero additional
`outbox.user.created` structured-log lines (the consumer's side effect) while `processed_at` was still
set again — the exact at-least-once-delivery-but-exactly-once-side-effect guarantee FR-REL-1 requires,
proven against a real separate process, not a fake. The worker also tolerated (logged, did not crash
on) several **pre-existing tenants from earlier phase dispatches** (`t_smoke1b_...`, `t_demo_next_...`)
that predate this dispatch's reliability migration and therefore lack the new tables entirely — a
real, useful proof of "one tenant's failure never stops the rest of the sweep" against genuinely
heterogeneous tenant schema state, not a contrived fixture (this heterogeneity is purely an artifact
of iterative phase-by-phase development against one shared long-lived verification schema; a real
`docker compose up` from a fresh volume, Phase 10's job, would apply every migration to every tenant
uniformly at provisioning time).

### Decisions made (LLD/plan silent, or a genuine judgment call — smallest-reasonable-choice standard)

1. **Profile avatar upload (`POST /api/profile/picture`) is in scope, even though the dispatch's own
   summary line only says "read/update"** — the dispatch's detailed scope item explicitly named
   `profile` as this phase's port of FR-IAM-4, and legacy's own `ProfileService`/`ProfileController`
   treat avatar upload as an inseparable part of that same feature (not a distinct backlog item). All
   the infrastructure it needs (`files`' `StoragePort`, `reliability`'s `FileCleanupRepository`) is
   being built in this exact dispatch anyway, so deferring just the upload half would leave a
   half-finished feature and an unexercised integration point between three of this dispatch's own new
   modules. Included, and proven end to end (including the real bug fix in "Decisions made" #4 below).

2. **`LoggingAuditTrailConsumer`, not a port of legacy's `AuditTrailOutboxConsumer`.** Checked
   `legacy/api/src/platform/audit/**` first per this dispatch's own instruction — it (and the
   `audit_log` table/`AuditLogService` it depends on) doesn't exist in this app yet (`platform/audit`
   is explicitly Phase 2 scope: "Platform Admin console... `platform/audit`"). Building a real
   audit-log-backed consumer now would mean redoing Phase 2's job early and inventing a table/service
   this dispatch has no mandate to design; building a *fake* in-memory audit log just to keep the
   class name "AuditTrailOutboxConsumer" would be theater, not a real consumer. Instead, this dispatch
   ships a genuine, durable, idempotency-guarded consumer (`LoggingAuditTrailConsumer`, wired to a
   real business event — `user.created`, enqueued by the new `users` module) that degrades to
   structured logging — the same "substitute a logged stand-in for infrastructure that doesn't exist
   yet" pattern `NoopEmailAdapter` already established for real SMTP. Phase 2 should replace/extend
   this with a real `platform/audit`-backed consumer once that module lands, exactly as legacy's own
   `AuditTrailOutboxConsumer` is wired to `examType.finalized` once `exam-authoring` exists (Phase 4).

3. **Only the outbox full-sweep safety net is built; the hinted sweep and `platform.tenant_work_hint`
   table are deliberately not ported.** HLD §10.2 frames the hinted sweep as a throughput optimization
   for "tens to low hundreds" of tenants, not a correctness requirement — the full sweep alone still
   delivers every message at-least-once, exactly-once-per-consumer. Building the hint table would mean
   a new *platform*-schema migration/table this dispatch's own scope line doesn't ask for, plus a
   `WorkHintsService`-equivalent this dispatch would need to invent the shape of from scratch (legacy's
   own lives in `platform/reliability`, a module this app hasn't built). Given the current small number
   of demo/test tenants, the full sweep alone is correct and sufficiently fast; `WORKER_OUTBOX_TICK_MS`
   was therefore kept at the *faster* (hinted-sweep-equivalent) cadence rather than legacy's slower
   full-sweep-only cadence, so pending work is still discovered promptly without a hint to shortcut the
   scan. Re-adding the hint table later needs no reshaping migration here (it would live entirely in
   the platform schema, untouched by this dispatch). `OutboxRepository.enqueue` also no longer needs
   any ambient tenant-id/request-context at all as a direct consequence (it never stamps a work hint),
   which is a genuine simplification over legacy's equivalent method, not just a scope cut.

4. **A real, reproducible (though intermittent) bug found and fixed only by sending genuinely large
   real HTTP multipart uploads — not caught by any vitest-only test, which never drives real Node HTTP
   body parsing.** Calling `request.formData()` on a body meaningfully larger than
   `MAX_AVATAR_SIZE_BYTES` (reproduced from roughly 6MB, ~80% of attempts at that size) intermittently
   threw `TypeError: Failed to parse body as FormData` from inside Node's own `undici` internals — a
   bare `500 INTERNAL_ERROR`, not the clean `413 FILE_TOO_LARGE` `ProfileService.uploadPicture`'s
   post-parse size re-check was meant to produce (that check never even ran, since the throw happened
   *during* `formData()` itself). **Fix**: `app/api/profile/picture/route.ts` now pre-checks the
   `Content-Length` header against `MAX_AVATAR_SIZE_BYTES` (plus a small multipart-overhead allowance)
   *before* ever calling `request.formData()`, mirroring legacy's own `multer`-level "the size cap
   applied before buffering" requirement (LLD §12.2) more faithfully than this route's first-drafted
   post-parse-only check — and, as a side effect, sidesteps the flaky undici code path entirely for
   any client that reports its body size up front (every browser `fetch`/`FormData` upload and every
   `curl -F` invocation does). Verified fixed by 6/6 clean `413` responses against the exact same
   oversized file that previously failed non-deterministically. A client that omits `Content-Length`
   (genuine chunked transfer-encoding, not exercised by this dispatch's own real-HTTP pass) still falls
   through to `ProfileService.uploadPicture`'s own post-parse re-check as a narrower residual gap —
   documented, not silently left unfixed for the common case.

5. **`server/workers/worker-entrypoint.ts` is not unit-tested directly, matching legacy's own
   identical precedent** (`legacy/api/src/worker.ts` has no `.spec.ts` either — only
   `seed-demo-tenant.ts`, a comparable CLI script, does). Its own logic is a thin `setInterval`
   scheduling wrapper around already-unit-tested `runOutboxFullSweep`; the file itself runs real
   side effects (a real `setInterval`, real `process.on` signal handlers) at import time via its
   top-level `bootstrap().catch(...)` call, making it awkward to import inside a shared vitest process
   without side effects. It is instead proven by literally running it as a real, separate OS process
   (exit-gate item 5(d)/"Real worker-process pass" above) — the correct verification method for a
   process entrypoint, not a gap.

6. **`OutboxRepository`/`FileCleanupRepository` accept an explicit `EntityManager` parameter (default:
   the constructor's own `DataSource.manager`) rather than only ever operating on `dataSource.manager`
   directly**, so a caller with its own already-open transaction (`UserAdminRepository.insert`,
   `ProfileRepository.setPicture`) can pass that transaction's manager straight through — this is what
   makes the `user.created` outbox enqueue and the `file_cleanup_queue` schedule genuinely atomic with
   the row change that produced them, matching legacy's own `ProfileRepository.setPicture` /
   `FinalizeExamService`-style "caller's own transactional `EntityManager`" convention exactly.

7. **The `user.created` outbox producer lives inside `UserAdminRepository.insert()` (a Tier
   A/infrastructure-layer, cross-module-barrel call into `reliability`), not threaded through
   `UsersService`'s own constructor.** Legacy's own `UsersService.create()` never enqueues an outbox
   event at all (no precedent to port) — this dispatch needed to choose its own real producer to prove
   the mechanism per the dispatch's explicit suggestion ("e.g.,from provisioning or a user-mutation
   event"). Threading an `OutboxRepository` + a `DataSource` (for the transaction) into `UsersService`
   would have pushed its constructor to 7 real collaborators, past this project's own "no more than
   ~4-5 collaborators" guideline; pushing the transactional write down into the repository layer
   instead (mirroring `ProfileRepository.setPicture`'s identical shape) keeps `UsersService`'s own
   shape unchanged while still making the enqueue genuinely atomic with the insert.

## Status

**Sub-slice 1c complete — Phase 1 fully closed.** All 7 exit-gate items pass (see "Verification
evidence" above). 339 tests green (up from 251), 91.11%/89.83% line/branch coverage on
`src/server/**`, `next build`/`eslint --max-warnings=0`/`tsc --noEmit` all clean, legacy containers
confirmed undisturbed throughout (including the real-HTTP smoke pass and the real, separate
`ROLE=worker` process run). One real, previously-latent bug was found and fixed (oversized-upload
handling, see "Decisions made" #4) — the same "find it by actually running the thing, not just
building/typechecking it" discipline 1a/1b's own dispatches established.

**Explicitly not done this dispatch** (see "Scope" above for the full list): any UI, the three
worker classes belonging to not-yet-built modules (`pdf-processing`/`attempts`/the fuller
`tenant-maintenance`), a real `platform/audit`-backed outbox consumer, the outbox hinted sweep/
`tenant_work_hint` table, and `UserDisplayResolverService`.

## Phase 1 overall status (sub-slices 1a + 1b + 1c)

Phase 1 ("Identity & tenancy foundation") is **complete** per the migration plan's own exit gate:
"provision a tenant end-to-end via the real workflow, log in to both realms, RBAC-deny a route" — all
three re-confirmed together, fresh, at the end of sub-slice 1c (not merely re-citing 1a/1b's own prior
evidence), with every module all three sub-dispatches built present simultaneously in one running app.

**Delivered across the three sub-dispatches**: `platform/tenants` (CRUD), the tenant `DataSource`
registry/factory, the package/feature/subscription catalog (migration+seed+read-path),
`platform/provisioning` (the full 6-step workflow), `tenancy`'s shared provisioning vocabulary +
`middleware.ts` Host-header tenant resolution + `TenantResolutionCache`, `server/context` (ALS +
`withTenantContext`/`withPlatformAuth`), `server/infrastructure/security` (bcrypt/`jose`/
`google-auth-library` adapters), dual-realm JWT `auth` (tenant realm) + `platform/auth` (platform-admin
realm), `rbac` (roles/permissions CRUD, permission resolution, `requirePermission`), `users` (admin
user CRUD), `profile` (self-service profile + avatar upload), `files` (HMAC-signed delivery,
Range/206/416), and `reliability` (transactional outbox + a real `ROLE=worker` process). A real,
significant, previously-latent cross-webpack-bundle TypeORM bug (1b) and a real oversized-upload
handling bug (1c) were both found and fixed only by actually booting the built app and sending real
HTTP traffic — neither surfaced from `tsc`/`eslint`/a vitest-only run alone, reinforcing why this
plan's exit gates insist on a real-HTTP pass, not just green unit tests.

**What the migration plan's original Phase 1 description named that did NOT end up covered by any of
the three sub-dispatches** (tracked honestly, not silently dropped):
- **The migration plan's own "Phase 1 exception" heavier adapted-e2e pass** — adapting the core
  assertions from `auth.e2e-spec.ts`/`tenant-resolution.e2e-spec.ts`/`rbac.e2e-spec.ts`/
  `provisioning-workflow.e2e-spec.ts`. 1a adapted `provisioning-workflow.e2e-spec.ts`'s two
  highest-value scenarios as unit tests (the other three specs' subjects didn't exist yet in 1a's own
  scope). 1b did the bulk of this pass once `auth`/`rbac`/tenant-resolution existed — see 1b's own
  "Adapted e2e assertions — explicit covered vs. deferred breakdown" table for the full per-assertion
  status (most covered; a handful explicitly deferred as low-value/structurally-guaranteed, e.g. the
  coarse timing benchmark and the "same email in two tenants" case). **1c did not add further
  adapted-e2e coverage for `users`/`profile`/`files`/`reliability`** (legacy's own `users.e2e-spec.ts`/
  `profile.e2e-spec.ts`/`files.e2e-spec.ts`/`reliability-workers.e2e-spec.ts`, if any exist, were not
  individually mined for assertions this dispatch) — this dispatch's own real-HTTP smoke pass and new
  integration test cover the equivalent ground functionally (every documented behavior — RBAC gating,
  enumeration-safety-adjacent checks, HMAC/Range/416, idempotent redelivery — was exercised for real),
  but a systematic pull of "2-4 highest-value assertions per old spec file" the way 1b did for its own
  three specs was not repeated here. **Still an open item** if a future pass wants full parity with the
  migration plan's literal "Phase 1 exception" wording; functionally, the behaviors those specs would
  assert are proven working by this dispatch's own verification evidence above.
- Everything else the migration plan's Phase 1 line names (`platform/tenants`, provisioning incl.
  create-subscription, `auth` incl. password recovery/Google auth bridge, `rbac`, `users`, `profile`,
  the package/feature/subscription catalog, `reliability`, `files`) is delivered, per the "Delivered"
  list above.

`current_phase` in `docs/NEXUS_STATE.md` remains `development` (unchanged) — this migration is tracked
via this plan file and the `migration_plan` state line, not the old backlog-phase numbering; the next
migration-plan phase (Phase 2: Platform Admin console + tenant maintenance) is a separate future
dispatch, not part of this one.

## Phase 1 exception closure — users/profile/files/reliability adapted assertions

**Goal**: close the one item sub-slice 1c's own "Phase 1 overall status" section left open — a
systematic "pull the 2-4 highest-value business-rule assertions" pass (matching the migration plan's
"Per-phase verification" § Exception, and the standard sub-slice 1b already applied to
`auth`/`tenant-resolution`/`rbac`/`provisioning-workflow`) against the remaining four legacy files:
`legacy/api/test/users-admin.e2e-spec.ts`, `profile.e2e-spec.ts`, `files-delivery.e2e-spec.ts`, and
`reliability-workers.e2e-spec.ts`. This is a small, bounded closing dispatch, not a new phase — no new
production features were added; only permanent regression tests (and two small, narrowly-scoped fixes
found while writing them) were.

**Backlog item(s)**: none — tracked via this plan file, matching every other Phase 1 sub-slice's own
framing.

### Approach

Four new top-level `apps/next/src/server/phase1-exception-*.integration.test.ts` files were added,
matching this app's existing `*.integration.test.ts` naming convention exactly
(`auth-rbac-platform.integration.test.ts`, `reliability-users-profile-files.integration.test.ts`,
`tenant-provisioning.integration.test.ts`, `raw-tenant-lookup.integration.test.ts` were the pre-existing
precedents). Unlike those dispatch-scoped proofs (which mostly call services/composition roots
directly), these four new files deliberately call the REAL exported `app/api/**` Route Handler
functions (`GET`/`POST`/`PATCH`/`DELETE`/`PUT`) with a genuine `NextRequest` — the only way to prove
the real `withTenantContext`/`requireTenantUser`/`requirePermission`-to-service wiring chain each route
assembles, and (for `files`) the real Next.js dynamic catch-all segment's own path re-join logic, which
a unit test calling a service method directly structurally cannot exercise. Each new test names, in its
own doc comment and/or `it()` title, exactly which legacy assertion it adapts.

All four use real MySQL against the same `examland_platform_next` isolation schema every prior Phase 1
sub-slice used (unique per-run tenant slugs, self-cleaning `afterAll`), and real disk storage /
real HMAC signing where relevant (`profile`/`files`) — never a fake standing in for the database or
filesystem.

### Adapted e2e assertions — explicit covered vs. deferred breakdown

| Source spec | Assertion | Status |
|---|---|---|
| `users-admin.e2e-spec.ts` | Permission gating: an authenticated zero-role user is rejected `403 FORBIDDEN` (not merely `401`) on every admin user-management route | **Covered** (`phase1-exception-users-admin.integration.test.ts`, via the real routes) |
| `users-admin.e2e-spec.ts` | Guard order: an unauthenticated request is rejected `401 UNAUTHENTICATED` before any permission check runs | **Covered** (same file) |
| `users-admin.e2e-spec.ts` | A generated temporary password actually round-trips through a real login (proves the hash genuinely works, not merely that a string was returned) | **Covered** (same file) |
| `users-admin.e2e-spec.ts` | `LAST_ADMIN_PROTECTED` on both the role-replace path and the hard-delete path for the sole Tenant Admin | **Covered** (same file, against the real provisioning-seeded admin — password set via a real bcrypt hash + raw SQL, the exact technique the legacy suite itself uses, so this suite's "sole Tenant Admin" is genuinely sole) |
| `users-admin.e2e-spec.ts` | Hard-delete cascades `user_role` rows; the id becomes unresolvable (`404 USER_NOT_FOUND`) on a subsequent real `GET` | **Covered** (same file) |
| `users-admin.e2e-spec.ts` | List search/sort/pagination | **Deliberately not adapted** — already exhaustively unit-tested (`users.service.test.ts`), no permission/tenant-isolation/security-relevant business rule at stake, purely incidental query-parameter plumbing |
| `users-admin.e2e-spec.ts` | Soft-reference-on-delete (`UserDisplayResolverService`/`DELETED_USER_DISPLAY_NAME`) | **Deliberately not adapted** — this service has no consumer in this app yet (`attempt`/`curriculum` tables are Phase 6/7/8 scope per sub-slice 1c's own documented deferral); porting it now would test nothing referencing it |
| `profile.e2e-spec.ts` | Unauthenticated avatar upload rejected `401` before ever touching disk | **Covered** (`phase1-exception-profile.integration.test.ts`, via the real route) |
| `profile.e2e-spec.ts` | Oversized upload rejected `413 FILE_TOO_LARGE` via the real `Content-Length` pre-check | **Covered** — this is also the permanent regression test for sub-slice 1c's own documented real bug fix ("Decisions made" #4 in that sub-slice's section above), previously proven only by a manual, non-repeatable `next start` smoke pass |
| `profile.e2e-spec.ts` | Non-image file rejected `400 UNSUPPORTED_IMAGE_TYPE` via the real magic-byte check regardless of declared filename/Content-Type | **Covered** (same file) |
| `profile.e2e-spec.ts` | A valid image is accepted, genuinely written to real disk via the real `StoragePort`, and the persisted `pictureKey` is visible on a subsequent real `GET /api/profile` | **Covered** (same file) |
| `profile.e2e-spec.ts` | `PATCH /profile` email-whitelist-rejection / DB-column-width-bound validation | **Deliberately not adapted** — this app's hand-rolled `validate.ts` helpers (no `class-validator`-DTO-whitelist equivalent, per sub-slice 1b's own "Decisions made" #7) only ever read the specific fields each route handler explicitly destructures; an unlisted field like `email` is simply never read, not rejected — a structurally different, already-documented validation architecture, not a gap to re-prove |
| `files-delivery.e2e-spec.ts` | Cross-tenant sign rejection (`403 FORBIDDEN`) via the real route | **Covered** (`phase1-exception-files-delivery.integration.test.ts`) |
| `files-delivery.e2e-spec.ts` | The real dynamic catch-all route genuinely re-joins wildcard path segments into the original storage key, serving the full object anonymously (no `Authorization` header) | **Covered** (same file) — the single highest-value assertion this file adds: legacy's own doc comment explains a unit test calling `FilesController.download()` directly cannot catch a routing misconfiguration the way a real HTTP-shaped request can; this app's dynamic catch-all segment is a structurally different mechanism than legacy's Express/`path-to-regexp` wildcard, so this was a genuinely unverified layer before this dispatch |
| `files-delivery.e2e-spec.ts` | Satisfiable `Range` request → `206` with correct `Content-Range` | **Covered** (same file, via the real route) |
| `files-delivery.e2e-spec.ts` | Unsatisfiable `Range` request → `416` with `Content-Range: bytes */size` | **Covered** (same file, via the real route) |
| `files-delivery.e2e-spec.ts` | Tampered signature / expired link → `403 LINK_INVALID_OR_EXPIRED`; path traversal → rejected before signature check | **Deliberately not re-adapted at the route level** — `FileSigningService.verify()`'s HMAC/expiry/tamper/traversal logic is already exhaustively unit-tested (`file-signing.service.test.ts`); the route layer's own genuinely-unverified surface (wildcard re-join, streaming, Range) is what the two tests above specifically target |
| `reliability-workers.e2e-spec.ts` | A consumer's failure is retried with backoff and never marks the message processed; `available_at` is pushed into the future via genuine server-side `NOW(3)` arithmetic (the exact host-timezone-drift-prone class of bug this codebase has already hit once) | **Covered** (`phase1-exception-reliability-workers.integration.test.ts`) |
| `reliability-workers.e2e-spec.ts` | REAL multi-replica-safety: two concurrent `OutboxPublisherService` instances racing the same `claimBatch` each win a disjoint, non-overlapping set of rows | **Covered** (same file) — only provable against a real database's own row-level locking, never a fake; neither this nor the backoff assertion above was covered by any existing fakes-based unit test or by 1c's own happy-path-only real-MySQL integration test |
| `reliability-workers.e2e-spec.ts` | `enqueue()` also upserts `platform.tenant_work_hint` in the same call | **Deliberately not adapted** — this app never built the hinted-sweep table (sub-slice 1c's own documented, deliberate scope reduction: full-sweep-only is correct, just not throughput-optimized, at this migration phase's tenant-count scale) |
| `reliability-workers.e2e-spec.ts` | `PdfProcessingSessionRepository.claimStale`/stale-session recovery; `AttemptsRepository.findTimedOutCandidateIds`/attempt-timeout sweeping | **Deliberately not adapted** — both belong to modules (`pdf-processing`, `attempts`) that don't exist in this app yet (Phase 3/4/6/7/8 scope, per sub-slice 1c's own explicit deferral); porting these tests now would exercise nothing |

**Status**: every one of the four legacy files is now accounted for — every highest-value,
business-rule-bearing assertion either has a new permanent test or an explicit, reasoned
deferral above. The migration plan's Phase 1 exception clause is now **fully closed**; no open item
remains against Phase 1.

### Findings (not new bugs, but worth recording — both are test/tooling-only, no business-logic change)

1. **A real, genuinely-overly-broad ESLint module-boundary pattern, found while trying to import the
   real `app/api/profile/**` route handlers into a test file.** `PROFILE_BARREL_ONLY`'s `group` was a
   bare `**/profile/**` — unlike every sibling module sub-slice 1c itself added the same dispatch
   (`FILES_BARREL_ONLY`/`AUTH_BARREL_ONLY`/`USERS_BARREL_ONLY` all correctly scope to
   `**/server/<module>/**`), this bare pattern also matched `app/api/profile/**`'s own Route Handler
   files purely because their path happens to contain the word "profile" — silently blocking any
   legitimate external caller (a test invoking the real route handlers, exactly this dispatch's own
   need) from importing them, even though those files are ordinary Next.js route modules, not
   `server/profile`'s internals. **Fixed** in `apps/next/.eslintrc.cjs`: scoped to
   `**/server/profile/**` to match every sibling module's own precedent — this narrows, not loosens,
   what the rule blocks (still fully denies any deep import of `server/profile`'s own
   `domain/**`/`infrastructure/**`/`application/**`); verified via a deliberately-added-then-reverted
   genuine deep-import violation, which still correctly fails lint after the fix.
2. **One pre-existing test's default 5000ms vitest timeout intermittently tripped once this dispatch's
   four new integration test files (11 more real-MySQL-touching tests, several provisioning their own
   tenant) added to the full suite's concurrent load against one shared real MySQL instance, especially
   under `--coverage`'s instrumentation overhead.** `tenant-provisioning.integration.test.ts`'s first
   `it()` (sub-slice 1a's own file) was the one exception to every sibling integration test's own
   convention of setting an explicit, more generous timeout. Passes comfortably in isolation (~1.3s);
   only intermittently exceeded 5s alongside ~50 other concurrent real-MySQL test files. **Fixed**: bumped
   to an explicit `30_000`ms, matching the rest of this app's own convention — a test-only robustness
   change, no production code or business logic touched.

### Verification evidence

`353` tests green (up from sub-slice 1c's `339` — the 4 new files contribute 4+4+4+2=14 new tests),
`91.8%` statements / `90.24%` branch / `88.16%` functions / `91.8%` lines on `src/server/**` (`vitest
run --coverage`, run twice to confirm — one run hit an unrelated, pre-existing, environment-load-caused
flake in `reliability-users-profile-files.integration.test.ts`'s own redelivery test that passed clean
on immediate re-run, the same "diagnose, don't paper over" class of transient flakiness Dev-18b/Dev-22
already established precedent for in the legacy build's own history) — clears the "≥80%" bar
comfortably. `next build`/`eslint --max-warnings=0`/`tsc --noEmit` all clean. Legacy containers
(`exam-4u-api-1`, `-worker-1`, `-mysql-1`, `-qdrant-1`, `-mailhog-1`) confirmed undisturbed via `docker
ps` diffed before/after every verification pass — only uptime counters progressed naturally, no
restarts.

`current_phase` in `docs/NEXUS_STATE.md` remains `development` (unchanged) — this dispatch closes an
open item within the already-complete Phase 1, it does not itself advance the migration plan to Phase
2.
