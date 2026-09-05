# QA Report — Dev-12a (BL-11: Manual (ZIP) Exam Authoring, backend)

**Date:** 2026-08-09
**QA agent:** nexus-qa (independent verification pass)
**Scope:** Dev-12a only (BL-11 backend). Dev-12b and later phases are out of scope and do not exist yet.

## Environment

- API: `apps/api` (NestJS), run in-process via `@nestjs/testing` + `supertest` against the real HTTP surface (no mocks of the framework/guard/DB stack).
- Database: a fresh, disposable MySQL 8.4 container (mysql:8.4, tmpfs data dir, port 3320) started specifically for this QA pass, matching docker/docker-compose.dev.yml's pinned version -- the pre-existing examland-mysql container on port 3306 was left untouched (it runs a different, non-8.4 MySQL image and belongs to another local project context, not used for this QA pass). Container was torn down after the run; no data retained.
- Real disk storage: a fresh mkdtemp STORAGE_ROOT per test run, cleaned up after.
- No production system was touched at any point.

## What was independently verified (not just re-reading nexus-dev's self-report)

1. Read docs/NEXUS_STATE.md's Dev-12a decision-log entry, docs/plans/examland-mvp-plan.md's Dev-12a section, docs/PRODUCT_SPECIFICATION.md FR-AUTH-1/3/5, and docs/architecture/HLD.md Section 5.3.
2. Read the actual implementation source in full: exam-zip-parser.ts (the zip-slip barrier), exam-authoring.service.ts, exam-authoring.controller.ts, the three entities, errors.ts, and the DTO.
3. Ran the full existing unit suite (npm run test:cov -w apps/api) against this QA pass's own environment: 114 suites / 929 tests, all green, coverage 92.38/80.16/87.95/92.49 percent (matches nexus-dev's report exactly).
4. Ran the full existing e2e suite (npm run test:e2e -w apps/api --runInBand) against the fresh, real MySQL 8.4 instance: 24 suites / 237 tests, all green (matches nexus-dev's report exactly), including test/exam-authoring.e2e-spec.ts.
5. Wrote and ran my own independent e2e test file (test/qa-dev12a-independent.e2e-spec.ts, not derived from nexus-dev's fixture code beyond the unavoidable minimal-ZIP-format byte-writing primitives) against the same live stack, then deleted it (test hygiene -- not a permanent addition). All 10 of my own scenarios passed. This is the file this report's zip-slip verdict rests on, not nexus-dev's own fixture.
6. Ran npm run lint (root workspace) -- clean, zero warnings/errors.
7. Ran npm run typecheck -- clean.
8. Ran npm audit --omit=dev -- confirmed the only vulnerabilities present (node-tar/bcrypt transitive chain, 2 high + 1 critical) are the same pre-existing chain flagged since Dev-3, unrelated to and not touched by this phase's new yauzl/yazl dependencies. No new vulnerable dependency.

## Zip-slip control -- headline security-critical item -- independently re-verified

Two independently hand-rolled raw-ZIP-byte fixtures (my own buildRawZip writer, using different traversal techniques than nexus-dev's own fixture list) were built and posted to the real, running HTTP endpoint (POST /api/exam-types/zip), each alongside an otherwise-perfectly-valid module/question payload:

- QA-ZIPSLIP-1 -- a Windows drive-letter absolute path entry (C:\Windows\System32\evil.dll, backslash-separated) hidden alongside a valid Algebra/q1.json entry. Result: 400 INVALID_ZIP_STRUCTURE. Verified via direct filesystem read (listAllFilesRecursively) that zero files were written under STORAGE_ROOT, and an independent canary directory outside STORAGE_ROOT was also confirmed empty (proving no write escape anywhere on disk, not merely "no write inside the intended root"). Zero exam_type DB rows.
- QA-ZIPSLIP-2 -- a deep, disguised traversal entry (Algebra/../../../../tmp/evil.json, a valid-looking module/file suffix concealing ../../../../) alongside a valid entry. Result: 400 INVALID_ZIP_STRUCTURE. Verified zero files under STORAGE_ROOT, zero exam_type rows, and directly checked the real OS temp directory for the specific canary filename (evil.json) the payload targeted -- confirmed absent.

Both were rejected before any storage or DB write occurred, consistent with exam-zip-parser.ts's documented two-layer defense (independent segment-level rejection of ".."/"." segments, absolute paths, drive letters, backslash-normalization -- plus a second, structurally separate normalize+resolve+assert-under-root re-derivation). Combined with nexus-dev's own 7 zip-slip unit cases (../../../etc/passwd, absolute unix path, Windows drive-letter path, backslash traversal, mid-path traversal, "." segment, embedded NUL byte -- confirmed present by reading exam-zip-parser.spec.ts directly) and its own real-HTTP e2e case, this control holds under independent, adversarial re-testing.

Verdict on the security-critical exit gate: PASSES.

## Other exit-gate / named-behavior verification (my own independent HTTP calls, not re-running nexus-dev's tests)

| Item | Method | Result |
|---|---|---|
| QUESTION_COUNT_MISMATCH | Genuine declared/actual mismatch via real upload | 400 QUESTION_COUNT_MISMATCH -- PASS |
| EXAM_TYPE_NAME_EXISTS | Real duplicate-name upload | 409 EXAM_TYPE_NAME_EXISTS -- PASS |
| EMPTY_MODULE / INVALID_ZIP_STRUCTURE | Declared module folder with only a non-.json junk file | 400, one of the two acceptable codes fired -- PASS |
| INVALID_QUESTION_FILE | Malformed JSON content in a .json entry | 400 INVALID_QUESTION_FILE -- PASS |
| Magic-byte validation | Plain-text buffer renamed exam.zip | 400 INVALID_ZIP_STRUCTURE (rejected on content, not extension) -- PASS |
| Transactional rollback (own technique: undeclared extra folder) | Real upload with an extra, undeclared top-level folder | 400, zero DB rows, zero storage artifacts -- PASS. (nexus-dev's own duplicate-name-based rollback proof was independently re-run as part of the full e2e suite and also passed.) |
| EXAM_TYPE_HAS_ACTIVE_ATTEMPTS stub | Real create + real delete | 204 -- delete succeeds immediately, no crash; confirmed via source read that hasActiveAttempts() is a hardcoded return false stub, not a query against a nonexistent table (no crash risk) -- PASS |
| Curriculum FK not yet enforced | SHOW COLUMNS FROM exam_type / SHOW TABLES LIKE 'exam_type_curriculum' on real tenant schema | No curriculum column, no exam_type_curriculum table -- matches the documented forward-reference (table not created at all, not merely nullable) -- PASS |

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-AUTH-1 (ZIP structure validation, no-partial-artifact) | Happy path (existing e2e), 2 independent zip-slip fixtures, magic-byte check, malformed JSON, empty module | PASS | e2e suite run + my QA-ZIPSLIP-1/2, QA-ERR tests |
| FR-AUTH-1 (QUESTION_COUNT_MISMATCH) | Genuine mismatch upload | PASS | QA-ERR: QUESTION_COUNT_MISMATCH |
| FR-AUTH-1 (EXAM_TYPE_NAME_EXISTS) | Genuine duplicate name | PASS | QA-ERR: EXAM_TYPE_NAME_EXISTS |
| FR-AUTH-1 (rollback / no partial artifacts) | Independent technique (undeclared extra folder) + existing duplicate-name DB-level rollback | PASS | QA-ROLLBACK + full e2e suite |
| FR-AUTH-3 (module configuration persisted) | Happy-path GET/DELETE round-trip (existing e2e) | PASS | e2e suite |
| FR-AUTH-5 (deletion, active-attempts stub) | Real create+delete | PASS (stub correctly vacuous, no crash) | QA-STUB |
| HLD 5.3 (zip-slip rejection) | 2 independent hand-rolled attack fixtures over real HTTP | PASS | QA-ZIPSLIP-1/2, filesystem-verified |
| HLD 5.3 (magic-byte check) | Non-ZIP buffer with .zip name | PASS | QA-ERR: fake zip |
| Curriculum FK forward reference (plan) | Schema inspection | PASS -- not accidentally enforced | QA-SCHEMA |
| Unit/e2e counts (929/237) | Full suite re-run against fresh MySQL 8.4 | PASS -- exact match | test:cov / test:e2e output |
| Lint/typecheck/dependency hygiene | npm run lint, npm run typecheck, npm audit | PASS | command output above |

No requirement in scope was found untested; no gaps identified.

## Defects found

None. No blocking or non-blocking defects identified during this independent pass.

## Notes / non-blocking observations (not defects)

- The plan's phrasing ("curriculum FK added here as nullable") diverges from what was actually built (the exam_type_curriculum table was not created at all, since it would FK a table that doesn't exist yet). This is explicitly documented in the decision log and the migration's own doc comment as a deliberate, reasoned deviation, not an oversight -- I consider this an acceptable resolution of an internally-inconsistent plan instruction, not a defect.
- The local dev environment had a stale/unrelated MySQL container (non-8.4 image) occupying the "default" port from a prior session; this QA pass used a dedicated, disposable MySQL 8.4 container instead, per the exit-gate's explicit MySQL-8.4 requirement. This is an environment-hygiene note for whoever manages local dev infra, not a Dev-12a defect.

## Overall verdict

READY. Dev-12a (BL-11 backend) is QA-green. The security-critical zip-slip control was independently re-verified with two of my own hand-rolled attack fixtures (distinct techniques from nexus-dev's own fixture) and genuinely holds -- zero filesystem escape, zero DB/storage artifacts in every case. All named validation error codes fire correctly for their specific trigger conditions. Transactional rollback holds under an independently-chosen failure technique. The EXAM_TYPE_HAS_ACTIVE_ATTEMPTS stub and curriculum-FK forward references are correctly inert, not accidentally enforced or crash-prone. Unit (114/929) and e2e (24/237) suite counts reproduced exactly against a live MySQL 8.4 instance. No defects found.
