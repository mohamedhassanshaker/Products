# QA Report -- Dev-27 (BL-26: Adaptive Lesson Practice, FR-CUR-6)

Date: 2026-08-11
Scope: Dev-27 only (bank-first selection, diversity selection, EMPTY_QUESTION_BANK exit gate). Dev-28+ out of scope; Phases 1-4 and Dev-23..26 already QA-green and not re-verified here.

## Environment
- apps/api against real MySQL (docker container examland-mysql, host 127.0.0.1:3306) and real Qdrant (examland-qdrant, http://localhost:6333).
- Real HTTP via supertest against a real NestJS app boot (AppModule), real tenant provisioning, real JWT auth.
- AiServicePort.promptPractice mocked (Jest mock) per the project own established e2e convention (no live LLM calls) -- correct for testing bank-first ordering call-count assertions and shortfall-fill wiring, not a shortcut around real verification.
- EmbeddingsPort real network calls avoided via deterministic fake ports (same convention as nexus-dev own suite; independently supplemented with my own controllable-vector fake, see below) -- Qdrant itself is real.
- All ad hoc MySQL schemas created during this pass confirmed dropped after the run (SHOW DATABASES re-checked, zero leftovers).

## What I independently did (not just re-read nexus-dev own report)
1. Read docs/PRODUCT_SPECIFICATION.md FR-CUR-6, the plan Dev-27 section, and docs/NEXUS_STATE.md Dev-27 decision-log entry in full before touching code.
2. Read LessonPracticeService, selectDiverse (diversity-selection.ts), GeneratedQuestionRepository.findPackagedForDocument/findPackagedForSubject, and PracticeController directly -- traced the EMPTY_QUESTION_BANK gate, the bank-first/shortfall-fill branch, and the guard chain myself rather than trusting the completion note prose.
3. Re-ran nexus-dev own real-MySQL e2e suite (test/lesson-practice.e2e-spec.ts) myself from a cold start: 5/5 green, matching the reported figure exactly.
4. Wrote and ran two of my own new, independent e2e tests (real MySQL + real HTTP + real Qdrant, not reusing nexus-dev own test file) targeting the two things the orchestrator specifically flagged as needing verification beyond nexus-dev own unit tests:
   - A genuine near-duplicate-vs-distinct scenario using a controllable EmbeddingsPort fake with hand-crafted vectors (a near-duplicate pair at cosine ~0.995, above the 0.93 threshold, plus one genuinely orthogonal question) -- confirmed the real HTTP response selects the seed plus the distinct question, never the near-duplicate, even though the near-duplicate had the 2nd-highest confidence score.
   - A genuine bank-first call-count assertion: a document-scoped bank with exactly enough questions to satisfy the request, confirming AiServicePort.promptPractice mock is never invoked.
   Both passed. Deleted the scratch test file after the run (test hygiene).
5. Re-ran the full apps/api unit suite from a cold start: 175 suites / 1495 tests green -- exact match to nexus-dev reported figure.
6. Ran npx tsc --noEmit on apps/api: clean, no errors.
7. Read practice.controller.ts directly and confirmed the guard chain matches the completion note claim.
8. Confirmed findPackagedForDocument/findPackagedForSubject both filter on linked_exam_type_id IS NOT NULL.

## Traceability matrix

| Requirement / scenario | Test(s) | Result | Evidence |
|---|---|---|---|
| FR-CUR-6: EMPTY_QUESTION_BANK when a document exists but has zero packaged (finalized) questions, checked before any embedding/AI call | lesson-practice.e2e-spec.ts test 1 (re-run) | PASS | Real HTTP 422, error.code === EMPTY_QUESTION_BANK, promptPracticeMock never called. Document had one draft (linked_exam_type_id IS NULL) question -- proves the gate checks packaged, not any question exists for this document. |
| FR-CUR-6: document-scoped selection is confidence-ranked, not arbitrary order | lesson-practice.e2e-spec.ts test 2 (re-run) | PASS | Two bank questions (confidence 0.95, 0.80); count:1 request returns the 0.95 one. |
| FR-CUR-6: bank-first ordering -- no AI call when bank alone satisfies the request | lesson-practice.e2e-spec.ts test 2 (re-run) + my own independent test 2 | PASS | promptPracticeMock call-count asserted zero in both; my own test used a document-scoped bank with exactly count questions to isolate the boundary precisely. |
| FR-CUR-6: shortfall-fill via AiServicePort.promptPractice when bank has SOME but not enough | lesson-practice.e2e-spec.ts test 3 (re-run) | PASS | 1 bank question plus count:2 request triggers promptPracticeMock called with count:1; persisted rows are source=Bank plus source=Generated,source_ref=NULL. |
| FR-CUR-6: subject-scoped diversity selection genuinely avoids near-duplicates, not just confidence order | diversity-selection.spec.ts (unit, read/confirmed) + my own independent test 1 (real HTTP) | PASS | My own test: seed (conf 0.95) plus near-duplicate (conf 0.90, cosine ~0.995 to seed) plus distinct (conf 0.50, orthogonal). Real response selected Seed and Distinct, never the near-duplicate, despite the near-duplicate higher confidence. |
| FR-CUR-6: subject-scoped kind persistence | lesson-practice.e2e-spec.ts test 4 (re-run) | PASS | practice_session.kind = LessonSubject, curriculum_document_id = NULL. |
| Answer submission persists and round-trips correctly | lesson-practice.e2e-spec.ts test 2 (re-run) | PASS | POST answer then a second GET shows selectedOption=A, isCorrect=true; raw DB row confirms selected_option=A, is_correct=1. |
| tinyint(1) to real boolean JSON (isCorrect) | lesson-practice.e2e-spec.ts test 2 (re-run) | PASS | JSON response shows isCorrect true as a JS boolean, not 1; null preserved for never-answered questions. |
| SESSION_NOT_FOUND for nonexistent session | lesson-practice.e2e-spec.ts test 5 (re-run) | PASS | Real HTTP 404, error.code === SESSION_NOT_FOUND. |
| Auth/ownership boundary on practice routes | Code read (practice.controller.ts, requireOwnedSession) | PASS (code-level) | Guard chain present; ownership equality check present. Not separately re-driven as a cross-user HTTP test this pass -- noted as a minor coverage gap below. |
| Full apps/api unit suite | Full re-run | PASS | 175 suites / 1495 tests, exact match to nexus-dev reported figure. |
| typecheck | tsc --noEmit | PASS | Clean. |

## Defects found

None blocking. No non-blocking functional defects found either -- every specific concern raised by the orchestrator was independently reproduced against real infrastructure, not just re-read from nexus-dev own claims.

One minor coverage gap (not a defect, not blocking): no dedicated cross-user-ownership HTTP test exists for the new practice routes. The code path is a straightforward, already-reviewed pattern reused from AttemptsService own QA-green precedent, so this is flagged as a traceability gap for the record, not a functional concern.

## Verdict

Dev-27 is QA-green. The EMPTY_QUESTION_BANK exit gate genuinely holds. Bank-first ordering is genuinely enforced (zero wasted AI calls confirmed via call-count assertion). Confidence-ranked document-scoped selection and near-duplicate-avoiding subject-scoped diversity selection are both confirmed via real HTTP against real MySQL and Qdrant. The tinyint(1)/boolean fix holds. Answer submission persists and round-trips correctly. No blocking or non-blocking defects found.
