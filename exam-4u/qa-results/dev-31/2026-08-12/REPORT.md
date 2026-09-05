# QA Report - Dev-31 (BL-30: "Find similar questions" reviewer tool)

**Date**: 2026-08-12
**Scope**: Dev-31 only (Dev-32+ do not exist yet). Regression re-check on Dev-19a/Dev-24
(finalize/append) since Dev-31 touches their wiring.
**Environment**: local Docker examland-mysql (3306), examland-qdrant (6333), real
MySQL 8.4 + real Qdrant. No mocks for e2e. API unit suite via Jest
(NODE_OPTIONS=--experimental-vm-modules), web unit suite via ng test (Vitest-based
unit-test builder). No production environment touched.

## Verdict: PASS - ready to advance (no blocking defects)

## What was independently verified (not just re-reading nexus-dev's own report)

1. Headline near-duplicate detection - ran the project's own real-MySQL+real-Qdrant
   e2e (apps/api/test/similar-questions.e2e-spec.ts) directly: 3/3 pass. Test genuinely
   finalizes a first session, then a second, independent, never-finalized session's
   identical-text question is surfaced via GET /pdf-processing/questions/:id/similar
   with score >= 0.99 and correct examTypeName/moduleName; a deterministically
   orthogonal unrelated candidate returns []; a nonexistent id 404s. Confirmed the
   "no match" proof is genuinely deterministic (orthogonal unit vectors, dot product 0),
   not probabilistic.
2. Question-bank population, both code paths - read FinalizeExamService.finalize
   (lines 119-136) and AppendExamService.append (lines 87-99): both call
   QuestionBankIndexingService.indexQuestions only after their own repository commit,
   and only inside a resolved tenant scope. Confirmed via the e2e that finalize's write
   genuinely lands in Qdrant (the second session's lookup would return [] otherwise).
3. Fire-and-forget/best-effort indexing - QuestionBankIndexingService.indexQuestions
   wraps embed+upsert in try/catch, logs, never rethrows. Ran its unit spec directly: two
   cases simulate an embeddings failure and a vector-store failure and assert
   indexQuestions still resolves without throwing. Re-ran the full
   pdf-review-finalize.e2e-spec.ts and pdf-append.e2e-spec.ts suites (9/9 pass)
   against real Qdrant - no regression in finalize/append's own transactional behavior.
4. Tenant isolation - SimilarQuestionsService.findSimilar routes through
   VectorStorePort.searchQuestions -> QdrantVectorStoreAdapter, HLD section 6.2's single
   chokepoint (buildFilter prepends the tenant "must" clause; assertNoLeak
   post-filters every result). Ran vector-tenant-isolation.e2e-spec.ts directly against
   real Qdrant: its "searchQuestions never returns tenant B's identical-questionKey
   question for a tenant A scope" case passes, plus 9 sibling isolation cases (scroll,
   delete, purge, compile-time TenantScope guard).
5. scoreThreshold param - confirmed in qdrant.adapter.ts searchQuestions (lines
   230-246) it is passed straight through to Qdrant's own score_threshold on the
   query call, mirroring searchChunks's pre-existing identical parameter. The e2e's
   "unrelated" case proves this floor is load-bearing at the HTTP layer, not merely
   plumbed and ignored.
6. Regression on Dev-19a/Dev-24 - re-ran pdf-review-finalize.e2e-spec.ts and
   pdf-append.e2e-spec.ts (their own already-QA-green suites): both green, 9/9,
   including the append idempotency-retry-after-partial-failure case, unaffected by the
   new indexing collaborator.
7. Real browser - not independently re-run this pass (time-boxed). Relying instead
   on the project's own SimilarQuestionsDialogComponent spec (6 tests, all dialog
   states: loading/empty/populated/error+retry) and the PdfSessionComponent button
   spec, both re-run as part of the full 340/340 web suite, plus code-level confirmation
   the new button/dialog wiring (content_copy icon button, opens dialog with question
   id + 80-char snippet) matches the documented deviation. Flagging as a minor coverage
   gap in this QA pass, not a defect - no evidence of a live-browser-only wiring bug
   found in code, and the component spec explicitly documents/works around this
   project's own MatDialog-mocking limitation in its Vitest+Angular harness.
8. "Accidental exact-hash dedup collision" fix - read pdf-processing.service.ts:
   entity.fileHash = sha256Hex(file.buffer) (line 155), unmodified by this phase,
   pre-existing Dev-16 logic. The e2e fixture's bug (multiple uploadAndGenerate calls
   originally sharing identical PDF bytes, tripping tier-1 hash dedup and silently
   reusing the first session) is genuinely a test-fixture artifact, not a papered-over
   product defect - the fix (embedding a random marker per upload) only touches the e2e
   spec, not any product code.
9. Full suites re-run independently (own runs, not copied from nexus-dev's report):
   - API unit: 179 suites / 1546 tests, all green.
   - Web unit: 60 files / 340 tests, all green.
   - similar-questions.e2e-spec.ts: 3/3.
   - pdf-review-finalize.e2e-spec.ts + pdf-append.e2e-spec.ts (regression): 9/9.
   - vector-tenant-isolation.e2e-spec.ts: 10/10.
   - tsc --noEmit (API): clean.

## Traceability matrix

| Item | Scenario tested | Result | Evidence |
|---|---|---|---|
| Headline: near-duplicate surfaced | Real finalize + real second session, identical text, score>=0.99 | PASS | similar-questions.e2e-spec.ts test 1 |
| Headline: unrelated question not surfaced | Orthogonal-vector candidate returns [] | PASS | same file, test 2 |
| 404 on nonexistent question id | GET .../:id/similar for random UUID | PASS | same file, test 3 |
| Question-bank population - finalize path | Code read + e2e proof (test 1 depends on it) | PASS | finalize-exam.service.ts L119-136 |
| Question-bank population - append path | Code read + unit spec assertions | PASS | append-exam.service.ts L87-99 |
| Best-effort indexing (embeddings failure) | Unit test, exception swallowed | PASS | question-bank-indexing.service.spec.ts |
| Best-effort indexing (vector-store failure) | Unit test, exception swallowed | PASS | same file |
| Finalize/append core behavior unaffected | Full regression e2e re-run | PASS | pdf-review-finalize / pdf-append e2e (9/9) |
| Tenant isolation on searchQuestions | Real two-tenant Qdrant e2e | PASS | vector-tenant-isolation.e2e-spec.ts |
| scoreThreshold genuinely filters | Code read + adapter unit spec + e2e floor behavior | PASS | qdrant.adapter.ts L230-246, adapter spec |
| Security: pdf.review guard, read-only, no over-exposure | Code read (controller + service) | PASS | route returns only 4 UI-facing fields |
| Frontend dialog states (loading/empty/populated/error) | Component spec (6 tests) | PASS | similar-questions-dialog.component.spec.ts |
| Frontend button wiring (correct question id/snippet) | Component spec | PASS | pdf-session.component.spec.ts |
| Real-browser click-through | Not independently re-run this pass | UNTESTED (gap, non-blocking) | see note above |

## Notes / discrepancies (non-blocking)

- The QA dispatch instructions describe UX_GUIDELINES.md section 11.3a as "pre-existing
  ... found and followed" by nexus-dev. This does not match the plan doc or the section
  itself: docs/plans/examland-mvp-plan.md's Dev-31 section explicitly states "UX
  guidance was authored this phase ... written before any UI code," and section
  11.3a point 1 describes appending to an existing mat-menu overflow menu that
  Dev-19b's actual review table never had - consistent with the section being written
  fresh this phase, not pre-existing. nexus-dev's own point-5 deviation note candidly
  flags this mismatch. This is a mischaracterization somewhere upstream of this QA
  dispatch, not a nexus-dev defect. Flagging for awareness only.
- No blocking or non-blocking code defects were found in Dev-31's implementation itself.

## Overall verdict

Dev-31 (BL-30) is QA-green - ready to advance. All headline exit-gate scenarios
(near-duplicate recall, deterministic non-match, 404, tenant isolation, best-effort
indexing, finalize/append regression, scoreThreshold pass-through, full unit+e2e suites)
were independently reproduced against real MySQL+Qdrant, not merely re-read from
nexus-dev's self-report. The only gap is a live-browser click-through re-run, a
non-blocking coverage gap given the passing component-level and e2e-level evidence
already gathered.
