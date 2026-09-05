# ExamLand Next.js Rewrite — Phase 3: Taxonomy & Curricula

Authoritative source for scope/sequencing: `giggly-exploring-wombat.md` ("the migration plan", at the
repo root). This doc tracks only the phase-by-phase execution status against that plan; it does not
restate the plan's rationale. `docs/BACKLOG.md`'s Phase/Priority ordering is **not** used to sequence
this migration, matching every prior phase-plan doc's own framing.

The migration plan's Phase 3 line: "**Taxonomy & curricula** — pure content-model phase, no AI
dependency yet." This is also the **first tenant-realm UI work** in this migration — Phases 0-2 built
backend + the Platform-Admin-only console only; no `(tenant)` route group, tenant login page, or
tenant-shell nav existed anywhere in `apps/next` before this dispatch.

## Goal

A tenant user (Tenant Admin or Member) can, through a real browser against the new Chakra v3 tenant
UI: log in, create an Education Level → Stage → Subject taxonomy hierarchy (Tenant Admin only, per
`taxonomy.create`), and create/list/edit/delete a Curriculum record scoped to a Subject (any user
holding `curricula.manage_own`) — all backed by real Route Handlers, real MySQL, real RBAC enforcement,
inside a new minimal tenant-realm shell that every later tenant-realm phase (4, 6, 7, 8, 9) extends.

## Scope

### In scope

- **`server/taxonomy`** (NEW module) — full port of `legacy/api/src/modules/taxonomy/**`: domain
  (`taxonomy.types`, `errors`), infrastructure (`EducationLevelRepository`/`StageRepository`/
  `SubjectRepository`, mysql-error translation), application (`TaxonomyService` — create-or-fetch
  concurrency-safe insert-then-catch, FR-TAX-4's two-part deletion-protection strategy), api (none —
  no guard/decorator mechanism on this stack, gating happens per-route via `requireTenantUser`/
  `requirePermission` exactly as `users`/`profile` already established).
- **`server/curricula`** (NEW module) — **ownership/metadata only**, per the scope-split judgment call
  below. Domain (`curricula.types`, `errors`), infrastructure (`CurriculaRepository` — `curriculum`
  table only), application (`CurriculaService` — create/list/get/update/delete, owner-or-oversight
  authorization).
- New tenant-schema migrations: `20260815000003-create-taxonomy-tables.ts` (`education_level`, `stage`,
  `subject`, plus the `fk_user_edu` FK onto the already-existing `user` table — closes sub-slice 1a's
  own documented forward reference) and `20260815000004-create-curriculum-table.ts` (`curriculum` only
  — no `curriculum_document`, per the scope-split below).
- `app/api/taxonomy/{education-levels,stages,subjects}[/[id]]/route.ts` and
  `app/api/curricula[/[id]]/route.ts` Route Handlers.
- Two new `apps/next/.eslintrc.cjs` module-boundary override blocks (`taxonomy`, `curricula`).
- **The tenant-realm shell** (not named as its own numbered item in the dispatch's item list, but
  required for taxonomy/curricula UI to have somewhere to render, exactly as Phase 2a's platform-shell
  was built as an unavoidable prerequisite for its own first console screen):
  - `app/(tenant)/layout.tsx` — mounts `TenantAuthProvider` (client-side, `localStorage`-token session
    state, mirroring `PlatformAuthProvider`'s pattern).
  - `app/(tenant)/login/page.tsx` — bare centered-card login screen (no shell chrome), the tenant
    realm's first-ever UI at all (see "Decisions made" #1 for why this had to be built even though it
    isn't itemized in the dispatch's own scope list).
  - `app/(tenant)/(shell)/layout.tsx` — client-side auth guard + `TenantShell` (sidebar nav: "Curriculum"
    peer item, "Settings ▸ Taxonomy" grouped item, per `docs/design/UX_GUIDELINES.md` §19's IA).
  - `app/(tenant)/(shell)/curricula/{page.tsx, new/page.tsx, [id]/page.tsx}`.
  - `app/(tenant)/(shell)/settings/taxonomy/page.tsx` (single-panel breadcrumb drill-down, per
    `docs/design/UX_GUIDELINES.md` §6/§19).
  - `lib/tenant-console/{api-error, token-storage, http-client, auth-api, taxonomy-api, curricula-api,
    auth-context, index}.ts(x)` — the tenant realm's client-side typed API/data-access layer, mirroring
    `lib/platform-console/**`'s established shape exactly.
  - `components/tenant/tenant-shell.tsx` (new); `ConfirmDialog`/`StatusBadge` reused directly from
    `components/platform/**` rather than duplicated (see "Decisions made" #6).
- `docs/design/UX_GUIDELINES.md` §19 — the tenant-realm shell + taxonomy/curricula screens, extending
  §4.0 (tenant shell baseline)/§6 (taxonomy browse/create)/§10 (curriculum management, the ownership/
  metadata half only) the same way §18 already extended §3 for the platform console's Chakra rewrite.
- `scripts/playwright-smoke-tenant.ts` (NEW) — this migration's first tenant-realm browser smoke
  script, parallel to Phase 2's `scripts/playwright-smoke.ts`, per the migration plan's own
  "cumulative smoke script" convention applied to a second, structurally distinct realm.
- `scripts/provision-phase3-demo-tenant.ts` (NEW) — provisions a fresh demo tenant through the real
  workflow **and** sets a known password directly on its invited Tenant Admin (see "Decisions made" #2
  for why, and why this is not a shortcut around real auth).
- A real-route-level integration test (`server/phase3-taxonomy-curricula-routes.integration.test.ts`),
  matching every prior phase's `phaseN-*-routes.integration.test.ts` convention.

### Out of scope (explicitly deferred, not silently skipped)

- **The entire document-ingestion pipeline and semantic search** (`CurriculumDocument` entity/table,
  `POST /curricula/:id/documents`, `DELETE .../documents/:docId`, `GET .../search`) — see the dedicated
  "Curricula scope-split judgment call" section below for the full reasoning. This is Phase 5/6's job.
- Any vector/embeddings infrastructure (`VectorStorePort`, `EmbeddingsPort`, Qdrant adapter, embeddings
  provider) — Phase 5, per the migration plan's own phase sequence. Nothing in this dispatch imports or
  references any of these.
- Exam authoring (Phase 4), PDF processing (Phase 6), attempts/practice (Phases 7/8) — later phases;
  `curriculum`'s FK surface for `exam_type_curriculum` is deliberately not created this phase either
  (mirrors legacy's own `1730000000005`'s identical deferral — the linking table is added by whichever
  phase first writes to it).
- Tenant dashboard, branding, self-serve billing view (Phase 9) — the tenant shell built this dispatch
  is deliberately minimal: only the nav items taxonomy/curricula need (`Curriculum`, `Settings ▸
  Taxonomy`). No dashboard page exists; post-login lands on `/curricula` instead (see "Decisions made"
  #3).
- `users`/`profile` tenant-realm UI (backend has existed since Phase 1c; no Chakra screen for either
  exists yet) — not part of this dispatch's item list, and the tenant shell's nav does not reference
  them (an account menu with only "Log out" is sufficient this phase, matching platform-shell's own
  minimal account menu before Phase 2 grew it).
- A tenant-wide "all curricula" admin browse screen for the `curricula.read_all` oversight capacity —
  per `docs/design/UX_GUIDELINES.md` §10's own already-specified "narrower interpretation" (oversight
  access is URL-only, via a direct link to another user's Curriculum detail page); this dispatch
  reuses that specification rather than re-deriving it.

## The curricula scope-split judgment call

Read `legacy/api/src/modules/curricula/application/curricula.service.ts` in full before making this
call. Legacy's `CurriculaService` is a single class straddling two genuinely different concerns:
Curriculum ownership/metadata (create/list/get/update/delete a `curriculum` row) and a full RAG
ingestion pipeline (`uploadDocuments`: PDF text extraction → chunking → `EmbeddingsPort.embed()` →
`VectorStorePort.upsertChunks` → `curriculum_document` row; `search`: `EmbeddingsPort.embed()` →
`VectorStorePort.searchChunks`). None of `EmbeddingsPort`/`VectorStorePort`/Qdrant/an embeddings
provider exist in `apps/next` yet — that infrastructure is explicitly Phase 5's job in the migration
plan's own phase sequence ("AI & vector platform layer (infra-only, the actual pivot)").

**Decision: defer *all* document upload/management/search UI and API to Phase 5/6. Ship only
Curriculum ownership/metadata (create/list/get/update/delete a `curriculum` record, Subject-scoped,
ownership-enforced) this dispatch — no `CurriculumDocument` entity, table, or endpoint at all.**

Reasoning (the dispatch explicitly invited either the "storage-only, no extraction/embedding" half-step
or this full deferral, whichever is more coherent to ship):

1. **A document that can never be searched or processed is a dead end a Tenant user would be confused
   by.** `CurriculumDocumentEntity`'s own columns (`pageCount`, `chunkCount`, `contentType`) are all
   *products* of the extraction/chunking pipeline — a "storage-only" upload this phase would either
   leave them meaninglessly null/zero, or require this dispatch to reimplement `extractPdfPages`/
   `chunkPages` (real, non-trivial logic) just to populate metadata columns whose only real consumer
   (search) doesn't exist yet. That's building half of a pipeline with no working payoff, which is
   worse than not building it at all — a Tenant user who uploads a document and can never search it has
   no way to know whether that's "not implemented yet" or "broken."
2. **No retroactive backfill step exists anywhere in the migration plan.** Phase 5/6 do not describe
   re-processing documents uploaded by an earlier phase — so a document ingested by this dispatch's
   storage-only stub would need Phase 6 to add a *second*, different code path just to catch up
   already-uploaded files, rather than Phase 6 simply being the pipeline's first and only writer.
   Deferring the whole document data model avoids inventing that reconciliation problem.
3. **The `curriculum_document` table's own shape is not yet fully known.** Phase 5/6 will very likely
   need pipeline-state columns this phase can't anticipate correctly (processing status, embedding
   model version, retry/failure state — mirroring how `pdf_processing_session` grew several
   resumability columns across its own later phases in legacy). Shipping a table now that Phase 6 has
   to reshape anyway is exactly the kind of premature-forward-reference this migration's own precedent
   (Phase 1a's `logoUrl`/`accentColorOverride` *columns*-now-logic-later approach) explicitly avoids
   *unless* the shape is already fully settled — here it demonstrably is not, since it depends on
   infrastructure (Qdrant payload shape, embeddings provider) that doesn't exist yet.
4. **Curriculum ownership/metadata is fully self-contained and immediately useful on its own.** A
   Tenant Admin/Member can already organize their curricula by Subject, name them, describe them, and
   manage their lifecycle — a coherent, complete slice of FR-CUR-1/FR-CUR-1a with no dangling
   half-feature, exactly matching this project's established "smallest coherent slice" standard (Phase
   1a's `tenancy` vs `platform/provisioning` split, Phase 2b's `AiModelResolver`-consumption deferral).

This mirrors the dispatch's own suggested precedent exactly — "if that half-built state would be more
confusing than useful... you may instead defer *all* document-upload UI/API to Phase 5/6." Phase 5/6's
own dispatch will add `CurriculumDocumentEntity`/its migration/`POST .../documents`/`GET .../search`
once the vector/embeddings infrastructure it depends on actually exists, as one coherent addition
rather than two.

## Decisions made (LLD/plan silent, or a genuine judgment call — smallest-reasonable-choice standard)

1. **A tenant login page had to be built even though it isn't itemized in the dispatch's own scope
   list.** The dispatch's exit gate explicitly requires "a tenant-user logs in... through the real UI"
   — but no tenant-realm UI of any kind exists yet in `apps/next` (confirmed: no `app/(tenant)/**`
   directory before this dispatch). Building the taxonomy/curricula screens without anywhere to log in
   first would make the exit gate's own browser proof impossible. `app/(tenant)/login/page.tsx` is
   therefore built as a small, necessary prerequisite — mirroring Phase 2a's identical judgment call
   ("Phase 2a's own platform-shell + login page were built as an unavoidable prerequisite for its own
   first console screen").
2. **A verification-only script (`scripts/provision-phase3-demo-tenant.ts`) sets a known password
   directly on the freshly-provisioned tenant's invited Tenant Admin**, rather than routing through the
   real invite-email/password-recovery flow. The real provisioning workflow's `invite_admin` step
   deliberately leaves `password_hash NULL` (production correctly requires the real recovery flow to
   activate an invited account) — there is no way to log in as that Tenant Admin through the UI without
   either (a) driving the forgot-password flow and intercepting the `NoopEmailAdapter`'s logged reset
   link, or (b) setting a password directly for verification purposes. This dispatch takes (b),
   explicitly matching the migration plan's own already-endorsed Phase 10 seed-script deviation ("seed a
   Tenant Admin with a known password set directly... documented, intentional deviation from
   production's invite-only flow — justified because this... stack is for immediate local/e2e login").
   This is a verification convenience only — no application code path is changed or bypassed; the
   Tenant Admin still authenticates through the real `POST /api/auth/login` → real bcrypt compare → real
   JWT issuance, exactly as any real user would.
3. **No tenant dashboard is built; login redirects straight to `/curricula`.** The dispatch's own scope
   note says "do not build more of the tenant shell than taxonomy/curricula's own nav needs" — Phase 9
   owns the real dashboard (aggregates across 3-8, "deliberately last" per the migration plan). Building
   a placeholder dashboard now would be dead UI with no real content, and there is no requirement that
   post-login land anywhere specific — `/curricula` is the first genuinely useful screen a tenant user
   reaches this phase, so it is the redirect target.
4. **Tenant-realm token storage key is `el.tok.tenant` (a fixed key), not `el.tok.{slug}`.** Legacy
   Angular's own convention (referenced in `docs/design/UX_GUIDELINES.md` §3.0: "its own token storage
   key (distinct from `el.tok.{slug}` — e.g. `el.tok.platform`)") embedded the tenant slug because that
   SPA could, in principle, run against different tenant subdomains from the same browser profile in
   ways worth distinguishing. This app's tenant realm is subdomain-scoped by construction — each tenant
   is already a distinct browser origin, so `localStorage` is naturally isolated per tenant without
   needing the slug embedded in the key. A fixed key (mirroring `el.tok.platform`'s own fixed-key
   precedent, which has exactly the same single-realm-per-origin property) is simpler and equally
   correct; documented here as a deliberate, smallest-reasonable choice rather than a silent deviation.
5. **`app/(tenant)/(shell)` nested route group**, mirroring `app/platform/(console)`'s exact pattern:
   `app/(tenant)/layout.tsx` mounts `TenantAuthProvider` for the whole tenant realm (login page
   included, since the login form calls `login()` through that same context); the nested `(shell)` route
   group's own `layout.tsx` is the client-side auth guard + `TenantShell` wrapper, applying to every
   route except `/login`. Both `(tenant)` and `(shell)` are bare route groups (no URL segment) — tenant
   pages live at plain top-level paths (`/login`, `/curricula`, `/settings/taxonomy`), matching the
   migration plan's own "New app structure" listing (`(tenant)/… dashboard, exam-types, curricula, …`
   with no path prefix, unlike `/platform/**`'s real segment) and legacy Angular's own tenant-realm URL
   shape. `middleware.ts` needs **no exclusion changes** for this — unlike `/platform/**`, every tenant
   page *should* go through `resolveTenantForRequest()` (that's the entire point of the tenant realm),
   so the existing matcher is already correct without modification.
6. **`ConfirmDialog`/`StatusBadge` are reused directly from `components/platform/**`, not duplicated
   under `components/tenant/`.** Both are already fully generic (no platform-specific business logic,
   no import of anything under `server/platform/**` or `lib/platform-console/**`) — `ConfirmDialog`
   takes only `title`/`message`/`confirmLabel`/`tone`/`onConfirm`/`onCancel` props, `StatusBadge` is
   parameterized by a plain string-literal union. Neither is protected by the ESLint module-boundary
   rule (that rule only fires on `src/server/**`, never `src/components/**`), so importing either from
   the tenant realm is not a boundary violation, only a naming-location one — and refactoring them into
   a shared `components/ui/**` location is a larger, unrelated churn against Phase 2's already-shipped
   code this dispatch has no mandate to perform. Documented as the smallest-reasonable choice rather
   than silently duplicating ~120 lines or silently relocating Phase 2 files.
7. **Taxonomy's create-or-fetch routes reuse the exact 200-vs-201 status-code convention** legacy's
   `TaxonomyController` established (`entity.created` flag drives `NextResponse.json(entity, {status:
   created ? 201 : 200})`) — ported behavior, not reinvented, matching this migration's own "port
   logic, adapt only the framework glue" standard used for every prior module.
8. **`common/http/validate.ts` gained one new small helper, `requireIntFromQuery`**, for parsing a
   required integer query-string parameter (`?educationLevelId=`/`?stageId=`) — no equivalent existed
   because every prior module's required inputs came from a JSON body (`requireInt`) or a path segment
   already known to be well-formed. Mirrors that file's own established "add the smallest new helper a
   dispatch's shape actually needs" precedent (Phase 2b added `optionalString`/`requireEnum` for its own
   new shapes).
9. **Nav item permission gating reads the already-fetched `GET /api/auth/me` `permissions` array**
   client-side (`TenantAuthProvider` stores it alongside `id`/`email`/`firstName`/`lastName`) rather
   than adding a new endpoint — `permissions` was already part of that route's response shape since
   Phase 1b, unused by any client until now. "Curriculum" is shown for `curricula.manage_own`;
   "Settings ▸ Taxonomy" for `taxonomy.read` — matching `docs/design/UX_GUIDELINES.md`'s own
   "gate on permission, not role name" principle (§4.0's baseline, reused verbatim by §19). Every
   gated route additionally re-checks the same permission server-side via `requirePermission` inside
   its own Route Handler (defense in depth — a hidden nav link is not access control, per that same
   established principle) and the corresponding page component redirects/shows a forbidden state if the
   client-side permission check fails, so direct-URL access is never nav-link-gated alone.
10. **The tenant-realm Playwright smoke run deliberately uses the dev/test tenant-resolution bypass
    (`NODE_ENV` left non-production, `DEFAULT_TENANT_SUBDOMAIN` set to the demo tenant's slug), not the
    real `Host`-header-derivation branch.** Phase 1 sub-slice 1b already separately proved that real
    branch works end to end (`curl -H "Host: smoke1b.examland.app"` against `NODE_ENV=production`) —
    re-proving tenant resolution itself for every later UI phase would be duplicative; this dispatch's
    own exit gate is about taxonomy/curricula's UI, not tenant resolution. A real browser cannot easily
    send an arbitrary `Host` header for a plain page navigation the way `curl` can, so exploiting the
    already-existing, already-legitimate dev bypass (rather than fighting the browser's Host-header
    restrictions) is the smallest-reasonable choice here. See `scripts/playwright-smoke-tenant.ts`'s own
    doc comment for the exact run recipe.
11. **Two real, previously-latent bugs found and fixed only by actually running the app in a real
    browser, not by build/lint/typecheck/unit-test alone** (matching every prior phase's own discipline
    of finding real bugs this way): (a) the taxonomy drill-down UI's cascading create-row placeholder
    text (`"Add stage…"`) is never part of `document.body.textContent` — an `<input>` placeholder is an
    attribute, not rendered text content — so a smoke-script wait condition checking `textContent` for
    it would spuriously time out even though the UI was already correctly rendered; fixed by waiting on
    the placeholder's own visibility instead. (b) the curriculum detail page's `GET /api/curricula/:id`
    fetch fires from a `useEffect` after mount, so immediately checking `locator.isVisible()` right after
    `page.waitForURL(..., { waitUntil: 'commit' })` catches the page mid-skeleton-loading-state (a false
    negative on a fully correct app) — fixed by waiting for the heading to become visible before
    asserting. Both fixes are in `scripts/playwright-smoke-tenant.ts` only; no application code changed
    as a result of either finding.

## Exit gate

1. `next build` succeeds cleanly.
2. `eslint --max-warnings=0` clean, including a deliberately-added-then-reverted module-boundary
   violation for each of the two new modules (`taxonomy`, `curricula`).
3. New tenant-schema migrations (`20260815000003`/`20260815000004`) run clean against real MySQL in the
   established `examland_platform_next`/tenant-schema isolation approach, verified via
   `information_schema` (not just "the migration ran") for the new `fk_user_edu` FK.
4. Unit tests for new pure-logic code (taxonomy create-or-fetch/deletion-protection rules, DTO/field
   validation, curricula ownership/oversight authorization) with coverage ≥80% (or the project's own
   higher configured bar) on every new file.
5. Real end-to-end proof via a real, dedicated `scripts/playwright-smoke-tenant.ts` Playwright browser
   session against a real `next start` server and real MySQL: a tenant-user logs in, creates an
   Education Level → Stage → Subject hierarchy through the real UI, creates a Curriculum record,
   lists/edits it, all reflected in real DB state, zero console errors.
6. Legacy containers (`exam-4u-api-1`, `-worker-1`, `-mysql-1`, `-qdrant-1`, `-mailhog-1`) confirmed
   undisturbed (`docker ps` diffed before/after).

## Verification evidence

1. **`next build`**: clean. `DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev
   JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different 32+ chars>
   FILE_SIGNING_SECRET=<32+ chars> npm run build -w apps/next` — compiles, lints, type-checks, and
   generates all 48 routes cleanly, including the new `/api/taxonomy/**`, `/api/curricula[/[id]]`,
   `/login`, `/curricula[/new,/[id]]`, `/settings/taxonomy` routes.
2. **`eslint --max-warnings=0`**: clean on the whole app. A deliberate violation file was added
   (deep-importing `@/server/taxonomy/application/taxonomy.service` and
   `@/server/curricula/application/curricula.service` from outside either module), confirmed to fail
   with exactly the two new rules' expected messages, then removed — `TAXONOMY_BARREL_ONLY`/
   `CURRICULA_BARREL_ONLY` both proven to actually fire.
3. **Migrations against real MySQL**, verified via `information_schema` (not just "the migration ran"):
   provisioned a real tenant (`t_demo_phase3_d1204015`) through the real workflow; `SHOW TABLES`
   confirms `education_level`/`stage`/`subject`/`curriculum` all exist; `migrations` table lists
   `CreateTaxonomyTables20260815000003`/`CreateCurriculumTable20260815000004` in order after the
   pre-existing two; `information_schema.KEY_COLUMN_USAGE` confirms `fk_user_edu` now links
   `user.education_level_id -> education_level(id)` (closing sub-slice 1a's forward reference);
   `SHOW CREATE TABLE curriculum` confirms `fk_cur_subject` FKs `subject(id) ON DELETE RESTRICT` as
   designed.
4. **Unit tests**: `73` test files / `593` tests green (`JWT_TENANT_SECRET`/`JWT_PLATFORM_SECRET` set,
   `npx vitest run --exclude "**/*.integration.test.ts" --coverage`). New-file coverage: `taxonomy.
   service.ts` 86.23%/81.63% (statements/branch); `curricula.service.ts` 100%/96.87%; `lib/tenant-
   console/**` overall 93.79%/96.29% (each individual client API module at or near 100%);
   `requireIntFromQuery` (the one new `validate.ts` helper) fully covered by its own 6 new test cases —
   all clear the "≥80% on files this dispatch added/changed" bar. Repository/`index.ts`
   composition-root files in the two new modules sit at 0% in vitest, matching the exact established
   precedent for every other tenant-scoped module in this app (`server/users`/`server/profile`/etc.'s
   own `index.ts`/repository files) — these are proven by the real-MySQL integration test below instead,
   not vitest unit coverage.
5. **Real-route-level integration test** (`server/phase3-taxonomy-curricula-routes.integration.test.ts`,
   real MySQL + real JWT, calling the actual exported Route Handler functions): 14/14 green. Covers
   unauthenticated rejection, RBAC fail-closed (`403 FORBIDDEN`) for a Member lacking
   `taxonomy.create`, the full Tenant-Admin create-or-fetch hierarchy flow (200-vs-201), `409
   TAXONOMY_ENTRY_IN_USE` on a referenced delete, `404 SUBJECT_NOT_FOUND`, `403 NOT_CURRICULUM_OWNER`
   for a non-owner without oversight, `curricula.read_all` oversight bypass for a Tenant Admin, owner
   update/list-scoping/delete, and clean bottom-up deletion once references are gone, plus `404
   TAXONOMY_ENTRY_NOT_FOUND` on a repeat delete.
6. **Real end-to-end browser proof** (`scripts/playwright-smoke-tenant.ts`, the tenant realm's first-
   ever Playwright script): provisioned `demo-phase3` via `scripts/provision-phase3-demo-tenant.ts`
   (real workflow + a directly-set known Tenant Admin password, see "Decisions made" #2), started a real
   `next start -p 3183` server (`NODE_ENV=test`/`DEFAULT_TENANT_SUBDOMAIN=demo-phase3`, see "Decisions
   made" #10), and ran all 13 assertions green: login renders and authenticates for real, redirect to
   `/curricula`, permission-gated nav renders, a full Education Level → Stage → Subject hierarchy is
   created through the real drill-down UI and survives a hard reload (real DB persistence, not
   client-only state), a Curriculum is created via the real cascading Subject picker, appears in the
   list, is edited (rename persists across a hard reload), is deleted via the confirm dialog, and log-out
   returns to `/login` — **zero console errors** across every page load. Two real, previously-latent bugs
   were found and fixed only by this real-browser pass (see "Decisions made" #11) — both fixes are in
   the smoke script itself, not the application.
7. **Legacy containers undisturbed**: `docker ps` diffed before/after every step of this pass (unit
   tests, the real-MySQL integration test, the demo-tenant provisioning script, the real `next start`
   boot, and the full Playwright run) — `exam-4u-api-1`/`-worker-1`/`-mysql-1`/`-qdrant-1`/
   `-mailhog-1` (and every other pre-existing container on this shared host) completely undisturbed
   throughout, only uptime counters advanced. The `next start` process on port 3183 was stopped and the
   port freed after verification.

## Status

**Phase 3 complete.** All 7 exit-gate items above independently proven. `apps/next` now has its first
tenant-realm UI: a minimal tenant shell (nav, identity, logout), a taxonomy browse/create/delete screen,
and a curricula list/create/detail screen, backed by two new real, RBAC-enforced server modules
(`taxonomy`, `curricula`) and two new tenant-schema migrations. Document upload/ingestion/semantic
search for curricula remain explicitly deferred to Phase 5/6 per this doc's own scope-split write-up.

Next migration-plan phase (not yet started): Phase 4, Exam authoring (depends on this phase's
classification/taxonomy data).
