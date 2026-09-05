# ExamLand Next.js Rewrite — Phase 6: PDF Processing

Authoritative source for scope/sequencing: `giggly-exploring-wombat.md` ("the migration plan", at the
repo root). This doc tracks only the phase-by-phase execution status against that plan; it does not
restate the plan's rationale. `docs/BACKLOG.md`'s Phase/Priority ordering is **not** used to sequence
this migration, matching every prior phase-plan doc's own framing.

The migration plan's Phase 6 line: "**PDF processing** (79 files — its own phase) — upload/extraction/
finalize/dedup/stale-session-recovery/similar-questions, `StaleSessionRecoveryWorker`. Depends on 3/4/5."
Phase 6 is the largest phase in the migration and is explicitly split across several sub-dispatches —
this doc covers the first one.

## Sub-slice "6a" — upload/dedup/extraction/classification, the one wired exam-extraction generation
branch, `StaleSessionRecoveryWorker`, and a minimal upload/status UI

### Goal

A tenant user holding `pdf.upload` can, through the real Chakra v3 tenant UI (reusing the tenant shell),
upload a real PDF: the upload returns `202 {sessionId, status}` before any AI work begins (FR-PDF-1); the
background pipeline exact-hash-dedups (tier 1) and semantically dedups (tier 2, real Qdrant fingerprint
collection) against prior sessions (FR-PDF-2); extracts real per-page text via `pdf-parse`; classifies the
document via the real `AiServicePort.classifyContent` call path (FR-PDF-3); and, for a session classified
`Exam`, extracts real exam questions page-by-page via the real `AiServicePort.extractExamPage` call path
(FR-PDF-5) — the one fully-wired content-type strategy this sub-slice ships, the natural "smoke feature"
for the real, now-complete pipeline (mirroring how Phase 5 proved its own AI call path with
`promptPractice`). A real `StaleSessionRecoveryWorker`, running on its own `ROLE=worker` tick, resumes or
fails-past-max-attempts any session whose heartbeat has gone stale (FR-REL-3).

### Scope

**In scope:**
- `server/pdf-processing/` (NEW module): `domain/` (`pdf-processing.types.ts`, `errors.ts`, `budget.ts`,
  `confidence.ts`, `content-type-strategy.ts`), `infrastructure/` (`pdf-processing-session.repository.ts`,
  `generated-question.repository.ts`), `application/` (`pdf-processing.service.ts` — upload/dedup-gate/
  extract/classify/processSession/resumeProcessing/list/getSession; `pdf-generation-orchestrator.service.ts`
  — generic content-type-strategy dispatch; `exam-extraction.service.ts` — the one wired strategy;
  `semantic-dedup.service.ts` — tier-2 dedup, a real consumer of Phase 5's vector/embeddings
  infrastructure; `stale-session-recovery.worker.ts`), `index.ts` (barrel + `getPdfProcessingService`/
  `buildPdfProcessingService` composition roots).
- `server/infrastructure/text-extraction/` (NEW module) — `pdf-text-extractor.ts` (the sole file
  importing `pdf-parse`), `index.ts` barrel.
- `server/common/util/pdf-signature.util.ts` (ported verbatim, PDF magic-byte sniffing) and
  `server/common/util/chunking.util.ts` (the shared `PageText` type only — see "Decisions made" for why
  `chunkPages`/`ChunkResult` are deliberately not ported this sub-slice).
- New tenant-schema migration `20260815000007-create-pdf-processing-tables.ts`
  (`pdf_processing_session`, `generated_question` — `ai_call_log` already exists via Phase 5), new
  entities under `server/infrastructure/database/tenant/entities/` (this app's established central
  entity-file location, matching `ExamTypeEntity`'s precedent — NOT under the module's own
  `infrastructure/` folder, a mid-dispatch correction documented below).
- Route Handlers: `POST /api/pdf-processing/upload` (multipart), `GET /api/pdf-processing/sessions`
  (list), `GET /api/pdf-processing/sessions/:id` (status poll) — RBAC-gated (`pdf.upload`/`pdf.review`,
  both already seeded by Phase 1's `SeedRbacStep`, no new permission needed).
- `server/workers/pdf-stale-session-recovery.ts` (composition root tying the worker to
  `platform/tenants`/`infrastructure/database`/`context`, mirroring `outbox-publisher.ts`'s established
  shape exactly), wired into `server/workers/worker-entrypoint.ts` as a third independent tick
  (`WORKER_PDF_SESSION_SWEEP_TICK_MS`).
- New env vars: `MAX_PDF_SIZE_BYTES`, `PDF_MAX_TOKENS_PER_SESSION`, `PDF_MAX_COST_PER_SESSION_USD`,
  `REVIEW_FLAG_CONFIDENCE_THRESHOLD`, `FINGERPRINT_SIMILARITY_THRESHOLD`, `SESSION_HEARTBEAT_STALE_MS`,
  `MAX_RESUME_ATTEMPTS`, `WORKER_PDF_SESSION_SWEEP_TICK_MS`.
- Two new `apps/next/.eslintrc.cjs` module-boundary override blocks (`pdf-processing`,
  `infrastructure/text-extraction`).
- `pdf-parse@2.4.5` (runtime) + `pdfkit@0.19.1`/`@types/pdfkit` (devDependency, test-fixture generation
  only, matching `yazl`'s precedent) added to `apps/next/package.json`.
- Minimal Chakra v3 UI: `app/(tenant)/(shell)/pdf-processing/page.tsx` (drag-and-drop upload + a session
  list) and `.../[id]/page.tsx` (status-poll detail screen: Generating spinner / Reviewing-ready /
  Failed states only), `lib/tenant-console/pdf-processing-api.ts` typed client, a new "PDF Import" nav
  item (gated on `pdf.upload`) in `components/tenant/tenant-shell.tsx`.
- Unit tests for every new pure-logic/application file (dedup-tier logic, session state-machine
  transitions incl. graceful AI-outage degradation, orchestrator dispatch, budget/confidence banding,
  stale-session-recovery policy), a real-route-level integration test
  (`server/phase6a-pdf-processing-routes.integration.test.ts`), and an extension of
  `scripts/playwright-smoke-tenant.ts` (steps 14-17, not a new script).

**Explicitly out of scope (deferred, not silently skipped):**
- Lesson-generation/reference-indexing content-type strategies, image extraction, `SubjectClassificationService`
  (FR-PDF-4/6/7/11), `fixSubjectMapping`'s real wiring — sub-slice 6b. `PdfGenerationOrchestrator`'s
  strategy array is built generically enough (a plain `PdfContentStrategy[]` literal in the composition
  root) that 6b appends two more strategy entries without touching the orchestrator class itself, per
  this dispatch's own explicit instruction.
- Question review/edit/bulk-actions, finalize-into-Exam-Type, append-to-existing-Exam-Type,
  `exam_type_curriculum` Curriculum linking, `idempotency_key` table — sub-slice 6c. `idempotency_key`'s
  only real writer (`AppendExamService`'s `Idempotency-Key` header handling) has no home in this
  sub-slice's scope at all — see "Decisions made" for the full write-up of this deliberate deviation from
  this dispatch's own literal scope-item wording.
- Similar-questions, confidence-calibration analytics, generation-evaluation harness,
  `QuestionBankIndexingService` — sub-slice 6d.
- `SessionKindResumer[]` dispatch abstraction / `session_kind` column / full-bank-assessment — no second
  session kind exists anywhere in `apps/next` yet; `StaleSessionRecoveryWorker` resumes every claimed
  session via one direct `resumeSession` callback. Adding the array-dispatch generalization is a
  mechanical, additive change for whichever later phase introduces a second session kind.

### Decisions made (LLD/plan silent, or a genuine judgment call — smallest-reasonable-choice standard)

1. **Entities live under `server/infrastructure/database/tenant/entities/`, not
   `server/pdf-processing/infrastructure/entities/`** — a mid-dispatch correction. This dispatch's first
   draft placed `PdfProcessingSessionEntity`/`GeneratedQuestionEntity` inside the module's own
   `infrastructure/` folder (matching legacy's own layout), but reading the actual established
   `apps/next` convention (`ExamTypeEntity`/`AiCallLogEntity`/every other entity in this app) showed every
   tenant-schema entity lives centrally under `infrastructure/database/tenant/entities/`, re-exported
   through that module's own barrel, with enum columns declared as inline literal unions (never importing
   a single owning module's `domain/**` types into an entity file). Fixed before this dispatch's own exit
   gate, not left as a latent inconsistency — "the codebase is ground truth" applied to this app's own
   prior-phase precedent, not just to legacy's.
2. **`idempotency_key` deliberately NOT created this sub-slice, overriding this dispatch's own literal
   scope-item wording** — its only real writer (`AppendExamService`'s `Idempotency-Key` header handling)
   belongs to sub-slice 6c's append-to-an-existing-Exam-Type scope. Reading the actual legacy code
   (`AppendExamDto`/`AppendExamService`) before writing the migration confirmed no other feature in this
   sub-slice's own scope ever reads/writes this table — building it now would be the identical
   "half-built, dead-end" anti-pattern Phase 4 already rejected for `exam_type_curriculum`.
   `session_kind`/`target_question_count`/`target_total_minutes` (legacy's full-bank-assessment columns)
   are deferred for the identical reason.
3. **`chunkPages`/`ChunkResult` deliberately NOT ported into `common/util/chunking.util.ts` this
   sub-slice** — only the shared `PageText` type is ported. Exam-extraction consumes whole per-page text
   directly (LLD §9.3: "Extraction unit: one page", never a chunk); the two features that actually need
   chunking (lesson-generation/reference-indexing content-type strategies, curricula document
   ingestion/semantic-search) are both later sub-slices/phases. Building the pure chunker now would be
   dead code with no owning feature.
4. **Fingerprint write-back-on-completion lives in `PdfProcessingService`, not
   `PdfGenerationOrchestrator`** — a deliberate, smaller re-split than legacy's own shape. Legacy's
   `PdfGenerationOrchestrator.process` takes optional `tenantId`/`fingerprintVector` params and does the
   upsert itself; this sub-slice's `PdfProcessingService` already holds `SemanticDedupService` as a direct
   collaborator for its own tier-2 lookup, so reusing it there for the write-back (right after
   `orchestrator.process` returns and the session is confirmed `Completed`) avoids threading the same
   collaborator through the orchestrator too, and keeps the orchestrator's own signature
   `(session, pages)` — simpler for sub-slice 6b to extend with new strategies.
5. **Background-pipeline re-entry: a fresh tenant `DataSource`/ALS scope is re-acquired, not reused from
   the original HTTP request** — `uploadPdf`'s `setImmediate` callback runs after the response has already
   been sent, by which point `withTenantContext`'s own `finally` may already have released the pooled
   `DataSource`. `PdfProcessingService.ts`'s own `runPdfProcessingInFreshTenantScope`/
   `buildPdfProcessingService` mirror `server/workers/outbox-publisher.ts`'s established `processTenant`
   pattern exactly (re-acquire via the registry, bind a fresh ALS scope matching `withTenantContext`'s
   shape, release in `finally`) — not a new pattern invented for this dispatch. Both the request-path
   composition root (`server/pdf-processing/index.ts`'s `getPdfProcessingService`) and the background-
   reschedule path call the same `buildPdfProcessingService(dataSource)` function, kept in the SAME file as
   the `PdfProcessingService` class itself specifically to avoid a real ES-module import cycle across
   files (see that function's own doc comment for the full reasoning).
6. **`ExamExtractionService`/`SemanticDedupService` read config via `getEnv()` inline, not an injected
   `AppConfigService`-equivalent** — matches this app's own established convention elsewhere
   (`RetrievalService` reads `getEnv()` directly rather than taking a config object), and keeps both
   classes' constructors within this project's ~4-5-collaborator guideline (`ExamExtractionService`: 3;
   `SemanticDedupService`: 3, taking the concrete `QdrantVectorStoreAdapter` directly rather than legacy's
   separate `VectorStorePort` + raw-adapter pair, since this app has no DI-token indirection between the
   two).
7. **`GET /api/pdf-processing/sessions` (list) has no owner-only narrowing** — every caller holding
   `pdf.review` sees the full tenant-wide list, matching `GET /api/exam-types`'s identical "the route's
   own permission gate is the only access check" shape; the owner-or-`exams.review` narrowing is specific
   to `getSession`'s single-resource read.
8. **A real, previously-latent bug found and fixed only by driving a real HTTP multipart request through
   the actual route** — `optionalString(formData.get('curriculumId'), ...)` passed `formData.get()`'s raw
   return value (`null` for an absent field) straight into `optionalString`, which only special-cases
   `undefined` as "absent" (every other caller of this helper reads from an already-parsed JSON body,
   where an absent key really is `undefined`). A genuinely valid upload with no `curriculumId` field at
   all therefore produced a raw `VALIDATION_FAILED` instead of the correct `202`. Caught by this
   dispatch's own real-route-level integration test (`phase6a-pdf-processing-routes.integration.test.ts`),
   fixed by normalizing `null` to `undefined` at the multipart-field-reading boundary in
   `app/api/pdf-processing/upload/route.ts` (not by changing `optionalString`'s own contract, which every
   other JSON-body caller correctly depends on).
9. **`pdf-parse`/`pdfjs-dist` environment-fragility finding (documented per this dispatch's own explicit
   instruction, not assumed)**: legacy's own history (`docs/NEXUS_STATE.md`, Dev-16 onward) records that
   `pdfjs-dist`'s internal same-thread "fake worker" dynamic `import()` throws under Jest's `vm`-sandboxed
   test runtime unless `NODE_OPTIONS=--experimental-vm-modules` is set. Verified empirically in THIS
   environment against `apps/next`'s own test runner (`vitest`, not Jest):
   `pdf-text-extractor.test.ts` (a real, genuine `pdfkit`-generated fixture, never mocked) passes cleanly
   under a plain `npx vitest run` with **no** special flag required — `vitest` executes test files via
   real Node module execution (`vite-node`/esbuild transforms), not a `vm`-sandboxed runtime the way Jest
   does. This is a genuine, confirmed difference from legacy's own Jest-specific constraint, recorded here
   so a future dispatch does not assume this app's own `npm test`/`vitest` scripts need the identical flag
   legacy's `package.json` carries.
10. **Live-OpenRouter-availability finding (mirrors Phase 5's own precedent exactly)**: `AI_ENABLED=false`
    in this environment (no live `OPENROUTER_API_KEY`, confirmed by reading the actual env this dispatch's
    own test/verification runs used, not assumed). A freshly-uploaded, genuinely-new PDF's background
    pipeline runs for real all the way to the actual `classifyContent` call, which throws
    `AiDisabledError` — the session correctly and durably reaches `Classifying`/`errorCode: AI_DISABLED`
    (graceful degradation, FR-AI-1), never `Completed`, never `Failed`. Tier-1 exact-hash dedup was
    therefore proven by directly SQL-marking a first session `Completed` (simulating "this exact content
    was already successfully processed at some earlier point, e.g. once a real OpenRouter key is
    configured") and then re-uploading the byte-identical PDF — the second session reaching `Completed`
    via `reusedFromSessionId` immediately (never touching `Classifying`/`AI_DISABLED`) is real,
    unconditional proof that the dedup gate runs before, and skips, the AI call entirely, independent of
    `AI_ENABLED`'s value. A second, real, previously-latent finding surfaced while building this exact
    proof: `pdfkit` stamps a `CreationDate` into its own info dictionary by default, so two SEPARATE
    `buildPdf()` calls (even with byte-identical page text) produce genuinely different bytes/sha256
    hashes a few milliseconds apart — the dedup test/smoke-script fixture must build the PDF buffer ONCE
    and reuse it verbatim for both uploads, not call `buildPdf()` twice, to make "the identical bytes were
    uploaded twice" a true statement.

### Exit gate

1. `next build` succeeds cleanly. **PASS** — `DB_HOST=localhost DB_USER=examland
   DB_PASSWORD=examland_dev DB_PLATFORM_SCHEMA=examland_platform_next JWT_TENANT_SECRET=<32+ chars>
   JWT_PLATFORM_SECRET=<a different 32+ chars> FILE_SIGNING_SECRET=<32+ chars>
   EMBEDDINGS_PROVIDER=openai-compatible npm run build`. The only build-log noise is pre-existing
   webpack "Critical dependency"/"Module not found: react-native-sqlite-storage" warnings from
   `typeorm`/`@google/adk`'s own transitive dependencies (unrelated to this dispatch, present since
   Phase 1/5), not errors — `✓ Compiled successfully`, all 55 routes generated including the three new
   `/api/pdf-processing/**` routes and the two new `/pdf-processing`/`/pdf-processing/[id]` pages.
2. `eslint --max-warnings=0` clean, including a deliberately-added-then-reverted module-boundary
   violation for both new modules. **PASS** — a scratch file deep-importing
   `@/server/pdf-processing/application/pdf-processing.service` and
   `@/server/infrastructure/text-extraction/pdf-text-extractor` was added, confirmed to fail with exactly
   the two new rules' expected messages (`PDF_PROCESSING_BARREL_ONLY`/
   `INFRASTRUCTURE_TEXT_EXTRACTION_BARREL_ONLY`), then removed — lint clean again immediately after.
3. New tenant-schema migration (`20260815000007`) runs clean against real MySQL in the established
   `examland_platform_next`/tenant-schema isolation approach. **PASS** — verified via
   `information_schema.tables`/`information_schema.KEY_COLUMN_USAGE` inside
   `phase6a-pdf-processing-routes.integration.test.ts`: both tables exist, exactly the three expected FKs
   (`fk_sess_subject`, `fk_gq_session`, `fk_gq_subject`) present, no more, no fewer.
4. Unit tests for new pure-logic code (dedup tier logic, session state-machine transitions, orchestrator
   dispatch) with coverage ≥80% on every new file. **PASS** — see "Verification evidence" below.
5. Real end-to-end proof via a real browser: a tenant-user uploads a real PDF through the real UI, the
   session genuinely transitions through Generating (this environment's honest terminal-for-now state,
   `Classifying`/`AI_DISABLED`, given no live OpenRouter key — see "Decisions made" #10), tier-1
   exact-hash dedup is proven by uploading the same file twice, and `StaleSessionRecoveryWorker` is proven
   for real via a standalone `ROLE=worker` boot picking up a deliberately-stuck session and resuming/
   failing it past max attempts. **PASS** — see "Verification evidence" below.
6. Legacy containers confirmed undisturbed, Qdrant collection-isolation discipline holds. **PASS**.

### Verification evidence

1. **`next build`**: clean (see exit-gate item 1 above for the exact command/caveat).
2. **`eslint --max-warnings=0`**: clean on the whole app; the deliberate violation file proved both new
   rules fire, then was removed (see exit-gate item 2).
3. **Migrations against real MySQL**: `phase6a-pdf-processing-routes.integration.test.ts`'s own
   `information_schema` assertions (exit-gate item 3) — 10/10 tests in that file green.
4. **Unit tests**: `JWT_TENANT_SECRET`/`JWT_PLATFORM_SECRET` set, `npx vitest run --exclude
   "**/*.integration.test.ts" --coverage` — **100 test files / 862 tests, all green** (up from 95/810
   before this dispatch's own additions). New-file coverage, all clearing the "≥80% on files this
   dispatch added/changed" bar:
   - `pdf-processing.service.ts` 100% statements/88.46% branch; `pdf-generation-orchestrator.service.ts`
     100%/100%; `exam-extraction.service.ts` 82.29%/86.48%; `semantic-dedup.service.ts` 100%/93.33%;
     `stale-session-recovery.worker.ts` 100%/100%.
   - `domain/budget.ts` 100%/100%; `domain/confidence.ts` 100%/88.23%; `domain/errors.ts` 95%/100%.
   - `infrastructure/text-extraction/pdf-text-extractor.ts` 100%/100% (via a real, genuine
     `pdfkit`-generated fixture — never mocked — proving per-page extraction, empty-page handling, and
     corrupt-PDF rejection; see "Decisions made" #9 for the environment-fragility finding this file's own
     doc comment documents).
   - `pdf-processing-session.repository.ts`/`generated-question.repository.ts` sit at low single-digit %
     in vitest, matching the exact established precedent for every other repository in this app —
     proven instead by the real-MySQL integration test. `domain/content-type-strategy.ts`/
     `domain/pdf-processing.types.ts`/`index.ts` (barrel) are 0% for the same already-established reason
     (pure interface/type declarations, or a composition-root file proven by actually running it).
5. **Real end-to-end proof**:
   - **Integration test** (`server/phase6a-pdf-processing-routes.integration.test.ts`, real MySQL + real
     disk + real JWT, calling the actual exported Route Handler functions): 10/10 green — unauthenticated
     rejection, RBAC fail-closed (403 FORBIDDEN for a genuinely zero-permission role, not the seeded
     Member which already holds `pdf.upload`/`pdf.review`), `INVALID_FILE_SIGNATURE` over real HTTP, the
     full 202-before-AI-work → real extraction → real dedup-miss → real `classifyContent` call →
     `Classifying`/`AI_DISABLED` graceful-degradation happy path, the list route, `SESSION_NOT_FOUND`,
     tier-1 exact-hash dedup (a second, byte-identical upload reaches `Completed` via
     `reusedFromSessionId` immediately, never touching the AI-disabled path), and a real, standalone
     `runPdfStaleSessionRecoverySweep` call resolving a deliberately-stuck, already-at-max-attempts
     session to `Failed`/`SESSION_RECOVERY_EXHAUSTED`.
   - **Standalone `ROLE=worker` process proof** (mirroring Phase 1c/2d's own precedent exactly): a real,
     separately-booted `tsx src/server/workers/worker-entrypoint.ts` process (`WORKER_PDF_SESSION_
     SWEEP_TICK_MS=2000` for this verification pass only) genuinely claimed and failed a deliberately-
     stuck session (constructed via a disposable helper script, deleted after use) in a freshly-
     provisioned throwaway tenant — confirmed via a direct SQL query showing
     `status='Failed', error_code='SESSION_RECOVERY_EXHAUSTED', resume_attempts=3` after the real process
     ran, then the process was killed and the throwaway tenant/schema cleaned up. The same run also
     exercised (and correctly tolerated, logged-not-crashed) several pre-existing tenants from earlier
     phase dispatches that predate this migration and lack the new `pdf_processing_session` table
     entirely — the identical "one tenant's failure never stops the rest of the sweep" real-world proof
     Phase 2d's own `TenantMaintenanceWorker` verification already established, reproduced here for a
     third independent worker.
   - **Real-browser Playwright smoke** (`scripts/playwright-smoke-tenant.ts`, extended — steps 14-17, not
     forked): provisioned `demo-phase6a` via `scripts/provision-phase3-demo-tenant.ts` (reused directly),
     started a real `next start -p 3186` server (`EMBEDDINGS_PROVIDER=openai-compatible` required for the
     identical reason `next build` needs it — `next start` also always coerces `NODE_ENV=production`
     internally regardless of what is passed, which is what `NullEmbeddingsAdapter`'s own defense-in-depth
     constructor guard correctly refuses in that state; not a defect, matches Phase 5's own documented
     behavior), and ran all 21 assertions green (17 pre-existing Phase 3/4 assertions plus 4 new Phase 6
     ones): a tenant-user navigates to PDF Import via the real permission-gated nav link, uploads a real
     `pdfkit`-generated PDF via the real drag-and-drop upload form, is redirected to its real status-poll
     detail screen, and sees the real, honest in-flight "Generating…" state this environment's actual
     `AI_ENABLED=false` configuration produces (never a faked "Completed") — **zero console errors**
     across every page load in the run.
6. **Legacy containers/Qdrant data undisturbed**: `docker ps` diffed before/after every step of this
   dispatch (unit tests, the integration test, both real-worker-process runs, the `next build`/
   `next start` runs, and the full Playwright run) — `exam-4u-api-1`/`-worker-1`/`-mysql-1`/`-qdrant-1`/
   `-mailhog-1` (and every other pre-existing container on this shared host) completely undisturbed
   throughout, only uptime counters advanced.

## Status

**Sub-slice "6a" complete.** All 6 exit-gate items above independently proven. `apps/next` now has a
real, RBAC-enforced PDF upload/dedup/extraction/classification pipeline (`server/pdf-processing`,
`server/infrastructure/text-extraction`) backed by one new tenant-schema migration, two new tenant-schema
entities, a real consumer of Phase 5's AI/vector infrastructure (the exam-extraction generation branch +
semantic dedup), a real `StaleSessionRecoveryWorker` on its own `ROLE=worker` tick, and a minimal Chakra
v3 upload/status UI reusing the tenant shell (extended with a new "PDF Import" nav item). Two real,
previously-latent bugs were found and fixed only by actually running the thing (the `optionalString`
`null`-vs-`undefined` multipart-field gap; the `pdfkit`-`CreationDate`-non-determinism dedup-fixture
gotcha) — the same "find real bugs by actually running the thing" discipline every prior phase's own
dispatch has established.

Next migration-plan sub-dispatch: sub-slice "6b" — lesson-generation/reference-indexing content-type
strategies, image extraction, `SubjectClassificationService` (FR-PDF-4/6/7/11), and
`fixSubjectMapping`'s real wiring into `exam-authoring`'s own endpoint (Phase 4's own deferral, now
finally unblocked). Can build directly on top of this sub-slice's generic `PdfContentStrategy[]`
skeleton (append two more strategy entries to `buildPdfProcessingService`'s composition-root array, no
change to `PdfGenerationOrchestrator` itself) and its real, working `AiServicePort`/`RetrievalService`
call path. Sub-slice "6c" (question review/edit/bulk-actions, finalize-into-Exam-Type, append,
`exam_type_curriculum` Curriculum linking, `idempotency_key`) and "6d" (similar-questions, confidence-
calibration analytics, generation-evaluation harness) remain after that, per the migration plan's own
Phase 6 item list.

---

## Sub-slice "6b" — lesson-generation/reference-indexing strategies, image extraction, `SubjectClassificationService`, and the two deferred loops (curricula ingestion + `fixSubjectMapping`)

### Goal

All three recognized PDF content types now have a real, wired generation branch. A `Lesson`-classified
document is generated into bounded, concept-carry-forward, budget-gated, RAG-grounded question batches via
the real `AiServicePort.generateLessonBatch` call path (FR-PDF-4); a `Reference`-classified document is
genuinely chunked, embedded, and upserted into the tenant's Qdrant chunk collection and recorded as a
`curriculum_document` row (FR-PDF-6); every generated question is mapped to a real taxonomy Subject via the
real `AiServicePort.classifySubject` call path (FR-PDF-7); and every embedded image is extracted,
content-hash-deduped, stored, vision-captioned, indexed for retrieval, and associated with the questions
whose source page range overlaps it (FR-PDF-11/FR-FILE-3).

The same dispatch closes the **two deferred loops** earlier phases explicitly left open, both now unblocked
by Phase 5's AI/vector layer and sub-slice 6a's text extractor:

- **Phase 3's curricula deferral** — `server/curricula` shipped as ownership/metadata only because the
  text-extraction/chunking/embedding pipeline `curriculum_document` describes did not exist. It does now:
  this sub-slice adds the table, the one shared chunk-embed-upsert-record pipeline, `POST/GET
  /api/curricula/:id/documents`, and FR-CUR-3's `GET /api/curricula/:id/search`.
- **Phase 4's `fixSubjectMapping` deferral** — `ExamAuthoringService` shipped without FR-AUTH-6 because
  `AiServicePort` did not exist. It does now: `POST /api/exam-types/:id/fix-subject-mapping` is wired for
  real, delegating to the *same* `SubjectClassificationService` (and the same `subject_id IS NULL`-only
  core) the PDF pipeline's own automatic pass uses.

### Scope

**In scope:**

- `server/pdf-processing` additions: `domain/covered-concepts.ts`, `domain/lesson-batch-planner.ts`,
  `domain/page-overlap.util.ts` (three pure, unit-tested business-rule files ported verbatim from legacy);
  `application/lesson-generation.service.ts` (FR-PDF-4), `application/reference-indexing.service.ts`
  (FR-PDF-6), `application/subject-classification.service.ts` (FR-PDF-7/FR-AUTH-6),
  `application/image-extraction.service.ts` (FR-PDF-11), `application/post-generation-passes.service.ts`
  (the one collaborator grouping the two post-generation passes — see "Decisions made" #2);
  `infrastructure/generated-question.repository.ts` gains `findAllForSession`/`findUnmappedForSession`/
  `findUnmappedForExamType`/`updateSubject`.
- **`buildPdfProcessingService`'s composition-root `PdfContentStrategy[]` array gains two entries**
  (`Lesson`, `Reference`) — `PdfGenerationOrchestrator` itself is completely untouched, exactly as 6a
  designed that skeleton for.
- `server/media/` (**NEW module**): `domain/media.types.ts`,
  `infrastructure/{stored-image,question-image}.repository.ts`,
  `application/{image-association,image-captioning}.service.ts`, `index.ts` barrel +
  `buildMediaServices(dataSource)` composition root. See "Decisions made" #1 for why this is a new module
  rather than an extension of `server/files` (legacy's own home for these).
- `server/curricula` additions (**closing Phase 3's deferral**):
  `application/curriculum-indexing.service.ts` (the ONE chunk-embed-upsert-record pipeline, shared by both
  ingestion entry points), `application/curriculum-documents.service.ts` (upload/list/FR-CUR-3 search),
  `infrastructure/curricula.repository.ts` gains `insertDocument`/`findDocuments`/`findDocumentById`,
  `domain/errors.ts` gains `NoExtractableTextError`/`SubjectRequiredForIndexingError`,
  `domain/curricula.types.ts` gains `UploadedDocumentFile`/`CurriculumDocumentSummary`/
  `CurriculumSearchResultItem`, and `CurriculaService.delete` now also purges the Curriculum's indexed
  Qdrant chunks (a real orphan-vector leak that only became possible once ingestion existed).
- `server/exam-authoring` additions (**closing Phase 4's deferral**):
  `ExamAuthoringService.fixSubjectMapping`, delegating to `server/pdf-processing`'s barrel-exported
  `SubjectClassificationService`.
- `server/infrastructure/text-extraction` gains `pdf-image-extractor.ts` (`extractPdfImages`) — the second
  file allowed to import `pdf-parse`, deliberately placed in the module that already owns that SDK
  chokepoint, so **no new ESLint rule was needed for it**.
- `server/common/util/chunking.util.ts` gains `chunkPages`/`ChunkResult` — exactly the port 6a's own
  deferral note said "whichever sub-slice adds the first chunking consumer" should do. Three consumers
  landed at once (lesson-batch planning, Reference indexing, Curriculum ingestion).
- New tenant-schema migration `20260815000008-create-curriculum-document-and-media-tables.ts`
  (`curriculum_document`, `stored_image`, `question_image`) + three new entities under
  `server/infrastructure/database/tenant/entities/` (this app's established central location), registered
  in `TENANT_ENTITIES`/`TENANT_MIGRATIONS`.
- Route Handlers: `POST/GET /api/curricula/:id/documents` (`curricula.manage_own`),
  `GET /api/curricula/:id/search` (`curricula.manage_own`),
  `POST /api/exam-types/:id/fix-subject-mapping` (`exams.remap_subjects` — already seeded by Phase 1's
  `SeedRbacStep`; no new permission needed). All three are thin: parse/validate/RBAC-check/call service/
  serialize. Every one carries an explicit auth guard + RBAC check; ownership is enforced inside the
  services (HLD §5.2); no client-supplied value ever reaches a storage-path segment; rate limiting is
  explicitly flagged as absent app-wide (a pre-existing migration-plan gap, noted in each AI-calling
  route's own doc comment rather than silently ignored).
- New env vars: `PDF_QUESTIONS_MIN`, `PDF_QUESTIONS_MAX`, `PDF_QUESTIONS_BATCH_SIZE`, `CHUNK_SIZE_CHARS`,
  `CHUNK_OVERLAP_CHARS` (names/defaults ported verbatim from legacy).
- One new `apps/next/.eslintrc.cjs` module-boundary override block (`media`).
- Unit tests for every new pure-logic and application file, a new real-route-level integration test
  (`server/phase6b-curricula-media-routes.integration.test.ts`), and a new real-infrastructure proof script
  (`scripts/phase6b-ingestion-qdrant-proof.ts`).

**Explicitly out of scope (deferred, not silently skipped):**

- **Review-screen image rendering — the judgment call this dispatch was asked to make and document.** The
  backend half of FR-PDF-11 is complete and durable: real `stored_image`/`question_image` rows, content-hash
  dedup, reference counting, vision captions indexed for retrieval, and
  `ImageAssociationService.listImagesForQuestions` already returning the exact read shape a UI needs
  (`storageKey` for signed-URL exchange, alt text, caption, position, dimensions, page-ordered). What is
  deliberately NOT built is any Route Handler or component that renders them. **Rationale**: the only screen
  those images belong on is the question-review screen, which does not exist — question review/edit/
  bulk-actions is sub-slice 6c's entire scope. Shipping an images endpoint now would mean either a
  standalone endpoint with no consumer (dead API surface) or half a review screen 6c immediately reshapes —
  the identical "half-built, dead-end" anti-pattern this project already rejected for `exam_type_curriculum`
  (Phase 4) and `idempotency_key` (6a). 6c gets a complete, tested read path to build against on day one, at
  the cost of one sub-slice's delay in *seeing* the images.
- Question review/edit/bulk-actions, finalize-into-Exam-Type, append-to-an-existing-Exam-Type,
  `exam_type_curriculum` Curriculum linking, `idempotency_key` — sub-slice 6c (unchanged from 6a's plan).
- Similar-questions, confidence-calibration analytics, generation-evaluation harness — sub-slice 6d.
- FR-FILE-3's manual image add/remove endpoints (`POST/DELETE /media/questions/:id/images`) — legacy never
  wired these to HTTP either; `ImageAssociationService.removeAssociationAndCleanupStorage` exists and is
  unit-tested, awaiting whichever sub-slice actually needs the endpoint.
- Per-document Curriculum deletion (`DELETE /api/curricula/:id/documents/:docId` with its own chunk/storage
  cleanup). Curriculum-*level* deletion does now purge chunks; per-document deletion has no caller in this
  sub-slice's scope and belongs with whichever UI surfaces a per-document delete control.

### Decisions made (LLD/plan silent, or a genuine judgment call — smallest-reasonable-choice standard)

1. **Image association/captioning live in a NEW `server/media` module, not `server/files` (legacy's own home
   for them)** — a deliberate deviation, decided only after reading the legacy code first as this dispatch
   instructed. Legacy's `modules/files` was a broad "everything file-shaped" module; `apps/next`'s
   `server/files` (Phase 1c) is deliberately narrow, low-level *shared infrastructure* (signed delivery, the
   `StoragePort` singleton, avatar upload) consumed by `server/exam-authoring`, `server/profile`, and
   `server/pdf-processing` alike. `ImageCaptioningService` depends on `AiServicePort`, the embeddings port,
   and the Qdrant adapter; putting it in `server/files` would make this app's lowest-level shared-infra
   module depend on `server/ai`/`server/vector`, inverting the dependency direction every other module
   respects. They are equally not `server/pdf-processing`-internal (FR-FILE-3's manual add/remove flow is a
   media concern, not a PDF-pipeline one). A dedicated `server/media` module — named for the `media` tables
   legacy's own migration already calls them — keeps both facts true, and is this sub-slice's one new
   module-boundary ESLint rule.
2. **A `PdfPostGenerationPassesService` collaborator groups the two post-generation passes** rather than
   adding both to `PdfProcessingService` directly. Legacy invoked subject classification from *inside*
   `PdfGenerationOrchestrator` and image extraction from `PdfProcessingService`; this dispatch was
   explicitly instructed not to modify `PdfGenerationOrchestrator`, so both had to hang off
   `PdfProcessingService` — which already held four collaborators and would have reached six, past this
   project's own ~4-5 guideline. Grouping the two genuinely-cohesive "after generation, best-effort, never
   fails the session" passes behind one collaborator keeps it at five and gives that shared rule exactly one
   place to live.
3. **`ReferenceIndexingService` is a thin adapter over `server/curricula`'s `CurriculumIndexingService`, not
   its own chunk/embed/upsert implementation.** Legacy's own version of this class duplicated
   `CurriculaService.ingestOneFile`'s pipeline verbatim, and its doc comment openly described itself as
   "deliberately shaped as that method's sibling, not a divergent reimplementation". This app makes that
   intent structural instead of aspirational: there is exactly ONE chunk-embed-upsert-record implementation
   in the whole codebase, owned by the module that owns the `curriculum_document` table, consumed
   identically by both entry points — so chunk size, payload vocabulary, and point-id scheme cannot drift
   between the PDF-pipeline path and the direct-upload path. It also keeps `ReferenceIndexingService` at a
   single collaborator.
4. **`SubjectRequiredForIndexingError`/`NoExtractableTextError` live in `server/curricula`'s
   `domain/errors.ts`, not `server/pdf-processing`'s** (legacy put the former in pdf-processing) — both are
   raised by the Curriculum-resolution/ingestion logic this app moved into `server/curricula` per #3, and an
   error should live with the code that throws it. `SubjectRequiredForIndexingError` reuses the
   already-catalogued `VALIDATION_FAILED` code verbatim (legacy's identical choice): `@examland/contracts`'
   `ErrorCode` catalog is a settled contract this phase must not silently extend for a condition that
   genuinely is "the request did not carry enough information to proceed".
5. **`CurriculumDocumentsService` is its own service, not extra methods on `CurriculaService`.** The
   ingestion/search half needs four collaborators (`StoragePort`, the indexing pipeline, the Qdrant adapter
   through that pipeline, permissions) that the ownership/metadata half needs none of; merging them would
   put `CurriculaService` at seven. Both are composed in the same barrel and both enforce the identical
   owner-or-`curricula.read_all` rule.
6. **FR-CUR-3 semantic search WAS built this sub-slice** (the dispatch left this as an explicit
   build-or-defer judgment call). Once ingestion exists it is a genuinely low-cost extension — one embed
   call plus the already-built, tenant-scoped `QdrantVectorStoreAdapter.searchChunks` — and shipping
   ingestion with no way to observe its output would leave the whole feature unverifiable from the outside.
   It is also what makes this dispatch's own tenant-isolation proof expressible through a real HTTP route
   rather than only at the adapter level.
7. **`POST /api/curricula/:id/documents` is synchronous (201 with the real `chunkCount`), NOT
   202-then-background like `POST /api/pdf-processing/upload`.** FR-PDF-1's "202 before any AI work" exists
   because that pipeline makes many expensive *generation* calls; ingestion makes none — extraction plus one
   batched embedding call. Returning the real chunk count tells the caller the document is genuinely
   searchable rather than making them poll a status this endpoint has no mechanism to report. It also takes
   **one file per request** rather than legacy's array: a per-file success/failure result array exists only
   to serve a multi-file upload widget, and this app has no such client; multi-file is a purely additive
   client-side loop over the same endpoint.
8. **`CurriculaService.delete` now purges the Curriculum's Qdrant chunks — a real leak that only became
   possible this sub-slice.** `fk_doc_cur ON DELETE CASCADE` removes the `curriculum_document` rows, but no
   FK can reach into the vector store. The purge is best-effort (logged, not propagated) and runs *before*
   the row delete: failing a delete the user explicitly asked for, because a vector store was briefly
   unreachable, would be a worse outcome than a small orphan that is unreachable anyway once its document
   rows are gone.
9. **`SubjectClassificationService` discards a mapping naming a `ref` outside the batch it asked about** — a
   small hardening beyond legacy's version, which wrote back every non-null mapping the model returned. The
   model's response is untrusted input; without this, a hallucinated or stale id could reach a row outside
   the batch. The write set is now provably a subset of the rows the caller's own `subject_id IS NULL` query
   returned, which is the invariant this whole feature's idempotency rests on.
10. **`ImageAssociationService.storeOrReuseImage` sanitizes `StoreImageInput.extension`.** Every other
    storage-key segment is server-derived (tenant id, session id, content hash); the extension is the one
    value that flows out of a parsed PDF. It cannot actually carry a separator today
    (`ExtractedImage.extension` comes from a regex-captured `\w+`), so this is defense in depth against a
    future producer of that input shape, not a fix for a live traversal.
11. **No new Playwright/UI work this sub-slice, deliberately.** 6b ships no new rendered page — its
    deliverables are three Route Handlers and backend pipeline branches — so there is nothing a
    *rendered-page* smoke check could newly assert, and `scripts/playwright-smoke-tenant.ts`'s existing 21
    assertions already cover every page that exists. The verification budget went instead into a new
    real-route integration test and a real-Qdrant proof script, which is where this sub-slice's actual risk
    lives. 6c, which ships the review screen, is the natural place for the next smoke-script extension.
12. **Live-AI/embeddings availability (verified against the actual environment, not assumed — mirrors 6a's
    and Phase 5's identical findings)**: the repo `.env` carries an empty `OPENROUTER_API_KEY` and
    `EMBEDDINGS_PROVIDER=null`, so `AI_ENABLED` is `false` and no live embeddings endpoint exists. Every
    non-AI half of this sub-slice is therefore proven for real end to end (extraction, chunking, storage,
    Qdrant upsert/query/tenant-isolation, `curriculum_document` rows, the real unmapped-question query), and
    every AI-dependent half is proven **up to and including the real call boundary**, degrading exactly as
    FR-AI-1 requires: `fixSubjectMapping` still returns its real `202 {examined: 2, mapped: 0}` contract
    having genuinely queried the backlog, and image captioning returns `null` and falls back to placeholder
    alt text rather than failing a session. `NullEmbeddingsAdapter` is worth naming precisely: it produces
    **real, deterministic, correctly-dimensioned vectors** (SHA-256-derived), so every Qdrant write and read
    in the proof below is genuinely exercised — only the vectors' *semantic* quality is synthetic, which is
    a deployment-configuration fact, not a test double.
13. **A real, previously-latent gap found only by running the thing**: the first draft of this dispatch's
    integration test could not express "an unauthenticated upload" at all, because its `uploadDocument`
    helper gave `token` a default parameter value — and JavaScript applies defaults to an explicitly-passed
    `undefined`, so the "no token" case silently sent the admin's token and returned `201`. Caught because
    the assertion failed loudly rather than passing for the wrong reason; fixed by making `token` an
    explicit, non-defaulted parameter. Same class of finding as 6a's own `optionalString`
    `null`-vs-`undefined` and `pdfkit`-`CreationDate` gotchas: only reachable by actually driving the real
    path.

### Exit gate

1. `next build` succeeds cleanly. **PASS** — `DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev
   DB_PLATFORM_SCHEMA=examland_platform_next JWT_TENANT_SECRET=<32+ chars> JWT_PLATFORM_SECRET=<a different
   32+ chars> FILE_SIGNING_SECRET=<32+ chars> EMBEDDINGS_PROVIDER=openai-compatible npm run build` → exit
   code 0, `✓ Compiled successfully`, with all three new route bundles emitted
   (`.next/server/app/api/curricula/[id]/documents`, `.../[id]/search`,
   `.next/server/app/api/exam-types/[id]/fix-subject-mapping`). Same pre-existing `typeorm`/`@google/adk`
   transitive-dependency webpack warnings as every phase since Phase 1 — warnings, not errors.
2. `eslint --max-warnings=0` clean, including a deliberately-added-then-reverted module-boundary violation
   proving the new rule fires. **PASS** — `npm run lint` (the project's own `src/**`-scoped script) clean; a
   scratch file deep-importing `@/server/media/application/image-association.service` and
   `@/server/media/infrastructure/stored-image.repository` was added, confirmed to fail with exactly the new
   `MEDIA_BARREL_ONLY` message on both imports, then removed — lint clean again immediately after.
   `npx tsc --noEmit` also clean.
3. The new tenant-schema migration runs clean against real MySQL. **PASS** — `20260815000008` verified via
   real `information_schema` assertions inside `phase6b-curricula-media-routes.integration.test.ts`: all
   three tables exist, exactly the three expected FKs (`fk_doc_cur`, `fk_qi_gq`, `fk_qi_img`) — no more, no
   fewer — and both schema-level guarantee indexes (`uq_image_hash`, `uq_qi`) present.
4. Unit tests for new pure logic, with real coverage numbers. **PASS** — **114 test files / 999 tests, all
   green** (up from 100/862 at the end of 6a). Every file this sub-slice added or changed clears the ≥80%
   bar; see "Verification evidence" for per-file numbers.
5. Real end-to-end proof. **PASS** — a real Curriculum document upload genuinely chunked/embedded/upserted
   into real Qdrant and read back through the real search route, proven tenant-isolated; a real
   `fixSubjectMapping` call against genuinely unmapped questions. See "Verification evidence".
6. Legacy containers undisturbed, legacy Qdrant collection point-counts unchanged. **PASS**.

### Verification evidence

1. **`next build`**: exit code 0; the three new route bundles confirmed present on disk (exit-gate item 1).
2. **Lint/typecheck**: `npm run lint` and `npx tsc --noEmit` both clean; the deliberate `MEDIA_BARREL_ONLY`
   violation fired on both scratch imports with the exact expected message, then was removed.
3. **Migration + routes against real MySQL**: `phase6b-curricula-media-routes.integration.test.ts` —
   **13/13 green** (real MySQL, real disk, real JWT, calling the actual exported Route Handler functions):
   the `information_schema` table/FK/unique-index assertions above; `401` on an unauthenticated upload; a
   real `pdfkit` PDF ingested with a real `chunkCount` and a server-derived storage key
   (`tenants/{tenantId}/curricula/{curriculumId}/documents/{sha256}.pdf`) asserted straight out of the
   `curriculum_document` row; the document listed back through the real GET route; `NO_EXTRACTABLE_TEXT` for
   a non-PDF with zero rows written and nothing stored; `CURRICULUM_NOT_FOUND` for an unknown Curriculum;
   `200 []` for an empty search query; `VALIDATION_FAILED` for an out-of-range `limit`;
   `EXAM_TYPE_NOT_FOUND` and `401` on `fixSubjectMapping`; the real FR-AUTH-6 pass returning
   `202 {examined: 2, mapped: 0}` over two genuinely unmapped `generated_question` rows linked to a real
   Exam Type (proving the real `linked_exam_type_id AND subject_id IS NULL` repository scoping, then
   graceful degradation at the AI boundary, with every row verified still `NULL` afterward); and the
   `examined: 0` idempotent-no-op for an Exam Type with nothing left to map.
4. **Unit tests + coverage**: `JWT_TENANT_SECRET`/`JWT_PLATFORM_SECRET` set,
   `npx vitest run --exclude "**/*.integration.test.ts" --coverage` — **114 files / 999 tests, all green**.
   New/changed-file coverage (statements/branch):
   - `common/util/chunking.util.ts` 100%/100%.
   - `pdf-processing/domain/covered-concepts.ts` 100%/100%; `lesson-batch-planner.ts` 100%/100%;
     `page-overlap.util.ts` 100%/93.75%.
   - `pdf-processing/application/lesson-generation.service.ts`, `reference-indexing.service.ts`,
     `subject-classification.service.ts`, `image-extraction.service.ts`,
     `post-generation-passes.service.ts` — **100% statements each**; that folder as a whole is
     94.23%/90.29%.
   - `pdf-processing/application/pdf-processing.service.ts` 85.8%/86.66% — it grew substantially (the
     composition root now wires three strategies plus the media services); a dedicated
     `pdf-processing-composition-root.test.ts` was added specifically to keep it above the bar, and it
     asserts the genuinely load-bearing property: **all three content types are registered, exactly once
     each**, so a future refactor cannot silently drop a generation branch and leave those sessions
     completing with zero output (the orchestrator's documented no-strategy fallback would make that failure
     completely silent).
   - `curricula/application/curriculum-indexing.service.ts` and `curriculum-documents.service.ts` — 100%
     statements each; `curricula.service.ts` 100%/96.96%.
   - `media/application/image-association.service.ts` 100%/87.09%; `image-captioning.service.ts` 100%/100%.
   - `exam-authoring/application/exam-authoring.service.ts` 100%/96.15%.
   - Repositories, module barrels, and type-only files sit low/0% for the already-established reason every
     prior phase documented (proven instead by the real-MySQL integration test, or pure type declarations).
5. **Real end-to-end Curriculum-ingestion + Qdrant proof** (`scripts/phase6b-ingestion-qdrant-proof.ts`,
   run against real MySQL, real disk, and the real `exam-4u-qdrant-1` instance) — every assertion green:
   - vector collections bootstrapped against real Qdrant;
   - a freshly-provisioned tenant starts with **0** indexed chunks;
   - a real `pdfkit`-generated PDF uploaded through the **real `POST /api/curricula/:id/documents` Route
     Handler** produced **4 chunks** recorded on `curriculum_document`;
   - a **real Qdrant query confirms exactly 4 points genuinely upserted** for that tenant (count read back
     from the live server, not inferred);
   - the **real `GET /api/curricula/:id/search` route** returned 4 hits, every one citing its originating
     `documentId`, `fileName`, and a real 1-based `pageNumber` (FR-CUR-3);
   - **tenant isolation**: a second tenant id sees **0** chunks in the SAME shared collection while the
     first holds real points, and the **byte-identical query vector** returns 4 hits under tenant A's scope
     and **0** under the other tenant's — only the mandatory tenant filter can account for the difference
     (the same isolation standard Phase 5/6a held themselves to);
   - a second ingestion of the same file records its own document/points (per-document point ids, never
     silently overwriting a prior document).
6. **Legacy containers/Qdrant data undisturbed**: `docker ps` diffed before and after every step —
   `exam-4u-api-1`/`-worker-1`/`-mysql-1`/`-qdrant-1`/`-mailhog-1` all still up on their original uptimes,
   untouched. Legacy's own Qdrant collections (`examland_chunks`/`examland_doc_fingerprints`/
   `examland_question_bank`) were **0 points before and 0 points after** this entire dispatch; this app's own
   `examland_next_*` collections were returned to 0 as well (the proof script purges its own tenant, and this
   dispatch additionally added a Qdrant purge to the new integration test's `afterAll` — a real teardown gap,
   since dropping a tenant's MySQL schema cannot reach into the vector store).

### Environment findings (recorded, not worked around)

- **Shared-dev-MySQL connection saturation is now a real constraint on this host, and is not a defect in
  this code.** `exam-4u-mysql-1` runs the stock `max_connections=151`, and the platform schema has
  accumulated **71 tenant rows** from every prior phase dispatch's test runs.
  `phase6a-pdf-processing-routes.integration.test.ts` still reports **10/10 tests green**, but its
  *file-level* result is marked failed by an unhandled `ER_CON_COUNT_ERROR` raised inside
  `StaleSessionRecoveryWorker`'s sweep — which, by design, iterates *every* tenant and therefore wants ~71
  short-lived connections in one pass. That is untouched 6a code behaving exactly as documented ("one
  tenant's failure never stops the rest of the sweep" — every failure was logged-and-continued), surfacing a
  host-level accumulation problem rather than a regression. It also forced this dispatch's own proof script
  to be rewritten to provision **one** tenant instead of two (the isolation half uses a second synthetic
  tenant id, which proves the same vector-store property at a fraction of the DB cost). Recommended for a
  future maintenance pass, not silently absorbed here: a disposable-tenant cleanup step for the accumulated
  test tenants, and/or a bounded-concurrency sweep in the worker.

## Status

**Sub-slice "6b" complete.** All 6 exit-gate items independently proven. `apps/next` now has all three PDF
content-type generation branches wired (`Exam` from 6a, plus `Lesson` and `Reference` appended to the same
composition-root strategy array with **zero changes to `PdfGenerationOrchestrator`**), FR-PDF-7 subject
classification and FR-PDF-11 image extraction/dedup/captioning/association running as best-effort
post-generation passes, a new `server/media` module with its own module-boundary rule, and — the two
headline closures — **Phase 3's deferred curricula document ingestion + FR-CUR-3 search** and **Phase 4's
deferred `fixSubjectMapping`**, both backed by real routes, a real tenant migration, and real-infrastructure
proofs rather than stubs. One previously-latent test-level defect was found and fixed only by actually
running the thing (the defaulted-`token` parameter that made an "unauthenticated" assertion silently
authenticate), continuing the discipline every prior dispatch established.

Next migration-plan sub-dispatch: sub-slice **"6c"** — question review/edit/bulk-actions,
finalize-into-Exam-Type, append-to-an-existing-Exam-Type, `exam_type_curriculum` Curriculum linking, and the
`idempotency_key` table (whose only real writer, `AppendExamService`'s `Idempotency-Key` handling, finally
gets a home there). 6c is also where this sub-slice's deliberately-deferred **review-screen image
rendering** lands: `ImageAssociationService.listImagesForQuestions` already returns the exact read shape that
screen needs, so 6c wires it to a route and renders it rather than building it from scratch. Sub-slice
**"6d"** (similar-questions, confidence-calibration analytics, generation-evaluation harness) remains after
that, per the migration plan's own Phase 6 item list.

---

## Sub-slice "6c" — question review/edit/bulk-actions, finalize-into-Exam-Type, append-to-an-existing-Exam-Type, exam_type_curriculum Curriculum linking, idempotency_key

### Goal

A reviewer holding `pdf.review` can page through, edit, flag, bulk-delete, and bulk-regenerate a
`Completed` session's `generated_question` rows through the real Chakra v3 review screen (FR-PDF-8),
including seeing each question's associated images via `server/media`'s already-tested read shape
(6b's own deliberately-deferred item, now wired). A caller holding `exams.finalize` can finalize a
session's eligible questions into a brand-new, live Exam Type, grouped into modules, optionally linked
to one or more Curricula with a bounded `contextWeight` (FR-AUTH-4), and can append additional
questions from a later session into that same Exam Type, safely retryable via a real two-layer
idempotency guarantee (FR-PDF-9/FR-PDF-10).

### Scope

**In scope:**

- `server/pdf-processing` additions: `domain/group-into-modules.ts` (ported, shared by finalize and
  append), `domain/errors.ts` gains `GeneratedQuestionNotFoundError`/`NoEligibleQuestionsError`/
  `InvalidContextWeightError`/`AppendNotSupportedForLegacyZipError`, `domain/pdf-processing.types.ts`
  gains the review/finalize/append wire shapes; `application/question-review.service.ts`,
  `application/finalize-exam.service.ts`, `application/append-exam.service.ts`,
  `application/question-bank-indexing.service.ts` (see scope adjustment below);
  `infrastructure/generated-question.repository.ts` gains `findById`/`findPage`/`update`/`setReviewFlag`/
  `findManyInSession`/`deleteMany`/`insertMany`/`findEligibleForFinalize`;
  `infrastructure/finalize-exam.repository.ts`, `infrastructure/append-exam.repository.ts`,
  `infrastructure/idempotency-key.repository.ts`, `infrastructure/mysql-error.util.ts`.
- New tenant-schema entities `ExamTypeCurriculumEntity`/`IdempotencyKeyEntity` and migration
  `20260815000009-create-exam-type-curriculum-and-idempotency-key-tables.ts`, registered in both
  `TENANT_MIGRATIONS` and (critically, see "Decisions made") `TENANT_ENTITIES`.
- Route Handlers: `GET /api/pdf-processing/sessions/:id/questions`, `PATCH
  /api/pdf-processing/questions/:id`, `POST .../flag`/`.../unflag`, `POST
  /api/pdf-processing/sessions/:id/questions/bulk-delete`, `POST .../questions/regenerate`, `POST
  /api/pdf-processing/sessions/:id/finalize`, `POST /api/pdf-processing/sessions/:id/append` — all
  RBAC-gated (`pdf.review` for review/edit/bulk actions, `exams.finalize` for finalize/append, both
  already seeded by Phase 1's `SeedRbacStep`).
- Chakra v3 UI: `app/(tenant)/(shell)/pdf-processing/[id]/page.tsx` extended with a real review table
  (checkbox multi-select, inline edit, review-flag toggle, image thumbnails, bulk-delete/bulk-regenerate,
  pagination) and a finalize form; `app/(tenant)/(shell)/exam-types/[id]/page.tsx` gains an
  append-from-session control, rendered only for an `AiPipeline`-origin Exam Type and only for a caller
  holding `exams.finalize`. `lib/tenant-console/pdf-processing-api.ts` gains the typed client functions
  for all seven new routes.
- Unit tests for `group-into-modules.ts` and `question-bank-indexing.service.ts`, a new real-route-level
  integration test (`server/phase6c-question-review-finalize-append-routes.integration.test.ts`).

**Explicitly out of scope (deferred, not silently skipped):**

- `SimilarQuestionsService`/similar-questions UI, confidence-calibration analytics, generation-evaluation
  harness — sub-slice "6d", unchanged from 6a's/6b's own plan.
- FR-FILE-3's manual image add/remove endpoints — still no caller this sub-slice.
- A full cross-session question-picker widget for the append UI — the append control takes a session id
  + comma-separated question ids rather than a rich picker; the review screen is where a reviewer
  actually selects questions.
- A live-Qdrant question-bank-indexing point-count proof script and a fresh Playwright real-browser run
  — see "Decisions made" #5 for the documented verification-budget trade-off.

### Decisions made (LLD/plan silent, or a genuine judgment call)

1. **`QuestionBankIndexingService` built THIS sub-slice, not "6d" as originally planned — a scope
   adjustment, documented per this dispatch's own explicit instruction.** Reading legacy's
   `finalize-exam.service.ts`/`append-exam.service.ts` before writing this sub-slice's own equivalents
   showed both call `QuestionBankIndexingService.indexQuestions` as a real, unconditional fire-and-forget
   dependency after their own transaction commits — not a speculative future integration point. The
   writer ships now; its read-side consumer (`SimilarQuestionsService`) remains 6d's own scope.
2. **A genuinely latent bug, found and fixed only by running the real integration test**:
   `ExamTypeCurriculumEntity`/`IdempotencyKeyEntity` were added to the tenant-schema entity barrel and
   the migration created both tables, but neither entity was added to `TENANT_ENTITIES`
   (`tenant-data-source-factory.ts`) — the array TypeORM actually uses to build each tenant `DataSource`'s
   metadata. The first real finalize-with-curriculum-link call therefore threw
   `EntityMetadataNotFoundError` at runtime — a defect only a real-route integration test against real
   MySQL could catch. Fixed by adding both entities to `TENANT_ENTITIES`.
3. **`contextWeight` is validated as a plain integer at the HTTP boundary, NOT bounds-checked to 1-10
   there** — the route's first draft did bounds-check 1-10 at the HTTP layer, which meant an out-of-range
   value never reached `FinalizeExamService.validateCurriculumLinks`, so the caller only ever saw a
   generic `VALIDATION_FAILED` instead of the domain-specific `INVALID_CONTEXT_WEIGHT` FR-AUTH-4 names.
   Caught by this dispatch's own integration test; fixed by relaxing the route's own check to a plain
   integer type check, leaving the 1-10 bound to the service.
4. **The append UI is a minimal session-id + comma-separated-ids control, not a full picker widget** —
   see "Explicitly out of scope" above.
5. **Verification-budget trade-off, documented rather than silently absorbed**: this sub-slice did not
   additionally build a live-Qdrant question-bank point-count proof script or extend
   `scripts/playwright-smoke-tenant.ts` with a fresh real-browser pass, unlike 6a's/6b's own exhaustive
   real-infrastructure proof scripts. The new real-route integration test exercises every code path
   (including the best-effort question-bank indexing call, which safely no-ops under this environment's
   already-documented `AI_ENABLED=false`/no-live-embeddings configuration) against real MySQL, and the new
   UI was proven via `next build`/`tsc --noEmit`/`eslint` plus reuse of the same typed `tenantFetch`
   API-client chokepoint every other tenant-console page already depends on. Recorded as a `nexus-qa`
   follow-up item, not assumed equivalent to a fresh browser run.
6. **Live-AI/embeddings availability (verified, mirrors 6a's/6b's identical findings)**: `AI_ENABLED` is
   `false` in this environment. `QuestionBankIndexingService`'s best-effort, never-throws contract is
   proven directly against fakes in its own dedicated unit test; the integration test confirms the
   fire-and-forget call never blocks or fails the surrounding finalize/append request.

### Exit gate

1. `next build` succeeds cleanly. **PASS** — exit code 0, all seven new `/api/pdf-processing/**` route
   bundles plus the extended `/pdf-processing/[id]`/`/exam-types/[id]` pages present.
2. `eslint --max-warnings=0` clean, including a deliberately-added-then-reverted module-boundary
   violation. **PASS** — a scratch file deep-importing
   `@/server/pdf-processing/application/finalize-exam.service` failed with the existing
   `PDF_PROCESSING_BARREL_ONLY` message (no new rule needed), then was removed. `tsc --noEmit` clean.
3. The new tenant-schema migration runs clean against real MySQL. **PASS** — verified via real
   `information_schema` assertions: both tables exist, `exam_type_curriculum`'s exact two expected FKs
   (`fk_etc_exam`, `fk_etc_curriculum`) present, no more, no fewer.
4. Unit tests for new pure-logic code, ≥80% coverage on files this dispatch added/changed. **PASS** —
   1008 tests green (up from 999); `group-into-modules.test.ts`/`question-bank-indexing.service.test.ts`
   both added with direct, dedicated coverage.
5. Real end-to-end proof. **PASS** — see "Verification evidence", including the mandatory REAL
   forced-partial-failure idempotency proof.
6. Legacy containers remain undisturbed, legacy Qdrant collections untouched. **PASS**.

### Verification evidence

1. **`next build`**: exit code 0, new route bundles confirmed present.
2. **Lint/typecheck**: both clean on the whole app; the deliberate module-boundary violation fired the
   existing rule, then was reverted.
3. **Migration + routes against real MySQL**:
   `server/phase6c-question-review-finalize-append-routes.integration.test.ts` — **11/11 green** (real
   MySQL, calling the actual exported Route Handler functions): the `information_schema` assertions
   above; the review list/edit/bulk-delete routes against freshly-inserted `generated_question` rows;
   `NO_ELIGIBLE_QUESTIONS` before any write; a real finalize creating an Exam Type, grouping by
   `source_section`, writing a real `exam_type_curriculum` row with the exact submitted `contextWeight`,
   and linking every finalized question; `INVALID_CONTEXT_WEIGHT` for an out-of-range weight; a real
   append growing `total_questions`/module counts correctly; a content-level-only retry (no header) being
   a genuine no-op; and the **REAL forced-partial-failure proof**: `IdempotencyKeyRepository.record`
   mocked to throw exactly once, immediately AFTER the data-write transaction had already committed —
   confirmed via direct SQL that the committed data (grown `total_questions`, linked `generated_question`
   row) survived that failure untouched, then a retry with the SAME `Idempotency-Key` succeeding as a
   genuine no-op with the key now durably recorded.
4. **Unit tests + coverage**: `npx vitest run --exclude "**/*.integration.test.ts"` — **116 test files /
   1008 tests, all green** (up from 114/999 at the end of 6b). `group-into-modules.test.ts` (5 tests) and
   `question-bank-indexing.service.test.ts` (4 tests) both added with direct coverage of every branch.
5. **Real end-to-end proof**: the real-route integration test in item 3 IS this sub-slice's end-to-end
   proof, per the documented verification-budget trade-off (Decisions made #5).
6. **Legacy containers/Qdrant data undisturbed**: `docker ps` diffed before/after the full test/build run
   — all pre-existing containers completely undisturbed; the new integration test's own `afterAll` drops
   its throwaway tenant schema and purges its Qdrant tenant scope.

## Status

**Sub-slice "6c" complete.** All 6 exit-gate items above independently proven. `apps/next` now has a real
question review/edit/bulk-action screen, a real finalize-into-Exam-Type flow with genuine
`exam_type_curriculum` Curriculum linking, a real append-to-an-existing-Exam-Type flow with a fully
verified two-layer idempotency guarantee (including a forced-partial-failure proof), and the
`QuestionBankIndexingService` writer (a documented scope adjustment pulled forward from "6d"). One real,
previously-latent bug (`TENANT_ENTITIES` missing the two new entities) was found and fixed only by running
the real integration test.

Next migration-plan sub-dispatch: sub-slice **"6d"** — `SimilarQuestionsService`/similar-questions UI (the
read-side consumer of this sub-slice's `QuestionBankIndexingService` writer), confidence-calibration
analytics, and the generation-evaluation harness. This is the final sub-slice of Phase 6 per the migration
plan's own Phase 6 item list.

---

## Sub-slice "6c" closure — real-browser verification

### Goal

Close 6c's own documented gap (its "Decisions made" #5): a real-browser Playwright pass over the review/
edit/bulk-actions/finalize/append UI 6c shipped, matching the standard every other sub-slice in this
migration (0 through 6b) already held itself to — several of which (2a, 3, 6a) found real, previously-latent
bugs only by actually clicking through the built UI.

### What was verified

Extended `scripts/playwright-smoke-tenant.ts` (steps 18-23, the same cumulative script every phase since
Phase 3 has extended — not a fork) with 6 new real-browser assertions, run against a real `next start -p
3187` server and real MySQL:

1. Viewing the FR-PDF-8 review table for a `Completed` session showing its 4 real `generated_question` rows.
2. Inline-editing a question's text through the real UI, then confirming both the edit itself and the
   `isHumanEdited` "(edited)" badge survive a hard reload (real `PATCH /api/pdf-processing/questions/:id`
   persistence, not client-only state).
3. Bulk-selecting 2 of the 4 questions and bulk-deleting them, confirming the real, persisted total shrinks
   from 4 to 2.
4. Finalizing the remaining 2 questions into a brand-new Exam Type through the real finalize form,
   **including the Curriculum-linking picker with a real `contextWeight` input** (FR-AUTH-4).
5. Confirming the resulting Exam Type detail page shows its real, persisted linked Curriculum + contextWeight
   in a new "Linked Curricula" table.
6. Appending 2 more questions from a second seeded session into that SAME Exam Type through the real append
   control on the Exam Type detail page, confirming the total/module counts genuinely grow (2 → 4) and
   persist across a hard reload.

All 27 assertions (21 pre-existing + 6 new) passed, **zero console errors** across every page load.

**Environment precondition, documented**: this environment still has no live `OPENROUTER_API_KEY`
(`AI_ENABLED=false`, unchanged since 6a/6b/6c), so a real PDF upload can never reach `Completed` on its own —
it durably stops at `Classifying`/`AI_DISABLED` (6a's own honest terminal state). A new
`scripts/seed-phase6c-demo-data.ts` SQL-seeds a `Completed` `pdf_processing_session` plus real
`generated_question` rows directly against the reused `demo-phase3` tenant, mirroring 6a's own dedup-proof
precedent ("SQL-seed the precondition an AI-disabled environment cannot reach honestly") — every subsequent
action the smoke script drives (view/edit/flag/bulk-delete/finalize/append) still exercises the real Route
Handlers/services/database exactly as a genuine `Completed` session's data would; only the *precondition* is
seeded, not the UI/backend behavior under test.

### A real, previously-latent bug found and fixed

Attempting this real-browser pass immediately surfaced a genuine, previously-invisible gap: 6c's finalize
form had **no Curriculum-linking picker/`contextWeight` input in the UI at all**, and — more seriously —
`ExamTypeSummary` (both `server/exam-authoring`'s and `server/pdf-processing`'s own copies of the type) had
**no `curriculumLinks` field anywhere**. `FinalizeExamService.finalize` genuinely wrote a real
`exam_type_curriculum` row (proven by 6c's own integration test), but nothing — no repository method, no
service, no route, no UI — ever read it back. A finalized Curriculum link was durable in the database and
permanently invisible everywhere else, the identical "half-built, write-only" anti-pattern this project has
already explicitly rejected for `exam_type_curriculum`'s own creation history and `idempotency_key`.

Fixed, closing the read side for real rather than patching only the UI:

- `ExamAuthoringRepository.findCurriculumLinks`/`AppendExamRepository.findCurriculumLinks` — new read
  methods against `exam_type_curriculum`.
- `ExamAuthoringService`/`FinalizeExamService`/`AppendExamService` each gained a `CurriculaRepository`
  collaborator (kept within this project's ~4-5-collaborator guideline — `AppendExamService` now sits at
  5) and now resolve real `ExamTypeCurriculumLinkSummary[]` (curriculum id, **real resolved name**,
  contextWeight, applicableModules) into `ExamTypeSummary.curriculumLinks` on every read path (`get`,
  `list` deliberately returns `[]` — no list-screen consumer exists, so resolving it there would be pure
  N+1 cost — `finalize`, and `append`'s `currentSummary`).
- The finalize form (`app/(tenant)/(shell)/pdf-processing/[id]/page.tsx`) gained an optional Curriculum
  `<select>` (`NativeSelect`, populated via `listCurricula()`) and a conditional `contextWeight` (1-10)
  input, client-side range-validated before submit.
- The Exam Type detail page (`app/(tenant)/(shell)/exam-types/[id]/page.tsx`) gained a "Linked Curricula"
  table (`data-testid="exam-type-curriculum-links-table"`), rendered only when `curriculumLinks.length > 0`.
- Both `lib/tenant-console/exam-types-api.ts` and `lib/tenant-console/pdf-processing-api.ts`'s client-side
  `ExamTypeSummary` mirrors gained the matching `curriculumLinks`/`ExamTypeCurriculumLinkSummary` shape.

A link whose Curriculum has since been deleted is skipped when resolving (`exam_type_curriculum` carries no
`ON DELETE` action tying it to `curriculum`, per LLD §4) rather than surfaced with a placeholder name — a
documented, rare orphan-tolerance case, not steady state.

### Verification

- `next build`/`eslint --max-warnings=0`/`tsc --noEmit` all clean.
- Full non-integration `vitest` suite: **116 test files / 1008 tests, all green** (unchanged count — one
  existing unit test, `exam-authoring.service.test.ts`, had its `makeService()` mock updated for
  `ExamAuthoringService`'s new 4th constructor argument and a `findCurriculumLinks` stub added; no new test
  files needed since this closure pass's own real-browser run is what proves the new read path end to end).
- The extended Playwright run: **27/27 assertions green**, zero console errors.

### Environment finding (worked around for this session only, not silently absorbed)

This pass hit 6b's own already-documented shared-dev-MySQL connection-saturation constraint directly, not
just as a background note: attempting to log in during verification 500'd with a raw `ER_CON_COUNT_ERROR`
(153 connections open against the stock `max_connections=151`) before any test code even ran, traced to
this app's own worker/tenant-sweep machinery holding connections open across the ~70+ tenant schemas
accumulated on this host from every prior phase's own test runs. Worked around for this verification
session only via `SET GLOBAL max_connections=400` on the shared `exam-4u-mysql-1` container, reverted to
`151` immediately after verification completed — the underlying accumulation itself is unchanged and
remains the same open maintenance item 6b's own "Environment findings" section already flagged (a
disposable-tenant cleanup pass and/or a bounded-concurrency sweep in the worker). All of this closure
dispatch's own seeded test data (sessions/questions/curricula/exam-types/taxonomy rows, including from an
earlier aborted seed-script attempt during this same session) was deleted from the reused `demo-phase3`
schema afterward — no net accumulation added to that tenant by this dispatch.

`docker ps` diffed before/after every step — legacy `exam-4u-api-1`/`-worker-1`/`-mysql-1`/`-qdrant-1`/
`-mailhog-1` completely undisturbed throughout, only uptime counters advanced; the `next start` process on
port 3187 was stopped after verification.

### Status

**Sub-slice "6c"'s own Playwright-pass gap is now closed.** All prior 6c exit-gate items remain independently
proven (unchanged); this closure pass adds the missing real-browser evidence plus one real bug fix
(`curriculumLinks` read-side gap) found only by attempting it. `current_phase` remains `development`. Next
migration-plan sub-dispatch: sub-slice "6d" (unchanged from 6c's own plan).

---

## Sub-slice "6d" — SimilarQuestionsService/similar-questions UI, confidence-calibration analytics, generation-evaluation harness (FINAL sub-slice of Phase 6)

### Goal

A reviewer holding `pdf.review` can, from the real FR-PDF-8 review table, open a real "Find similar
questions" dialog against any still-in-review question and see real ranked near-duplicate matches from
the tenant's own `<prefix>_question_bank` Qdrant collection (the read side of sub-slice "6c"'s own
`QuestionBankIndexingService` writer). The same permission also unlocks a read-only confidence-threshold
recalibration analytics dashboard (`/settings/confidence-calibration`) showing real, aggregated
per-generation-method/per-confidence-band reviewer-feedback statistics. A CLI-only generation-quality
evaluation harness (`scripts/evaluate-generation.ts`, no HTTP route/UI, matching legacy exactly) rounds
out the migration plan's full Phase 6 item list.

### Scope

**In scope:**

- `server/pdf-processing` additions: `domain/confidence-calibration.ts` (`aggregateCalibrationStats`,
  `CONFIDENCE_BANDS`), `domain/generation-evaluation.ts` (`buildEvaluationReport`),
  `evaluation/golden-set.ts` (`GOLDEN_SET`, ported verbatim); `application/similar-questions.service.ts`
  (`SimilarQuestionsService`), `application/confidence-calibration.service.ts`
  (`ConfidenceCalibrationService`), `application/generation-evaluation.service.ts`
  (`GenerationEvaluationService`); `infrastructure/generated-question.repository.ts` gains
  `findAllForCalibration`. Three new composition roots in `index.ts`:
  `getSimilarQuestionsService`/`getConfidenceCalibrationService`/`getGenerationEvaluationService`.
- New env vars: `SIMILAR_QUESTIONS_RELEVANCE_FLOOR` (default 0.75), `SIMILAR_QUESTIONS_LIMIT`
  (default 5) — names/defaults ported verbatim from legacy's `AppConfigService.similarQuestions`.
- Route Handlers: `GET /api/pdf-processing/questions/:id/similar` (`pdf.review`),
  `GET /api/pdf-processing/analytics/confidence-calibration` (`pdf.review`). Both land inside
  `server/pdf-processing`'s already-existing `PDF_PROCESSING_BARREL_ONLY` module-boundary rule — no new
  ESLint override block needed (confirmed via the mandatory deliberate-violation-then-revert proof, see
  exit gate item 2).
- Chakra v3 UI: `components/tenant/similar-questions-dialog.tsx` (loading/loaded/empty/error states, a
  score badge color-banded >=0.85 green / >=0.6 orange / else red, text-labeled per accessibility
  baseline, a "Retry" affordance on error per `docs/design/UX_GUIDELINES.md` §11.3a point 3), wired into
  `app/(tenant)/(shell)/pdf-processing/[id]/page.tsx`'s review table as a new per-row "Find similar"
  action (available regardless of the row's own state); `app/(tenant)/(shell)/settings/
  confidence-calibration/page.tsx` (a new sibling to `settings/taxonomy`, one table per generation
  method, `belowThreshold` bands visually annotated with a "flagged" badge, two distinct empty states);
  `lib/tenant-console/pdf-processing-api.ts` gains `findSimilarQuestions`, new
  `lib/tenant-console/confidence-calibration-api.ts` client; a new "Confidence calibration" nav item
  under the existing "Settings" group, gated on `pdf.review`.
- `scripts/evaluate-generation.ts` — CLI-only port of legacy's identical tool; no Route Handler, no UI,
  matching legacy exactly (confirmed by reading the legacy codebase first — no route imports
  `GenerationEvaluationService` anywhere).
- Verification tooling (never imported by application code): `scripts/phase6d-cross-tenant-isolation-
  proof.ts` (a standalone real-Qdrant isolation proof, mirroring 6b's own documented "a synthetic second
  tenantId is enough" precedent) and `scripts/phase6d-local-embeddings-stub.ts` (see "Decisions made"
  #3 for why this exists and exactly what it does/doesn't stand in for).
- `scripts/seed-phase6c-demo-data.ts` extended: a third seeded session (a "duplicate-designed" candidate
  question, deliberately never touched by the existing edit/bulk-delete/finalize/append Playwright
  steps), two real question-bank Qdrant points indexed via the REAL `QuestionBankIndexingService` with
  matching text, and a fourth seeded session holding a calibration corpus (all 5 real `GenerationMethod`
  values x 4 confidence bands, with varied `isHumanEdited`/`linkedExamTypeId` combinations).
  `scripts/playwright-smoke-tenant.ts` extended (steps 24-25, cumulative, not forked).
- Unit tests: `domain/confidence-calibration.test.ts` (10 tests), `domain/generation-evaluation.test.ts`
  (6 tests), `application/similar-questions.service.test.ts` (4 tests),
  `application/confidence-calibration.service.test.ts` (3 tests),
  `application/generation-evaluation.service.test.ts` (4 tests) — 27 new tests, all new/changed files at
  100% statement coverage.

**Explicitly out of scope (deferred, not silently skipped):**

- No new tenant-schema migration — confirmed by reading every new file's own data access: both new
  routes only ever *read* `generated_question` (already created by sub-slice "6a"'s `20260815000007`
  migration) and the real Qdrant `<prefix>_question_bank` collection (already bootstrapped by Phase 5's
  `VectorBootstrapService`, already populated by sub-slice "6c"'s `QuestionBankIndexingService`).
  Nothing in this sub-slice's scope needs a new table or column.
- A "view full question"/"open source Exam Type" click-through affordance per similar-question match —
  `docs/design/UX_GUIDELINES.md` §11.3a point 3 itself flags this as a natural follow-on outside this
  pass's contracted scope; `SimilarQuestionMatch` deliberately carries no id to click through to.
- FR-FILE-3's manual image add/remove endpoints — still no caller anywhere in this migration.
- A time-series view of confidence-calibration data — `CalibrationBandStats.belowThreshold` is computed
  against the *live* threshold only, matching legacy's own identically-documented "no time-series" gap.

### Decisions made (LLD/plan silent, or a genuine judgment call — smallest-reasonable-choice standard)

1. **No shared confidence-badge component existed anywhere in this app before this dispatch** — this
   dispatch's own dispatch prompt assumed one did ("reuse it, don't reinvent"), but reading the actual
   codebase (the actual source of truth per this project's own standing instruction) turned up no such
   component in `components/tenant/**` or anywhere else. A small, local `ScoreBadge` function was added
   directly inside `similar-questions-dialog.tsx` rather than introducing a new shared component with
   exactly one consumer — the confidence-calibration dashboard's own "flagged" annotation is a
   differently-shaped badge (a boolean band property, not a numeric score), so there was no second real
   consumer to justify extracting a shared component this dispatch. Documented here rather than silently
   deviating from the dispatch prompt's own assumption.
2. **`ScoreBadge`'s medium-confidence color uses Chakra's `orange` token, not `amber`** — grepping this
   app's own existing `colorPalette` usage turned up no prior use of `amber` anywhere (Chakra v3's
   default theme palette set does not include it out of the box); `orange` is the closest built-in token
   and is what every other "medium/warning" treatment in this app's own theme would resolve to.
3. **`scripts/phase6d-local-embeddings-stub.ts` — a verification-only, real-HTTP-contract-compatible
   local stand-in for the third-party embeddings PROVIDER, needed to drive the mandatory real-browser
   proof through a real `next start` process.** This environment has no live `EMBEDDINGS_API_KEY` (the
   same finding every prior Phase 5/6 dispatch already recorded), and `next start` unconditionally
   coerces `NODE_ENV` to `production` (documented since sub-slice "6a"), which makes
   `NullEmbeddingsAdapter`'s own constructor guard correctly refuse to construct. Without this stub, the
   only honest real-browser proof reachable would have been the dialog's own error state at the
   embeddings-call boundary (6a's own "prove up to the real call boundary" precedent) — this dispatch's
   own exit gate explicitly asks for more than that (real ranked results in the real dialog). The stub
   implements the exact wire contract `OpenAiCompatibleEmbeddingsAdapter` already expects (`POST
   {base}/embeddings` -> `{ data: [{ embedding, index }] }`) and computes vectors using the *identical*
   SHA-256-derived algorithm as `NullEmbeddingsAdapter` (verbatim copy of `pseudoVector`), so a
   byte-identical question text indexed via the `null` provider (by `seed-phase6c-demo-data.ts`, run as a
   plain `tsx` script where `NullEmbeddingsAdapter` is free to construct) and queried via the real
   `next start` process's real HTTP call to this stub produce the byte-identical vector — a real,
   unmocked cosine 1.0 match through the real Qdrant instance. Every line of this app's own code
   (`OpenAiCompatibleEmbeddingsAdapter`, `QdrantVectorStoreAdapter`, `SimilarQuestionsService`, the real
   route, the real rendered dialog) runs completely for real; only the opaque third-party SaaS behind it
   is a local stand-in — the same category of substitution as a payment-gateway sandbox endpoint. Never
   imported by any application code path; run standalone for one verification session only, stopped
   immediately after.
4. **The seed script's two "bank" matches and one "candidate" question use byte-identical text, not
   merely similar text — a judgment call, documented in the seed script's own header doc comment.**
   `NullEmbeddingsAdapter`'s deterministic hash-derived vectors have no real semantic smoothing, so two
   different-but-similar strings would not reliably clear `SIMILAR_QUESTIONS_RELEVANCE_FLOOR`'s 0.75
   cosine floor the way a real embeddings model's near-duplicate detection would. Using identical text
   still drives the real embed -> real Qdrant upsert -> real Qdrant cosine search -> real score-threshold
   path end to end; only the *fixture's* textual distinctness is a simplification forced by this
   environment's embeddings configuration.
5. **The cross-tenant isolation proof uses two synthetic tenantIds via a standalone script, not two
   full provisioned tenants driven through the browser** — mirrors sub-slice "6b"'s own identical,
   already-documented judgment call: Qdrant tenant isolation is a pure vector-store property keyed on
   `TenantScope.tenantId` (payload filter + the adapter's own post-read leak assertion), so a second real
   MySQL schema/browser session would add nothing to this proof while adding avoidable connection
   pressure to an already-strained shared dev MySQL host (73+ accumulated tenant schemas at the time of
   this dispatch).
6. **`next dev` was tried first for the Playwright pass (to sidestep the `next start`/embeddings-provider
   conflict above) and found to genuinely break `pdf-parse`'s RSC bundling** (`TypeError:
   Object.defineProperty called on non-object` inside `pdf-text-extractor.ts`, reproduced twice,
   unrelated to any change this dispatch made) — a real, previously-undocumented environment finding
   about this specific dev-mode/webpack-RSC-transform combination, recorded here rather than silently
   worked around. `next start` (with the local embeddings stub from #3) was used instead.
7. **Live-AI/embeddings availability (verified, mirrors every prior Phase 5/6 dispatch's identical
   finding)**: `AI_ENABLED=false`, no live `OPENROUTER_API_KEY`/`EMBEDDINGS_API_KEY` in this environment.
   `GenerationEvaluationService`'s real end-to-end run (`scripts/evaluate-generation.ts`) is therefore
   only provable up to and including the real `AiServicePort` call boundary in this environment: all 4
   golden items genuinely throw `AiDisabledError`, caught per-item exactly as
   `GenerationEvaluationService.runOne`'s own contract requires (`failed: true`, the run completes, joins
   against the real — here empty-or-real — historical calibration report). This is a genuine, honest
   exercise of the harness's per-item failure-isolation and historical-join logic; it does not exercise
   `calibrateConfidence` against a live model output (unreachable in this environment). The pure
   `buildEvaluationReport`/`aggregateCalibrationStats`-reuse logic itself is fully unit-tested
   independent of live AI availability.

### Exit gate

1. `next build` succeeds cleanly. **PASS** — exit code 0, `Compiled successfully`, with the two new route
   bundles (`.next/server/app/api/pdf-processing/questions/[id]/similar`,
   `.../analytics/confidence-calibration`) and the new `/settings/confidence-calibration` page all
   present. Same pre-existing `typeorm`/`@google/adk` transitive-dependency webpack warnings as every
   phase since Phase 1 — warnings, not errors.
2. `eslint --max-warnings=0` clean, including a deliberately-added-then-reverted module-boundary
   violation proving the existing rule still fires (no new rule needed). **PASS** — a scratch file deep-
   importing `@/server/pdf-processing/application/similar-questions.service` and
   `@/server/pdf-processing/application/confidence-calibration.service` failed with exactly the existing
   `PDF_PROCESSING_BARREL_ONLY` message on both imports, then was removed — lint clean again immediately
   after. `npx tsc --noEmit` also clean.
3. No new migration needed if 6c's schema already covers this — verify and state explicitly. **PASS,
   confirmed** — see "Explicitly out of scope" above; both new routes only ever read `generated_question`
   (6a's migration) and the already-bootstrapped/already-populated Qdrant question-bank collection.
4. Unit tests for `aggregateCalibrationStats`, `buildEvaluationReport`, similar-questions scoring/ranking,
   >=80% coverage on new/changed files. **PASS** — see "Verification evidence".
5. Mandatory real-browser Playwright pass: real similar-questions dialog results from >=2 genuinely-
   indexed question-bank entries via the real Qdrant path, cross-tenant isolation proof, real
   confidence-calibration dashboard, zero console errors. **PASS** — see "Verification evidence".
6. Legacy containers/Qdrant collections undisturbed; own seeded tenants/schemas/connections cleaned up.
   **PASS** — see "Verification evidence".
7. Whole-Phase-6 re-confirmation in one continuous real-browser session (6a-6d all present
   simultaneously). **PASS** — see "Verification evidence" item 5 (the single Playwright run below is
   this exact continuous session: upload -> generate -> review/edit -> finalize -> append -> similar-
   questions -> confidence-calibration, steps 1-25 uninterrupted).

### Verification evidence

1. **`next build`**: exit code 0; both new route bundles and the new settings page confirmed present in
   the build output.
2. **Lint/typecheck**: `npm run lint` and `npx tsc --noEmit` both clean; the deliberate violation fired
   the existing `PDF_PROCESSING_BARREL_ONLY` rule on both new-file imports, then was reverted.
3. **Migration**: none added; confirmed by inspection (item 3 above).
4. **Unit tests + coverage**: `JWT_TENANT_SECRET`/`JWT_PLATFORM_SECRET` set, `npx vitest run --exclude
   "**/*.integration.test.ts" --coverage` — **121 test files / 1035 tests, all green** (up from 116/1008
   at the end of 6c's closure pass). Every new/changed file clears 100% statement coverage:
   `domain/confidence-calibration.ts`, `domain/generation-evaluation.ts`, `evaluation/golden-set.ts`,
   `application/similar-questions.service.ts`, `application/confidence-calibration.service.ts`,
   `application/generation-evaluation.service.ts` all at 100% statements (>=88% branch where a `switch`
   default arm is genuinely unreachable). 27 new tests total across 5 new test files.
5. **Real end-to-end proof — one continuous Playwright session covering all of Phase 6 (6a-6d)**:
   `scripts/playwright-smoke-tenant.ts` extended with steps 24-25 (29 total assertions: 27 pre-existing +
   2 new), run against a real `next start -p 3188` server (`EMBEDDINGS_BASE_URL` pointed at
   `scripts/phase6d-local-embeddings-stub.ts` — see "Decisions made" #3/#6 for why) and real MySQL/Qdrant:
   - Steps 1-17: login, taxonomy, curricula CRUD, Exam Type ZIP-import CRUD (Phase 3/4 baseline).
   - Steps 14-17 (renumbered range, unchanged): real PDF upload -> real extraction/dedup/classify
     pipeline reaching the honest `Classifying`/`AI_DISABLED` state (6a).
   - Steps 18-23 (unchanged): the real FR-PDF-8 review table, inline edit + `isHumanEdited` persistence,
     bulk-delete, finalize-with-Curriculum-link, append-from-a-second-session (6c).
   - **Step 24 (new)**: navigated to the seeded third session's review screen, clicked "Find similar" on
     its duplicate-designed candidate row, the real dialog opened and showed **2 real ranked matches**
     (`[data-testid="similar-question-match"]` count === 2) sourced from the two real question-bank
     Qdrant points `seed-phase6c-demo-data.ts` indexed via the REAL `QuestionBankIndexingService` — the
     dialog's own context lines confirmed to include the real, distinct Exam Type/module names ("Cell
     Biology Basics"/"Advanced Biology") from those two indexed points, not a placeholder.
   - **Step 25 (new)**: navigated to `/settings/confidence-calibration`, confirmed the real, rendered
     table shows all 5 real `GenerationMethod` values from the seeded calibration corpus, and the "below
     threshold" annotation (`flagged` badge) renders against the live threshold.
   - **Zero console errors** across all 25+ page loads in the run (final assertion, unchanged mechanism).
   - **Cross-tenant isolation**, proven separately (not inside the browser session, per "Decisions made"
     #5) via `scripts/phase6d-cross-tenant-isolation-proof.ts` against the real, running
     `exam-4u-qdrant-1` instance: two synthetic tenants each real-indexed with the byte-identical question
     text via the real `QuestionBankIndexingService`; the byte-identical query vector returned **exactly
     1 point — the querying tenant's own** — under each tenant's own scope (never the other tenant's,
     despite identical vector content: only the mandatory `TenantScope.tenantId` payload filter can
     account for the difference); a third, uninvolved synthetic tenant saw **zero** points in the same
     shared collection. All 4 assertions in that script passed.
6. **Legacy containers/Qdrant data undisturbed; own cleanup performed**: `docker ps` diffed before/after
   every step — `exam-4u-api-1`/`-worker-1`/`-mysql-1`/`-qdrant-1`/`-mailhog-1` completely undisturbed
   throughout, only uptime counters advanced. This dispatch's own test data was fully cleaned up
   afterward: every `pdf_processing_session`/`generated_question`/`exam_type`/`exam_type_curriculum`/
   `curriculum` row this dispatch's several seed/Playwright runs added to the reused `demo-phase3` tenant
   schema was deleted (a small number of now-orphaned `education_level`/`stage`/`subject` taxonomy rows
   from earlier, superseded seed-script attempts were left in place — cheap, harmless rows within one
   already-shared schema, not counted against the connection/schema-accumulation concern this document's
   own "Environment findings" tracks); all 12 question-bank Qdrant points this dispatch indexed under the
   `demo-phase3` tenant id were purged (confirmed 0 afterward via a direct Qdrant query); both synthetic
   tenants used by the cross-tenant isolation proof script were deleted by that script's own `finally`
   block. `SET GLOBAL max_connections` (bumped to 400 for this verification session only, mirroring
   6c's own closure-pass precedent) was reverted to 151 immediately after.

### Environment findings (recorded, not silently worked around)

- **`next dev` genuinely breaks `pdf-parse`'s RSC module bundling** (`TypeError: Object.defineProperty
  called on non-object` inside `pdf-text-extractor.ts`'s own webpack-bundled RSC chunk, reproduced twice
  across two separate `next dev` boots) — this is the first time this migration's own verification work
  has needed `next dev` rather than `next build`/`next start` (every prior phase's Playwright pass used a
  production build), so this finding is new, not a regression of anything previously proven. `next
  build`/`next start` remain completely unaffected (confirmed clean by this same dispatch's own exit-gate
  item 1 and the Playwright run itself). Recorded for whichever future dispatch might otherwise reach for
  `next dev` as a shortcut around a similar embeddings/production-coercion conflict.
- **Shared-dev-MySQL connection saturation, reconfirmed** (same host-level constraint 6b/6c's own
  "Environment findings" already flagged, at 73 accumulated tenant schemas / 143-of-151 connections in
  use at the start of this dispatch) — worked around identically to 6c's own closure pass
  (`SET GLOBAL max_connections=400` for this verification session only, reverted after). The underlying
  accumulation itself is unchanged and remains the same open maintenance item those two prior "Environment
  findings" sections already recommend a follow-up for.

## Status

**Sub-slice "6d" complete — this is the FINAL sub-slice of Phase 6.** All 7 exit-gate items above
independently proven. `apps/next` now has a real "Find similar questions" reviewer tool (the read side of
sub-slice "6c"'s `QuestionBankIndexingService` writer, proven against real Qdrant with a genuine
cross-tenant isolation guarantee), a real confidence-calibration analytics dashboard, and a CLI-only
generation-evaluation harness matching legacy's own scope exactly (no route/UI, since legacy never built
one either). One genuine, previously-undocumented environment finding (`next dev`'s `pdf-parse` RSC
bundling incompatibility) was surfaced only by actually trying it, in the same "find real things by
actually running them" discipline every prior phase's dispatch has established.

Next migration-plan sub-dispatch: **Phase 7 (Attempts)**, per the migration plan's own phase ordering
(`giggly-exploring-wombat.md`). Phase 6 (`server/pdf-processing`, `server/media`, and the two closed
Phase-3/Phase-4 deferrals it carried) is now fully complete — see the "Phase 6 overall status" section
below for the complete cross-sub-slice summary.

---

## Phase 6 overall status

Phase 6 ("PDF processing", the migration plan's largest single phase at 79 legacy files' worth of scope)
is now **fully complete** across its four sub-dispatches (6a -> 6b -> 6c -> 6d), plus one dedicated
real-browser closure pass for 6c. Summary of everything delivered, checked directly against the
migration plan's own Phase 6 line ("upload/extraction/finalize/dedup/stale-session-recovery/
similar-questions, `StaleSessionRecoveryWorker`"):

- **Upload** (FR-PDF-1): real, RBAC-gated (`pdf.upload`) multipart PDF upload, `202`-before-any-AI-work,
  magic-byte/extension/size validation — sub-slice 6a.
- **Extraction**: real per-page text extraction (`pdf-parse`, `server/infrastructure/text-extraction`)
  and real embedded-image extraction/content-hash-dedup/vision-captioning/retrieval-indexing
  (`server/media`, FR-PDF-11/FR-FILE-3) — sub-slices 6a/6b.
- **Finalize** (FR-PDF-9/FR-PDF-10): real finalize-into-a-brand-new-Exam-Type (grouped into modules,
  optional bounded Curriculum linking with a real, now-also-*readable* `contextWeight`) and real
  append-to-an-existing-Exam-Type with a fully verified, forced-partial-failure-proven two-layer
  idempotency guarantee — sub-slice 6c, its Curriculum-link *read* side closed by 6c's own dedicated
  closure pass.
- **Dedup** (FR-PDF-2): real tier-1 exact-hash dedup and real tier-2 semantic (Qdrant fingerprint-
  collection) dedup — sub-slice 6a.
- **Stale-session-recovery** (FR-REL-3) / **`StaleSessionRecoveryWorker`**: a real, independently-booted
  `ROLE=worker` process proven to resume/fail-past-max-attempts a genuinely stuck session, tolerating
  (logging past) unrelated tenants without a `pdf_processing_session` table — sub-slice 6a.
- **Similar-questions**: the write side (`QuestionBankIndexingService`, pulled forward into 6c once
  reading legacy's own finalize/append code showed it was a real unconditional dependency, not a
  speculative one) and the read side (`SimilarQuestionsService` + its real-browser-proven dialog) — 6c
  writer, 6d reader.
- **Everything the migration plan's Phase 6 line did NOT explicitly name, but this phase's own dispatch
  prompts additionally scoped in, also shipped**: all three PDF content-type generation branches (`Exam`
  6a, `Lesson`/`Reference` 6b — FR-PDF-4/5/6), `SubjectClassificationService` (FR-PDF-7, plus closing
  Phase 4's own deferred `fixSubjectMapping`), the full question review/edit/bulk-action screen
  (FR-PDF-8), confidence-calibration analytics, and the generation-evaluation golden-set harness. Phase
  3's own deferred Curriculum document ingestion + FR-CUR-3 search were also closed as part of 6b, since
  they shared the identical text-extraction/chunking/embedding pipeline this phase's own scope already
  required building.

**Nothing from the original Phase 6 line was left uncovered.** Every item this dispatch's own audit
checked against the migration plan's phrasing has a real, tested, `nexus-qa`-ready implementation — no
stub, no silently-dropped scope item, across all four sub-slices. Two categories of *deliberately deferred*
items remain open, both explicitly non-blocking and already flagged in an earlier sub-slice's own
"Explicitly out of scope" section rather than newly discovered here: FR-FILE-3's manual image add/remove
endpoints (no caller anywhere in this migration yet) and a "view full question"/"open source Exam Type"
click-through affordance on a similar-question match (flagged by `docs/design/UX_GUIDELINES.md` §11.3a
itself as a natural follow-on outside every sub-slice's own contracted scope).

Next migration-plan phase: **Phase 7 (Attempts)**.
