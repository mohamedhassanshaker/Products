# QA Report - Dev-32 (BL-31: Multi-document synthesis for Lesson Practice)

Date: 2026-08-12
Scope: Dev-32 only (Dev-33+ do not exist yet; Dev-30/Dev-31 already QA-green and out of scope for re-audit here).

## Environment

- API: NestJS app under apps/api, run in-process via @nestjs/testing (real HTTP via supertest), against:
  - Real MySQL 8.4 (examland-mysql container, 127.0.0.1:3306)
  - Real Qdrant (examland-qdrant container, 127.0.0.1:6333)
- AiServicePort/EmbeddingsPort swapped for deterministic fakes at the DI level (same pattern the existing e2e suite uses) - no network calls to a real AI provider.
- No production environment touched.

## What was independently verified (not just re-reading nexus-dev self-report)

1. Full unit suite re-run: 179 suites / 1553 tests, all green - exact match to nexus-dev reported numbers. Zero regressions observed.
2. Existing lesson-practice.e2e-spec.ts re-run against live MySQL and Qdrant: 8/8 green, including the headline multi-document-synthesis proof, CURRICULUM_NOT_FOUND, and Curriculum-wide EMPTY_QUESTION_BANK.
3. Independent scratch e2e suite (written and run by QA, not authored by nexus-dev; deleted after the run per test hygiene) exercising 5 additional scenarios beyond nexus-dev own tests:
   - QA1 - 3-document synthesis: seeded a fresh Curriculum with 3 documents (not nexus-dev's 2), one packaged/finalized question each with deliberately distinct embeddings. Requested count=3 Curriculum-scoped. Result, traced via each generated_question.id -> pdf_processing_session -> curriculum_document (never trusting the response payload): all 3 of 3 selected bank questions came from 3 distinct documents. Confirms synthesis is genuine, not a first/largest-document fallback.
   - QA2 - precedence: sent both documentId and curriculumId in one request (documents seeded under the same Curriculum, each with its own distinctly-named packaged question). Result: exactly 1 question returned, matching only the named documentId question; persisted practice_session.kind = LessonDocument and curriculum_document_id equal to the sent documentId. curriculumId was silently ignored, precedence confirmed - not an error, not curriculumId winning.
   - QA3 - neither scope sent: subject-wide fallback path still resolves normally (200, status completed) - mutual-exclusivity handling for the "neither" case is sane, matches existing LessonSubject behavior, no new error path introduced.
   - QA4 - cross-tenant curriculumId: provisioned a genuinely separate tenant (own schema) with its own Curriculum, then requested Lesson Practice as tenant #1 using tenant #2 curriculumId (with tenant #1 own valid subjectId/stageId). Result: 404 CURRICULUM_NOT_FOUND - confirmed rejected, not silently ignored or leaking cross-tenant data. Mechanism: each tenant lives in its own MySQL schema/connection, so the id is structurally unresolvable.
   - QA5 - same-tenant, different-owner curriculumId: seeded a Curriculum owned by a different (non-acting) owner_user_id within the same tenant as the acting admin, then requested Lesson Practice as the acting admin using that Curriculum id. Result: 200, request succeeded - see Defect D1 below.
4. Diversity-selection code read (diversity-selection.ts): selectDiverse is a pure, document-agnostic farthest-point / near-duplicate-suppression algorithm operating purely in embedding space - it has no notion of "document" at all, so a scenario where one document contributes several near-duplicate candidates and another contributes few-but-distinct ones will naturally favor spreading picks across documents once near-duplicates within one cluster get skipped. This is confirmed both by direct code reading and by QA1 and the existing headline e2e test real embeddings-based selection (distinct question texts per document leading to distinct embeddings leading to all documents represented).
5. Grounding-scope narrowing: confirmed two ways - (a) code read of LessonPracticeService.generate Curriculum branch sets scope = curriculumId equal to curriculum.id, passed straight into RetrievalService.retrieve, which forwards it unmodified into VectorStorePort.searchChunks/scrollChunks; (b) the existing unit test asserting shortfall-fill grounding is narrowed to curriculumId only (not the whole tenant, not a single document) asserts retrieve is called with exactly curriculumId equal to curr-1 (not empty, not documentId) - re-run as part of the full suite, passing.
6. Migration safety: read 1730000000016-add-lesson-curriculum-practice-session-kind.ts directly - up is a MODIFY COLUMN MySQL ENUM widening (adds LessonCurriculum as a 4th trailing value), which is genuinely non-destructive for MySQL (no DROP, no data rewrite, existing Prompt/LessonDocument/LessonSubject rows are untouched). down is a best-effort narrowing back to 3 values (documented as lossy for any row that used the new value - consistent with this codebase existing precedent elsewhere). Confirmed the migration actually ran and applied cleanly in both e2e runs above.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-CUR-6 extension: curriculumId scope selector accepted | QA1, existing e2e headline test | PASS | HTTP 200, kind=LessonCurriculum persisted |
| Multi-document synthesis (headline exit gate) | Existing e2e headline test (2 docs) + QA1 (3 docs, independently constructed) | PASS | DB trace: selected bank questions resolve to at least 2 (existing test) / 3-of-3 (QA1) distinct curriculum_document_ids |
| documentId precedence over curriculumId | Existing unit test + QA2 (real HTTP) | PASS | kind=LessonDocument, single-document result returned even with curriculumId also sent |
| Neither scope sent -> subject-wide fallback | QA3 | PASS | 200, status=completed |
| CURRICULUM_NOT_FOUND for nonexistent Curriculum | Existing e2e test | PASS | 404, error.code=CURRICULUM_NOT_FOUND |
| CURRICULUM_NOT_FOUND for Curriculum in wrong subject | Existing unit test | PASS | Code-level assertion |
| Curriculum-wide EMPTY_QUESTION_BANK (unfinalized-only questions) | Existing e2e test | PASS | 422, error.code=EMPTY_QUESTION_BANK, promptPracticeMock never called |
| Diversity selection spreads across documents, not just intra-document dedup | Code read (selectDiverse is document-agnostic) + QA1 + existing headline test | PASS | See point 4 above |
| Shortfall-fill grounding narrowed to curriculumId | Existing unit test (re-run) + code read of RetrievalService/VectorStorePort plumbing | PASS | Exact-shape assertion, curriculumId=curr-1 only |
| Tenant isolation for curriculumId | QA4 (real second tenant, real cross-tenant request) | PASS | 404 CURRICULUM_NOT_FOUND |
| Same-tenant, different-owner ownership isolation for curriculumId | QA5 | FAIL - see Defect D1 | 200 (request succeeded using a Curriculum owned by a different user) |
| Additive migration safety | Code read + successful application in all e2e runs | PASS | No DROP, no data rewrite; ran cleanly against real MySQL 8.4 multiple times |
| Full unit suite regression-free | Full re-run | PASS | 179/179 suites, 1553/1553 tests |
| Full e2e suite (existing) regression-free | Full re-run | PASS | 8/8 |
| Security self-review claims (no new endpoint, parameterized queries, no secret) | Code read | PASS | Confirmed - reuses POST /practice/lesson, attempts.take guard; TypeORM query builder throughout, no string concatenation of user input into SQL |

## Defects

### D1 - curriculumId scope bypasses FR-CUR-1a per-user Curriculum ownership enforcement (non-blocking for this specific phase, but flagged for visibility)

Severity: non-blocking edge case (inherited design, not a Dev-32 regression - but Dev-32 extends the identical gap to the new scope, so flagging per this dispatch explicit instruction #6).

Expected (spec FR-CUR-1a, docs/PRODUCT_SPECIFICATION.md around line 623): Curriculum ownership is enforced at the individual-user level, not merely at the tenant level - two Members in the same tenant do not share each other Curricula by default; a non-owner Member attempt to view/modify a Curriculum they do not own returns 403 (NOT_CURRICULUM_OWNER), or 404. This is also enforced elsewhere in the codebase: GET/PATCH/DELETE /curricula/:id and GET /curricula/:id/search (LLD section 7.7) are gated owner-or-curricula.read_all, returning 403 NOT_CURRICULUM_OWNER for a non-owner.

Actual: POST /practice/lesson is gated only by the generic attempts.take permission (practice.controller.ts). Neither the pre-existing documentId branch (Dev-27) nor the new curriculumId branch (Dev-32) in LessonPracticeService.generate checks curriculum.ownerUserId against the acting user - CurriculaRepository.findById/findDocumentByIdOnly are plain, unscoped lookups with no owner filter. Any authenticated tenant user holding attempts.take can request a Curriculum-scoped (or document-scoped) Lesson Practice session against any Curriculum/document that exists anywhere in their tenant, including ones they do not own and have no curricula.read_all grant for.

Repro (QA5 above): seed a Curriculum with owner_user_id set to a different (non-acting) user id in the same tenant, with one packaged question. POST /api/practice/lesson with stageId, subjectId, curriculumId, count=1 as the tenant admin (who is not that Curriculum owner) results in 200, session created and questions returned, rather than a 403/404.

Note: this is not a Dev-32-introduced regression - documentId-scoped Lesson Practice (Dev-27, already QA-green) has the identical gap, and Dev-27 own QA report (qa-results/dev-27/REPORT.md) explicitly scoped its ownership check to practice-session ownership (who can view/answer a session after creation), not to Curriculum/document ownership at generation time, and did not flag this as a gap. Dev-32 simply replicates the same pattern for the new curriculumId scope, consistent with (not deviating from) the already-accepted precedent. Given FR-CUR-6 own framing ("the bank, not the raw document, is the source of practice questions") arguably treats the packaged question bank as a shared, cross-user practice resource rather than raw Curriculum content - a plausible intentional design reading - but this is not stated anywhere as a documented exception to FR-CUR-1a. Flagging as a genuine spec-vs-implementation gap for the orchestrator/product owner to make an explicit call on (accept as intended scope for FR-CUR-6, or open a fix), not blocking Dev-32 own exit gate since it neither regresses nor deviates from Dev-27 already-shipped, already-accepted behavior.

## Verdict

Dev-32 (BL-31) is QA-green - ready to advance. The phase own stated exit gate (genuine multi-document synthesis, documentId precedence, Curriculum-wide EMPTY_QUESTION_BANK/CURRICULUM_NOT_FOUND, narrowed shortfall-fill grounding, additive migration, zero regressions) is independently confirmed via real HTTP plus real MySQL 8.4 plus real Qdrant, including an independently-constructed 3-document synthesis scenario beyond nexus-dev own 2-document proof and a genuine cross-tenant isolation test. One non-blocking finding (D1, same-tenant cross-owner access bypassing FR-CUR-1a) is reported for visibility - it is inherited from already-QA-green Dev-27 and not a regression this phase introduced, so it does not block this phase own exit gate.
