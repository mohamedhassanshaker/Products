# QA Report -- Dev-15b (BL-12: Semantic search + Curriculum UI)

Date: 2026-08-10
Scope: Dev-15b only (semantic search endpoint + Curriculum management UI). Does not
re-evaluate Dev-15a's backend ingestion logic beyond what Dev-15b's search feature builds on.
This closes out BL-12 (Dev-15a + Dev-15b) -- BLOCKED by the finding below.

## Environment

- Live MySQL 8.4 (examland-mysql docker container, 127.0.0.1:3306) and live Qdrant
  (examland-qdrant, 127.0.0.1:6333) -- the project's standing containers, already running.
- Backend built from source (npm run build:api) and run as the real compiled dist/main.js
  + dist/worker.js (not ts-node, not the Nest testing module) on port 3900, dedicated QA
  schemas (examland_platform_qa_dev15b, tenant schema t_qadev15b_c1a82cf7),
  EMBEDDINGS_PROVIDER=null (NullEmbeddingsAdapter -- the only embeddings provider available in
  this environment; no OpenAI API key or local-tei instance was available -- see Finding 3 below),
  AI_ENGINE=disabled.
- Frontend: real ng build production bundle, served statically by the API exactly as the
  single-image deployment does (apps/api/public populated from apps/web/dist/web/browser,
  replicating docker/Dockerfile's own copy step) -- not ng serve, not a component-test harness.
- Real Chromium via Playwright (already a repo dependency) drove the actual browser.
- Test tenant qadev15b, tenant admin (curriculum owner) tenantadmin@qadev15b.test, a second
  Member user memberb@qadev15b.test (assigned the Member role, which does carry
  curricula.manage_own) for the ownership-boundary check.
- Two real PDFs built with pdfkit (matching this codebase's own e2e fixture technique) with
  genuinely distinct extractable text: photosynthesis.pdf (photosynthesis/biology content) and
  volcanoes.pdf (volcanology/geology content), uploaded to a "Biology Basics" curriculum via the
  real HTTP API and confirmed chunked (2 pages / 2 chunks each).
- All test data (platform + tenant DB schemas, Qdrant points scoped to the test tenant) removed
  after the run; no data left in shared fixtures.

## Verdict: NOT READY -- one blocking defect.

The core deliverable of this phase -- a user can search a Curriculum through the real UI and see
ranked excerpts -- does not work at all in a real browser. Every prior verification (135/1118
backend unit, 28/277 backend e2e, 40/225 frontend unit, all independently re-run and confirmed
green) passed, and the backend search endpoint itself is correct and spec-compliant end to end via
direct HTTP. The defect is isolated to the frontend search form wiring.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-CUR-3 (search returns ranked excerpts w/ doc+page) - backend | Real HTTP GET /curricula/:id/search?q=... after real PDF ingestion | PASS | See "Backend verification" below |
| FR-CUR-3 - empty query returns 200 items:[], not an error | HTTP GET .../search (no q) and ?q= | PASS | Both returned items:[] |
| FR-CUR-3 - real-browser search-and-see-results (the phase's actual deliverable) | Login, curriculum detail, type real query, submit via Enter and via button | FAIL - BLOCKING | screenshots/03-04; see Finding 1 |
| UX 10.3c - Initial/no-query state (quiet placeholder, not error-styled) | Loaded curriculum detail before any search | PASS | screenshots/02-search-initial-state.png |
| UX 10.3c - No-results state distinct from Initial | Could not be exercised - submit is non-functional (Finding 1) | UNTESTED (blocked) | -- |
| UX 10.3c - Clearing query returns to Initial, no leaked network call | Could not be meaningfully exercised beyond client-side clear (submit itself never reaches the network layer) | PARTIAL | -- |
| Ownership: non-owner gets 403 NOT_CURRICULUM_OWNER, even on empty query, before the empty-query short-circuit | Real HTTP: Member B (not curriculum owner, has curricula.manage_own) called search with empty query and with a real query | PASS | See "Ownership verification" below |
| GET vs POST judgment call (plan says POST, LLD says GET) | Read docs/architecture/LLD.md 7.7 directly | Confirmed genuine wording drift, not a scope regression | LLD 7.7 row: GET /curricula/:id/search?q=&limit= - implementation matches LLD exactly |
| Search ranking is genuinely relevance-based | Queried two PDFs, one clearly on-topic, one off-topic, via real HTTP after real ingestion | INCONCLUSIVE / non-blocking gap - see Finding 3 | Raw scores show a photosynthesis-relevant chunk ranked last, below both irrelevant volcano chunks, for a photosynthesis query |
| Backend unit suite | Re-ran independently | PASS - 135 suites / 1118 tests | matches nexus-dev's self-report exactly |
| Backend e2e suite (real MySQL + Qdrant) | Re-ran independently, --runInBand | PASS - 28 suites / 277 tests | matches self-report exactly |
| Frontend unit suite | Re-ran independently (ng test --watch=false, vitest) | PASS - 40 files / 225 tests | matches self-report exactly |
| Static checks | typecheck, lint, build across all 3 workspaces | PASS, clean | pre-existing apps/web initial-bundle budget warning only, unrelated to this phase |

## Findings

### Finding 1 - BLOCKING: the search form never calls the API in a real browser; both Enter and the "Search" button trigger a full native page reload instead

Expected (FR-CUR-3; UX_GUIDELINES 10.3c step 2): "The user types a query and submits (Enter
key, or an explicit 'Search' button ... both work identically)" -- this should call
CurriculaService.search() and render ranked results.

Actual: On the real, compiled, browser-rendered curriculum detail screen (/curricula/:id),
typing a query into the search field and either (a) pressing Enter, or (b) clicking the "Search"
button, causes a full native browser page reload -- the app's entire JS/CSS bundle re-downloads,
/api/auth/me, /api/tenant/public-config, and /api/curricula/:id are re-fetched from scratch, the
URL becomes .../curricula/{id}? (empty query string, from a native, unnamed-field HTML form GET
submission) -- and no request to /curricula/:id/search is ever issued. The typed query is lost;
the screen returns to the "Initial" placeholder state as if nothing had been typed. This was
reproduced identically via the Enter key and via an explicit button[type=submit] click, and
confirmed with full request/response and console logging (zero requests to any search endpoint,
zero console/page errors -- the failure is silent).

Root cause (identified from source, for the developer's benefit -- not required of QA, but the
evidence is unambiguous): curriculum-detail.component.html's search form is a bare
form element with an (ngSubmit) binding and no [formGroup] -- a template-driven-style form
relying on Angular's NgForm directive (from FormsModule) to intercept the native submit event
and call preventDefault(). But curriculum-detail.component.ts's standalone imports array
(DatePipe, RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, MatDialogModule,
MatFormFieldModule, MatInputModule, MatTooltipModule) does NOT include FormsModule or
ReactiveFormsModule -- so no directive on this component's form ever intercepts submit, and the
browser falls back to native HTML form submission (a GET to the current URL). This is the exact
class of defect this project's own established "jsdom-only-defect" precedent (cited in
docs/NEXUS_STATE.md's Dev-7 entry) warns about: a TestBed-based component/httpMock test typically
calls component.onSearchSubmit() directly, or triggers Angular's synthetic submit event via
DebugElement.triggerEventHandler, both of which bypass the browser's native form-submission
semantics entirely -- so nexus-dev's 40/225 frontend suite (which does pass, confirmed
independently above) never exercised this path. For comparison, the sibling
curriculum-create.component.ts does this correctly (ReactiveFormsModule + [formGroup]), which is
why curriculum creation itself is unaffected.

Repro steps:
1. Log in as a Curriculum owner; navigate to a curriculum's detail page with at least one
   uploaded, chunked document.
2. Scroll to "Search this Curriculum"; type any non-empty query into the search field.
3. Press Enter (or click "Search").
4. Observe: the whole page reloads (visible flash/re-render, URL gains a trailing ?), the typed
   query is gone, and the search results region shows the Initial placeholder as if never
   searched. No network request to /curricula/:id/search occurs (verified via full
   request/response/console capture).

Evidence: qa-results/dev-15b/screenshots/01-curriculum-detail-with-2-docs.png,
02-search-initial-state.png, 03-search-query-typed-before-submit.png (query visibly typed),
04-search-after-submit-BROKEN-full-reload.png (back to Initial state, query lost).

Severity: Blocking. This is the phase's core deliverable (FR-CUR-3, Dev-15b's own exit gate:
"e2e: create curriculum, upload doc, search, see ranked excerpts with page numbers"). A real
user cannot search a Curriculum through the shipped UI at all.

### Finding 2 - Non-blocking / environment note: Member self-registration does not auto-assign a role, so a bare self-registered user cannot exercise curricula.manage_own at all

While setting up the ownership-boundary test, a freshly self-registered user
(POST /api/auth/register) had no RBAC role assigned (defaultSelfRegisterRole was null for this
tenant, matching this tenant's own creation response) and so got a generic
"FORBIDDEN - Missing required permission(s): curricula.manage_own" rather than reaching the
ownership check at all. This is plausibly correct/expected tenant-configuration behavior (not
every tenant auto-assigns a role to self-registered users), not a Dev-15b defect -- but it means
the genuine non-owner-with-permission path (403 NOT_CURRICULUM_OWNER) had to be constructed by
manually assigning the Member role in the DB before it could be exercised at all. Once done, the
check behaved exactly as specified (see "Ownership verification" below). Flagging only so the
orchestrator is aware this isn't itself an untested gap -- it was worked around and verified --
not a code defect in Dev-15b's scope.

### Finding 3 - Non-blocking / scope-wide gap: "ranked by relevance" has never actually been proven with a real embeddings provider, in either nexus-dev's own e2e suite or this independent pass

This environment has no reachable OpenAI-compatible embeddings endpoint or local-tei instance --
EMBEDDINGS_PROVIDER=null (NullEmbeddingsAdapter, explicitly documented in-source as
"deterministic, hash-based pseudo-vectors ... not a real embedding -- only useful for exercising
storage/retrieval plumbing, never for real semantic search quality") is the only usable binding.
This is also true of nexus-dev's own backend e2e suite (curricula-ingestion.e2e-spec.ts uses an
identical SHA-256-hash "fake embeddings" function for the same reason, by its own doc comment).

Querying the two real PDFs above with a query clearly on-topic for photosynthesis.pdf
("How do plants convert sunlight into energy?") returned all four chunks ranked by score as
expected mechanically (Qdrant always returns results sorted by score, regardless of embedding
quality) -- but the top-ranked chunk was a photosynthesis chunk and the lowest-ranked chunk was
also a photosynthesis chunk, below both unrelated volcano chunks:

  1. photosynthesis.pdf (relevant)   score  0.1097
  2. volcanoes.pdf      (irrelevant) score -0.1068
  3. volcanoes.pdf      (irrelevant) score -0.1564
  4. photosynthesis.pdf (relevant)   score -0.2607   <- relevant content ranked last

This demonstrates the sort-by-score plumbing works correctly, but the actual relevance is
essentially random -- an unavoidable consequence of the hash-based pseudo-embeddings, not a code
defect in the ranking/sorting logic itself. Neither this QA pass nor nexus-dev's own e2e suite
has ever exercised genuine semantic relevance ranking with a real embeddings model. This is a
pre-existing, project-wide environment limitation (no credentialed embeddings provider available
to either agent), not new to Dev-15b, and is non-blocking for this phase's own gate -- but the
orchestrator/user should be aware that "ranked excerpts" has only ever been proven as
"sorted by whatever score is returned," never as "sorted by genuine topical relevance," anywhere
in this project's test history to date.

## Backend verification (all via real HTTP against the real compiled server)

- GET /curricula/:id/search (no q) returns 200 with items:[]. GET .../search?q= returns the same.
  Confirmed against a curriculum with 2 real ingested/chunked PDFs (i.e., not merely "no chunks
  exist yet").
- GET .../search?q=How do plants convert sunlight into energy? (owner) returns 200, 4 ranked
  items, each with documentId, fileName, pageNumber, chunkIndex, text, score -- shape matches
  LLD 7.7 and FR-CUR-3 exactly.
- Route/verb: implementation is GET /curricula/:id/search?q=&limit=, exactly matching
  docs/architecture/LLD.md 7.7's row. The plan doc's "POST" wording is confirmed a documentation
  drift, not a scope or architecture deviation -- no further action needed on this point.

## Ownership verification (real HTTP, Member role with curricula.manage_own but not curriculum owner)

- GET /curricula/:id/search (empty query) as non-owner Member returns 403 NOT_CURRICULUM_OWNER
  ("You do not own this curriculum.") -- not a leaking 200 with items:[].
- GET /curricula/:id/search?q=volcanoes as non-owner Member returns the same
  403 NOT_CURRICULUM_OWNER.
- Confirms the ownership check genuinely runs before the empty-query short-circuit, exactly as
  nexus-dev's completion notes described, independently verified rather than trusted.

## Re-run test suite numbers (all independently executed against live MySQL 8.4 + live Qdrant)

| Suite | Reported by nexus-dev | Independently re-run | Match |
|---|---|---|---|
| Backend unit (test:cov -w apps/api) | 135 suites / 1118 tests | 135 suites / 1118 tests | Yes |
| Backend e2e (test:e2e -w apps/api --runInBand) | 28 suites / 277 tests | 28 suites / 277 tests | Yes |
| Frontend unit (ng test --watch=false, vitest) | 40 suites / 225 tests | 40 files / 225 tests | Yes |
| typecheck / lint / build (all 3 workspaces) | Clean | Clean | Yes |

## Overall verdict

NOT READY. One blocking defect (Finding 1): the Curriculum search UI is completely
non-functional in a real browser -- neither Enter nor the "Search" button ever calls the search
API; both cause a full native page reload that silently discards the typed query. This is
precisely the class of jsdom/httpMock-invisible defect this project's QA process exists to catch,
and it blocks Dev-15b's own exit gate and FR-CUR-3. Everything else -- the backend search
endpoint, ownership enforcement, empty-query semantics, the GET/POST judgment call, and all three
independently re-run test suites -- is correct and matches nexus-dev's self-report. Recommend
dispatching nexus-dev for a narrowly-scoped fix: add FormsModule (or convert the search form to
ReactiveFormsModule + [formGroup], consistent with curriculum-create) to
curriculum-detail.component.ts's imports array so the existing (ngSubmit) binding is actually
wired up, then re-verify with a real-browser pass before the next nexus-qa dispatch -- component/
jsdom tests are not sufficient evidence for this specific fix given how the original defect went
undetected.
