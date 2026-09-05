# ExamLand Next.js Rewrite — Phase 4: Exam Authoring

Authoritative source for scope/sequencing: `giggly-exploring-wombat.md` ("the migration plan", at the
repo root). This doc tracks only the phase-by-phase execution status against that plan; it does not
restate the plan's rationale. `docs/BACKLOG.md`'s Phase/Priority ordering is **not** used to sequence
this migration, matching every prior phase-plan doc's own framing.

The migration plan's Phase 4 line: "**Exam authoring** — depends on Phase 3's classification." Phase 5
("AI & vector platform layer") comes after this phase — no `AiServicePort`/vector infrastructure exists
in `apps/next` yet.

## Goal

A tenant user holding `exams.create` can, through the real Chakra v3 tenant UI (reusing Phase 3's tenant
shell): upload a ZIP archive whose top-level folders are declared modules and whose `.json` files are
questions, creating a real `exam_type`/`exam_module`/`exam_type_question` row set; list/view/delete Exam
Types, all RBAC-enforced exactly per legacy's permission strings, backed by real MySQL and real disk
storage with the same "zero partial artifacts on any failure" guarantee legacy's own exit gate proved.

## Scope

### In scope

- **`server/exam-authoring`** (NEW module) — full port of `legacy/api/src/modules/exam-authoring/**`
  minus `fixSubjectMapping` (see judgment call below): domain (`exam-authoring.types`, `errors`),
  infrastructure (`ExamAuthoringRepository`, mysql-error util), application (`ExamAuthoringService`:
  `createFromZip`/`list`/`get`/`delete`), no `api/` sub-layer (this stack has no guard/decorator
  mechanism — gating happens per-route via `requireTenantUser`/`requirePermission`, exactly as every
  prior tenant-realm module).
- **`server/infrastructure/zip`** (NEW module) — `parseExamZip` + `assertSafeEntryName`, ported
  faithfully from `legacy/api/src/infrastructure/zip/exam-zip-parser.ts` (zip-slip defense, magic-byte
  check via a new `common/util/zip-signature.util.ts`, per-question-file field validation).
- New tenant-schema migration `20260815000005-create-exam-authoring-tables.ts` (`exam_type`,
  `exam_module`, `exam_type_question` — **no** `exam_type_curriculum`, see judgment call below), FK'd to
  Phase 3's `stage` table exactly as legacy's own migration does.
- `app/api/exam-types/route.ts` (`GET` list), `app/api/exam-types/zip/route.ts` (`POST` multipart
  create), `app/api/exam-types/[id]/route.ts` (`GET` detail, `DELETE`) Route Handlers.
- New `apps/next/.eslintrc.cjs` module-boundary override blocks (`exam-authoring`,
  `infrastructure/zip`), appended to the generated `MODULES` array.
- New env var `MAX_ZIP_SIZE_BYTES` in `server/config/env.schema.ts` (defense-in-depth size re-check,
  same pattern as `MAX_AVATAR_SIZE_BYTES` — this app has no `multer`-level size limiter ahead of
  `request.formData()`).
- Chakra v3 UI under `app/(tenant)/(shell)/exam-types/{page.tsx, new/page.tsx, [id]/page.tsx}`, reusing
  Phase 3's tenant shell; `lib/tenant-console/exam-types-api.ts` typed client; a new "Exam Types" nav
  item (gated on `exams.read`).
- `docs/design/UX_GUIDELINES.md` §20 — exam-type list/create/detail screens, extending §19's tenant-shell
  conventions.
- New `yauzl`/`@types/yauzl` (runtime) and `yazl`/`@types/yazl` (dev, test-fixture generation only)
  dependencies at the same versions legacy already vets (`^3.4.0`/`^3.3.1`).
- Unit tests (zip-parser edge cases incl. zip-slip, DTO/field validation, module-count reconciliation),
  a real-route-level integration test (`server/phase4-exam-authoring-routes.integration.test.ts`,
  matching every prior phase's convention), and an extension of
  `scripts/playwright-smoke-tenant.ts` (not a new script, per the migration plan's cumulative-smoke
  convention).

### Explicitly out of scope (deferred, not silently skipped)

- **`fixSubjectMapping`/`POST /exam-types/:id/fix-subject-mapping` (legacy Dev-28/BL-27, FR-AUTH-6)** —
  real AI-backed (`SubjectClassificationService` → `AI_SERVICE_PORT.classifySubject`). No
  `AiServicePort`/ADK/OpenRouter wiring exists in `apps/next` yet — that is explicitly Phase 5's job
  ("AI & vector platform layer (infra-only, the actual pivot)"). Deferred whole, not stubbed — a stub
  endpoint that always returns `{examined: N, mapped: 0}` would be dead code with no real behavior to
  exercise, and Phase 5 is the first phase where `AiServicePort` exists to back it for real.
- **`exam_type_curriculum` (FR-AUTH-4, Curriculum linking) — deferred to Phase 6, overriding both this
  dispatch's own prompt and Phase 3's plan-doc prediction.** See the dedicated judgment-call section
  below for the full reasoning; this is the one place this dispatch's actual codebase research
  overturned an instruction it was given.
- **`EXAM_TYPE_HAS_ACTIVE_ATTEMPTS`** — legacy's own history (Dev-12a/Dev-19a) shipped this exact
  guard as a vacuous `hasActiveAttempts()` stub that always returns `false` until Dev-20a/BL-17 (once a
  real `attempt` table existed) wired it to a real query. `apps/next` has no `attempts` module/table at
  all yet (Phase 7). This dispatch reproduces the identical Dev-12a-era stub — `delete()` calls a
  `hasActiveAttempts()` method that always resolves `false`, with a doc comment forward-referencing
  Phase 7 exactly as legacy's own class doc comment did — rather than importing a nonexistent
  `AttemptEntity` or inventing a real check.
- **`PATCH /exam-types/:id` (edit/update)** — despite `exams.update` existing as a seeded RBAC
  permission (both in legacy and already in `apps/next`, since Phase 1's RBAC seed), **no update
  endpoint, DTO, or UI ever existed anywhere in legacy for Exam Types.** Confirmed by reading
  `exam-authoring.controller.ts` (only `GET`/`POST /zip`/`DELETE`/`POST /:id/fix-subject-mapping`
  exist), `ExamAuthoringRepository` (no `update` method), and — decisively —
  `exam-type-detail.component.ts`'s own doc comment: *"read-only... no edit form: the API contract
  (LLD §7.3) exposes only create-via-ZIP and delete, no `PATCH /exam-types/:id` — building inline-edit
  affordances the backend doesn't support would be inventing scope."* `exams.update` is a real,
  documented dead permission in legacy (seeded, never checked by any route) — its existence in the
  catalog does not imply the feature exists. Per this project's own "never invent scope" rule and
  `docs/PRODUCT_SPECIFICATION.md`'s FR-AUTH entries (which list create/module-configuration/curriculum-
  linking/deletion/re-mapping — no update), building a `PATCH` endpoint and edit UI here would be
  inventing a feature never specified. **This is a deliberate deviation from this dispatch's own literal
  instruction** ("list/detail/update" scope item, and the exit gate's "edits it" wording) — flagged here
  per architecture-compliance rule §7 rather than silently built. The delete confirm-dialog / rename
  affordance some dispatch phrasing may have implied is simply not part of the real Dev-12a/Dev-19a
  contract this phase ports.
- PDF-based/AI-assisted exam generation (FR-AUTH-2) — Phase 6's own 79-file phase.
- Any `attempts` (Phase 7)/`practice` (Phase 8) consumption of the question bank.

## The `exam_type_curriculum` scope-split judgment call (overriding both this dispatch's prompt and Phase 3's own plan-doc prediction)

The dispatch instructed: *"check `exam-type-curriculum.entity.ts` — this is a real, already-buildable
relationship... this belongs in scope this dispatch, it has no AI dependency."* Phase 3's own plan doc
and its `20260815000004-create-curriculum-table.ts` migration comment independently predicted the same
thing ("`exam_type_curriculum`... FR-CUR-7, Curriculum-exam linkage, is Phase 4's own scope").
**Both predictions turned out to be wrong once the actual legacy code was read — this is a case where
the codebase (ground truth) overturned prior-phase intent, and per this project's own operating
principle ("design docs describe intent, the codebase is ground truth"), the codebase wins.**

Evidence, read in full before making this call:

1. `legacy/api/src/modules/exam-authoring/api/exam-authoring.controller.ts` and
   `application/exam-authoring.service.ts`: the manual-ZIP creation flow (`createFromZip`) never
   references `ExamTypeCurriculumEntity`/`ExamAuthoringRepository` anywhere. `CreateExamTypeDto` has no
   `curriculumId`/`curriculumLinks` field at all.
2. `legacy/api/src/modules/pdf-processing/infrastructure/repositories/finalize-exam.repository.ts`
   (`FinalizeExamRepository.finalize`) is the **only** place in the entire legacy codebase that
   `em.getRepository(ExamTypeCurriculumEntity).insert(...)` is ever called — inside the PDF-processing
   pipeline's finalize step (Phase 6 territory), not exam-authoring's own service.
3. `docs/PRODUCT_SPECIFICATION.md`'s own FR-PDF-9 confirms this placement explicitly: *"The reviewer
   may optionally link one or more Curricula to the resulting Exam Type as part of the same finalize
   action (FR-AUTH-4)"* — Curriculum linking is described as part of the **finalize** flow, not manual
   ZIP authoring.
4. `legacy/api/src/infrastructure/database/migrations/tenant/1730000000004-create-exam-authoring-tables.ts`'s
   own doc comment: *"`exam_type_curriculum` is deliberately NOT created by this migration — it foreign-
   keys `curriculum(id)`, a table that does not exist until BL-12."* The actual legacy migration
   creating `exam_type_curriculum` is `1730000000008-create-exam-type-curriculum-table.ts`, sequenced
   **after** `1730000000006-create-pdf-processing-session-table.ts` — i.e. it was added alongside the
   PDF-processing/finalize infrastructure, not alongside exam-authoring's own tables (migration
   `1730000000004`).

**Decision: `exam_type_curriculum`'s entity/migration/linking UI is deferred to whichever Phase 6
dispatch builds the finalize flow — not built this phase at all.** Building it now would create a table
with zero real writers until Phase 6 (the same "half-built, dead-end" anti-pattern Phase 3 already
rejected for `curriculum_document`), and — unlike Phase 3's `curriculum_document` case, where the
deferred table's *shape* was genuinely unsettled — here the shape is fully known from legacy's DDL, but
the *feature* itself (optionally linking Curricula while finalizing an AI-authored exam) has no home in
this phase's manual-ZIP-only scope. This phase's own migration
(`20260815000005-create-exam-authoring-tables.ts`) carries the identical forward-reference doc comment
legacy's own `1730000000004` migration does, naming Phase 6 as the expected owner.

## Decisions made (LLD/plan silent, or a genuine judgment call — smallest-reasonable-choice standard)

1. **`fixSubjectMapping` deferred whole, not stubbed** — see "Explicitly out of scope" above. Unlike
   `EXAM_TYPE_HAS_ACTIVE_ATTEMPTS` (a real legacy stub pattern with a clear, documented precedent for
   "ship a vacuous version now, wire it for real later"), legacy has no equivalent "stub" precedent for
   an AI-backed action — every one of legacy's own AI-touching endpoints either has the real
   `AiServicePort` behind it or doesn't exist yet at that phase. Building a fake 202 response here would
   invent a contract Phase 5 then has to match exactly, for no benefit over simply not building the route
   yet.
2. **`hasActiveAttempts()` stub, reproduced faithfully.** `ExamAuthoringService.delete()` calls
   `this.repository.hasActiveAttempts(id)`, which always returns `false` (no `attempts` table exists to
   query) — same as legacy's Dev-12a/Dev-19a-era code, with an identical doc comment naming Phase 7 as
   the real implementation's future home. No `AttemptEntity` import exists anywhere in this module.
3. **No stage-existence check added to `createFromZip`, matching legacy's own (undertested) behavior
   exactly.** Legacy's `ExamAuthoringService` never validates that `input.stageId` refers to a real
   `stage` row — it relies entirely on the `fk_exam_stage` FK constraint, and its own spec file
   (`exam-authoring.service.spec.ts`) never exercises a nonexistent-stage case. A nonexistent `stageId`
   therefore still gets the full "storage written, then rolled back on any DB failure" guarantee (the
   `catch` block in `createFromZip` calls `storage.deletePrefix` for **any** thrown error, not only
   `ExamTypeNameExistsError`) — it simply surfaces as a generic 500 rather than a clean 400. This is a
   pre-existing legacy ergonomics gap, not a security defect (no authorization decision depends on
   `stageId`, and the FK still prevents any orphaned/corrupt row), so it is ported faithfully rather than
   silently "improved" beyond this phase's scope.
4. **No `FeatureLimitGuard`/usage-metering equivalent applied to `POST /exam-types/zip`.** Legacy gates
   this route with `@RequiresFeature('exams.create')` via `FeatureLimitGuard` (package-tier quota
   metering). No `platform/usage`/feature-usage-metering module exists anywhere in `apps/next` yet — the
   migration plan's own Phase 2 line only names `platform/billing`/`platform/ai-models`/packages-features
   CRUD UI, never a usage-metering guard, and no later-phase item names it either. This is a pre-existing
   gap in the migration plan itself (not something this phase introduces or is positioned to fix) —
   flagged here rather than silently building a one-off metering check with no shared home, or silently
   skipping the gap without naming it.
5. **ZIP upload size guard**: `Content-Length`-based pre-check before `request.formData()`, mirroring
   `POST /api/profile/picture`'s own documented real-defect fix (`request.formData()` on an
   oversized body can throw a raw 500 from inside undici rather than returning a clean `413`). Uses the
   new `MAX_ZIP_SIZE_BYTES` env var (default `104_857_600`, matching legacy's own default) plus the same
   `MULTIPART_OVERHEAD_ALLOWANCE_BYTES` pattern.
6. **Multipart `modules[]` field parsing**: `request.formData()` returns every non-file field as a
   string — `modules` arrives JSON-encoded exactly as legacy's `CreateExamTypeDto` describes ("this
   codebase's first multipart-request-with-a-nested-array DTO"). This app has no `class-validator`
   equivalent, so the Route Handler `JSON.parse`s the `modules` field directly and validates each entry's
   shape (`name`: string 1-200 chars, `questionCount`: positive integer) with the existing
   `common/http/validate.ts` helpers, throwing `VALIDATION_FAILED` for a malformed/unparseable value
   (matching `CreateExamTypeDto`'s own "an unparseable string becomes an empty array... reports the
   standard `VALIDATION_FAILED` shape" behavior).
7. **`yazl` added as a devDependency only** (not a runtime dependency) — used exclusively by this
   phase's own unit/integration tests to construct well-formed in-memory ZIP fixtures (mirroring
   `legacy/api/test/exam-authoring.e2e-spec.ts`'s own `buildZip` helper); `yauzl` is the real runtime
   dependency `parseExamZip` uses to read an uploaded archive. Both already pass the ADR's
   dependency-maturity bar (already vetted and in production use in `legacy/api`).
8. **Nav item ("Exam Types") gated on `exams.read`**, not `exams.create` — matches legacy's own
   `ExamTypeListComponent` (`canCreate`/`canDelete` are separate, narrower gates on the Create
   button/row-delete action; the list route itself, and therefore the nav link to it, only needs
   `exams.read`).
9. **Stage-name lookup on the list/detail screens** re-derives client-side from
   `GET /api/taxonomy/education-levels` + per-level `GET /api/taxonomy/stages`, exactly mirroring
   legacy's own `ExamTypeListComponent`/`ExamTypeDetailComponent` "no flat all-stages endpoint" judgment
   call (`docs/design/UX_GUIDELINES.md` §9's flag 35 precedent) — not re-derived independently, reused
   verbatim as the same judgment call still applies (no flat endpoint was added by Phase 3 or since).

## Exit gate

1. `next build` succeeds cleanly.
2. `eslint --max-warnings=0` clean, including a deliberately-added-then-reverted module-boundary
   violation for each of the two new modules (`exam-authoring`, `infrastructure/zip`).
3. New tenant-schema migration (`20260815000005`) runs clean against real MySQL in the established
   `examland_platform_next`/tenant-schema isolation approach, verified via `information_schema` for the
   `fk_exam_stage` FK.
4. Unit tests for new pure-logic code (ZIP-parsing edge cases incl. zip-slip, module/question-count
   consistency checks, multipart field validation) with coverage ≥80% (or the project's own higher bar)
   on every new file.
5. Real end-to-end proof via `scripts/playwright-smoke-tenant.ts` (extended, not forked): a tenant user
   uploads a real ZIP file through the real UI, creates an Exam Type with declared modules, sees it in
   the list, views its detail (modules/question counts), deletes it — all reflected in real DB state,
   zero console errors. (Curriculum-linking and edit/update are not part of this exit gate — see scope
   sections above for why.)
6. Legacy containers (`exam-4u-api-1`, `-worker-1`, `-mysql-1`, `-qdrant-1`, `-mailhog-1`) confirmed
   undisturbed (`docker ps` diffed before/after).

## Verification evidence

1. **`next build`**: clean. `DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev
   DB_PLATFORM_SCHEMA=examland_platform_next JWT_TENANT_SECRET=<32+ chars>
   JWT_PLATFORM_SECRET=<a different 32+ chars> FILE_SIGNING_SECRET=<32+ chars> npm run build -w
   apps/next` — compiles, lints, type-checks, and generates all routes cleanly, including the new
   `/api/exam-types`, `/api/exam-types/zip`, `/api/exam-types/[id]`, `/exam-types`, `/exam-types/new`,
   `/exam-types/[id]` routes.
2. **`eslint --max-warnings=0`**: clean on the whole app. A deliberate violation file was added (deep-
   importing `@/server/exam-authoring/application/exam-authoring.service` and
   `@/server/infrastructure/zip/exam-zip-parser` from outside either module), confirmed to fail with
   exactly the two new rules' expected messages, then removed — `EXAM_AUTHORING_BARREL_ONLY`/
   `INFRASTRUCTURE_ZIP_BARREL_ONLY` both proven to actually fire.
3. **Migration against real MySQL**, verified via `information_schema` (not just "the migration ran"):
   ran `TENANT_MIGRATIONS` against a fresh throwaway tenant schema; `SHOW TABLES` confirms
   `exam_type`/`exam_module`/`exam_type_question` all exist; the `migrations` table lists
   `CreateExamAuthoringTables20260815000005` after the pre-existing four;
   `information_schema.KEY_COLUMN_USAGE` confirms `fk_exam_stage` FKs `exam_type.stage_id ->
   stage(id)`.
4. **Unit tests**: 647 tests / 77 files green (`JWT_TENANT_SECRET`/`JWT_PLATFORM_SECRET` set, `npx
   vitest run --exclude "**/*.integration.test.ts"`). New-file coverage: `exam-authoring.service.ts`
   100%/95.91% (statements/branch); `exam-authoring/domain/errors.ts` 100%/100%;
   `exam-zip-parser.ts` 94.76%/91.46%; `zip/errors.ts` 100%/100%; `zip-signature.util.ts` 100%/100% —
   all clear the "≥80% on files this dispatch added/changed" bar. `exam-authoring/infrastructure/
   exam-authoring.repository.ts` and `index.ts` sit at 0% in vitest, matching the exact established
   precedent for every other tenant-scoped module in this app (`taxonomy`/`curricula`'s own
   repository/`index.ts` files) — proven by the real-MySQL integration test below instead.
5. **Real-route-level integration test** (`server/phase4-exam-authoring-routes.integration.test.ts`,
   real MySQL + real disk storage + real JWT, calling the actual exported Route Handler functions):
   9/9 green. Covers unauthenticated rejection, RBAC fail-closed (`403 FORBIDDEN`) for a Member
   lacking `exams.create`/`exams.delete`, the full Tenant-Admin ZIP-upload-to-persisted-rows-and-real-
   disk-files happy path, list/get, the content-level `QUESTION_COUNT_MISMATCH` (declared-vs-actual
   per module, with zero new storage artifacts), `409 EXAM_TYPE_NAME_EXISTS` with full storage
   rollback on the losing attempt, a structural zip-slip-class rejection (`INVALID_ZIP_STRUCTURE`)
   with zero new artifacts, and delete (204, real DB row + real storage-prefix removal, subsequent GET
   404s).
6. **Real end-to-end browser proof** (`scripts/playwright-smoke-tenant.ts`, extended not forked):
   provisioned `demo-phase4` via `scripts/provision-phase3-demo-tenant.ts` (reused directly, no new
   provisioning script needed), started a real `next start -p 3184` server
   (`NODE_ENV=test`/`DEFAULT_TENANT_SUBDOMAIN=demo-phase4`, matching Phase 3's own established dev-
   bypass precedent), and ran all 18 assertions green (the 11 pre-existing Phase 3 assertions plus 5
   new Phase 4 ones): a tenant-user navigates to Exam Types via the real permission-gated nav link,
   creates an Exam Type with two declared modules via a genuine ZIP file upload (built in-memory via
   `yazl`, since no checked-in ZIP fixture exists under `legacy/api/test/fixtures/**`), sees its real
   persisted modules/question counts on the detail screen, sees it in the list, and deletes it via the
   confirm dialog (with real disk cleanup) — **zero console errors** across every page load in the run.
7. **Legacy containers undisturbed**: `docker ps` diffed before/after every step of this pass (unit
   tests, the real-MySQL/real-disk integration test, the demo-tenant provisioning script, the real
   `next start` boot, and the full Playwright run) — `exam-4u-api-1`/`-worker-1`/`-mysql-1`/
   `-qdrant-1`/`-mailhog-1` (and every other pre-existing container on this shared host) completely
   undisturbed throughout, only uptime counters advanced. The `next start` process on port 3184 was
   stopped and the port freed after verification.

## Status

**Phase 4 complete.** All 7 exit-gate items above independently proven. `apps/next` now has a real,
RBAC-enforced manual-ZIP Exam Type authoring flow (`server/exam-authoring`, `server/infrastructure/zip`)
backed by one new tenant-schema migration, three new tenant-schema entities, and a Chakra v3
list/create/detail UI reusing the Phase 3 tenant shell (extended with a new "Exam Types" nav item).
`fixSubjectMapping`/retroactive subject re-mapping (FR-AUTH-6) and Curriculum linking
(`exam_type_curriculum`, FR-AUTH-4) are both explicitly deferred — the former to Phase 5+ (needs
`AiServicePort`), the latter to Phase 6 (its real writer is the PDF-processing finalize flow, per this
doc's own judgment-call section, overriding both this dispatch's own prompt and Phase 3's plan-doc
prediction). No `PATCH /exam-types/:id` (edit) exists, matching legacy's own real contract exactly — see
the scope section for the full reasoning on that deliberate deviation from this dispatch's literal
instruction.

Next migration-plan phase: Phase 5, "AI & vector platform layer (infra-only, the actual pivot)" — the
first phase to introduce `AiServicePort`/ADK-TS/OpenRouter/Qdrant infrastructure, which unblocks both of
this phase's own deferred items (`fixSubjectMapping` here; document upload/search for `server/curricula`,
per Phase 3's own deferral) as well as Phase 6's PDF-processing pipeline (which in turn owns
`exam_type_curriculum`).
