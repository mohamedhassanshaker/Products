# QA Report -- Dev-15a (BL-12: Curriculum ownership and document ingestion, backend)

Date: 2026-08-10
Scope: Dev-15a only (FR-CUR-1, FR-CUR-1a, FR-CUR-2). Dev-15b and later out of scope (not implemented).

## Environment
- Backend: apps/api, real NestJS app booted via Test.createTestingModule/NestFactory in e2e suites.
- MySQL: existing examland-mysql Docker container, 127.0.0.1:3306 (root / YourPassword).
- Qdrant: existing examland-qdrant Docker container, http://localhost:6333.
- Ran the project's own test suites (unit test:cov, e2e test:e2e --runInBand) plus root npm run lint
  and apps/api's npm run typecheck, directly against the above live services -- no test doubles for
  MySQL/Qdrant.
- Note: the repo's default e2e DB env assumptions (DB_PASSWORD='') did not match this container's real
  root password; re-ran with DB_PASSWORD=YourPassword explicitly set. Not a Dev-15a defect -- an
  environment-connection detail unrelated to the phase's code, and once corrected the suite ran clean.

## Independent verification performed

1. Ownership enforcement (headline requirement). Read CurriculaService directly:
   assertOwnerOrOversight (GET/PATCH/DELETE /curricula/:id) checks owner-or-curricula.read_all;
   assertOwner (document upload/delete) is owner-only, no oversight bypass -- matching HLD Section 5.2's
   exact text ("Only the owner or a Tenant Admin acting in an oversight capacity can modify or delete a
   Curriculum") and LLD Section 7.7's per-route table. Independently re-ran the real-HTTP e2e suite
   (test/curricula-ingestion.e2e-spec.ts) which: creates a Curriculum as Member A, gets 403
   NOT_CURRICULUM_OWNER reading/patching/deleting it as Member B; confirms the Tenant Admin (holder of
   curricula.read_all) CAN read/patch/delete it (full modify access, not read-only -- correctly matching
   FR-CUR-1's oversight wording, not merely a hypothetical read-only interpretation); confirms oversight
   deliberately does NOT extend to document upload/delete (403 for the admin there too, per LLD Section
   7.7's narrower owner-only row for those two routes) while the actual owner still can. Also confirmed
   RBAC seed (seed-rbac.step.ts) grants curricula.manage_own to both Member/Tenant Admin roles and
   curricula.read_all only to Tenant Admin. All passed.

2. Cost-control gate (headline exit-gate requirement). Read CurriculaService.ingestOneFile: the
   NO_EXTRACTABLE_TEXT check runs strictly before StoragePort.put, EmbeddingsPort.embed, and
   VectorStorePort.upsertChunks -- textually unreachable otherwise. Confirmed the actual proof exists as
   a real spy/call-count assertion, not just a final-response check: curricula.service.spec.ts's
   "COST-CONTROL EXIT GATE" test and its siblings (all-whitespace PDF, empty file, invalid
   extension/signature, oversized file, corrupt/unparsable PDF) each assert
   expect(embeddings.embed).not.toHaveBeenCalled() (plus storage.put/vectorStore.upsertChunks/
   repository.insertDocument also not called) via Jest mocks -- this is a genuine call-count proof on
   the EmbeddingsPort, not an inference from the HTTP response. Additionally the real-Qdrant e2e test
   independently confirms zero points land in Qdrant and no curriculum_document row is created for a
   blank-text PDF over the real HTTP endpoint. Re-ran both suites myself: all pass.

3. Real Qdrant write + tenant/curriculum/document tagging, and chokepoint compliance. Read
   QdrantVectorStoreAdapter (the sole file permitted to import @qdrant/js-client-rest, confirmed via
   grep that no other production file in apps/api/src imports it) and confirmed every method routes
   through buildFilter, which unconditionally prepends the tenantId "must" clause, plus a defense-in-
   depth assertNoLeak post-filter on every read. CurriculaService only calls vectorStore.upsertChunks
   /deleteChunks via the injected VECTOR_STORE_PORT token -- no raw client usage anywhere in the
   curricula module; the only other Qdrant-adapter dependency it takes is QdrantVectorStoreAdapter
   itself, used solely for the tenant-namespaced pointId() helper (never for a raw read/write), exactly
   as its own doc comment states. Re-ran test/curricula-ingestion.e2e-spec.ts's real-Qdrant assertions
   myself: uploads two real (pdfkit-generated) PDFs, then queries Qdrant directly via
   vectorAdapter.scrollChunks (not through the app's own HTTP API) and confirms every returned point's
   payload carries the correct tenantId/curriculumId/documentId/pageNumber/chunkIndex; confirms
   the failed empty file produced zero points; confirms document/curriculum delete removes exactly the
   right vectors. Because scrollChunks itself is scoped by the tenant-scoped adapter and mandatorily
   filters on tenantId, this also constitutes the "not retrievable via a raw unscoped query for a
   different tenant" proof required -- there is no unscoped query path exposed by the port at all
   (buildFilter cannot be bypassed from outside the adapter file). All passed.

4. Multi-file upload isolation. Read and re-ran the e2e case uploading [good.pdf, empty.pdf (bad),
   good.pdf] in one multipart request: response is 200 with a 3-element per-file results array -- file 1
   status 'ok', file 2 status 'failed' code 'EMPTY_FILE', file 3 status 'ok' -- and confirmed via
   real Qdrant scroll queries that both good files' chunks landed correctly while the bad file produced
   none. Passed. Also confirmed via unit tests that a Qdrant-write failure on one file cleans up only that
   file's own storage prefix, never touching a sibling file's already-successful artifacts.

5. Chunking quality. Read chunking.util.ts directly (not just its tests): chunkPages tags every
   chunk with its originating page number and never merges chunks across a page boundary; splitIntoChunks
   implements genuine overlap (nextStart = cut - overlapChars, guarded against a degenerate
   overlapChars >= chunkSizeChars config) and a real context-preserving cut-point heuristic
   (paragraph-break to sentence-end to hard cut, constrained to the back half of the window via
   MIN_CUT_FRACTION) -- not naive fixed-size splitting with no overlap. This is a pure, framework-free
   function exercised directly by unit tests.

6. Tenant-migration-runner regression fix. Read test/tenant-migration-runner.e2e-spec.ts directly:
   all 5 occurrences of the hardcoded pending/applied-migration list now correctly include
   'CreateCurriculumTables1730000000005' alongside the two pre-existing migrations. Re-ran this e2e
   suite myself (as part of the full e2e run below) -- all assertions pass, confirming the regression is
   genuinely fixed, not just edited to look plausible.

7. Full suite re-run (my own, independent).
   - npm run test:cov -w apps/api: 134 suites / 1102 tests, all passed -- matches self-report exactly.
   - npm run test:e2e -- --runInBand (against the live MySQL 8.4/Qdrant instances, with corrected
     DB_PASSWORD): 28 suites / 273 tests, all passed -- matches self-report exactly, including
     test/curricula-ingestion.e2e-spec.ts and test/tenant-migration-runner.e2e-spec.ts.
   - Root npm run lint (--max-warnings=0): clean.
   - apps/api's npm run typecheck: clean.
   - Confirmed no stray schemas/collections left behind by this phase's own e2e suite after teardown
     (examland_e2e_cur_* collections and curings-*/examland_platform_e2e_cur_* schemas all absent
     post-run); unrelated debris from other, older e2e suites was found in the shared Qdrant/MySQL
     instances but predates this session and is not this phase's responsibility.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-CUR-1 (Curriculum ownership, create/scope to Subject) | create, 404 SUBJECT_NOT_FOUND | Pass | curricula-ingestion.e2e-spec.ts "subject validation and basic CRUD" |
| FR-CUR-1a (403 NOT_CURRICULUM_OWNER, non-owner Member) | GET/PATCH/DELETE by non-owner Member | Pass | e2e "ownership boundary" describe block |
| FR-CUR-1a / HLD Section 5.2 (Tenant Admin oversight) | GET/PATCH/DELETE by Tenant Admin on a Member's curriculum; oversight does NOT extend to document routes | Pass | same describe block |
| FR-CUR-2 (multi-doc upload, per-file isolation) | 1 bad (empty) + 2 good files in one request | Pass | e2e "multi-file upload, per-file isolation" |
| FR-CUR-2 (chunking: overlap, page tagging) | direct read of chunking.util.ts; unit tests | Pass | chunking.util.ts, its own unit suite |
| FR-CUR-2 (NO_EXTRACTABLE_TEXT pre-embedding-cost rejection) | blank PDF, whitespace-only PDF, corrupt PDF | Pass (spy-verified) | curricula.service.spec.ts COST-CONTROL EXIT GATE tests + real-Qdrant e2e zero-points proof |
| Exit gate: chunks tagged with tenantId/curriculumId/documentId in examland_chunks | real Qdrant scrollChunks query after upload | Pass | e2e real-Qdrant assertions |
| Tenant isolation chokepoint (Dev-13 adapter genuinely used) | code read: sole-importer grep, DI wiring, buildFilter tenant must clause | Pass | qdrant.adapter.ts, curricula.service.ts |
| Regression: tenant-migration-runner.e2e-spec.ts | full re-run | Pass | e2e run, 28/273 |
| Full unit+e2e count reproduction | full re-run | Pass, exact match | 134/1102 unit, 28/273 e2e |

No untested in-scope requirement identified; FR-CUR-8 (cascade delete) is a Dev-15a-adjacent behavior in the plan text and was also independently verified end-to-end (document delete and whole-curriculum delete both remove Qdrant vectors, storage, and DB rows) even though not explicitly named in the exit gate.

## Defects found

None. No blocking or non-blocking defects identified in this pass.

(The DB_PASSWORD environment mismatch noted above is a test-runner environment detail on my end, not a
code or configuration defect introduced by Dev-15a -- the project's own e2e suites already correctly read
DB_PASSWORD from the environment.)

## Verdict

PASS -- Dev-15a is QA-green, no blocking defects. The two headline exit-gate requirements both
genuinely hold: the cost-control gate is proven by direct spy/call-count assertions on EmbeddingsPort
(not just an HTTP response check), and the real Qdrant write path is exclusively routed through Dev-13's
tenant-scoped VectorStorePort/QdrantVectorStoreAdapter chokepoint (no raw client usage elsewhere,
confirmed by import-boundary grep and code reading), with independently-verified correct
tenantId/curriculumId/documentId tagging via a direct Qdrant scroll query.
