# QA Report — Dev-25a (BL-24: Image extraction & association, backend)

**Date:** 2026-08-11
**Scope:** Dev-25a only (FR-PDF-11, FR-FILE-3, backend). Dev-25b (UI) and later phases explicitly out of scope and do not exist yet.

## Environment

- Backend: apps/api, NestJS, run in-process via Nest `Test.createTestingModule` (same harness the existing e2e suite uses) — no separately-hosted dev server needed for API-level verification.
- Database: real MySQL (Docker container `examland-mysql`, MySQL 8.4/Innovation release), fresh per-test tenant schemas created/dropped by each test run — never pointed at production.
- Vector/AI: Qdrant container already running; AI service stubbed via `AI_SERVICE_PORT`/`EMBEDDINGS_PORT` overrides (matching the existing e2e convention) — no live LLM calls needed to validate this phase's storage/reference-counting logic.
- Storage: local temp directory (`STORAGE_ROOT`) per test run, cleaned up in `afterAll`.

## What was independently verified

1. **Read all in-scope code**: `image-association.service.ts`, `stored-image.repository.ts`, `question-image.repository.ts`, `pdf-image-extractor.ts`, `page-overlap.util.ts`, `image-extraction.service.ts`, and the `CreateMediaTables1730000000012` migration DDL. All match the LLD/plan's described shape (atomic `SET usage_count = usage_count ± 1` / `GREATEST(usage_count - 1, 0)` updates, `uq_image_hash` DB-unique, `fk_qi_img ... ON DELETE RESTRICT`, `fk_qi_gq ... ON DELETE CASCADE`).
2. **Re-ran the full unit suite myself** with the project's own `npm test` (i.e. with the required `NODE_OPTIONS=--experimental-vm-modules` the package.json script sets — my first raw `npx jest` invocation without that flag produced spurious pdf.js worker failures unrelated to any real defect). Confirmed: **171 suites / 1434 tests, all green**, matching nexus-dev's reported numbers exactly. `npm run typecheck` and `npm run lint` both clean, confirmed independently.
3. **Re-ran nexus-dev's own e2e suite** (`test/pdf-image-extraction.e2e-spec.ts`) against a fresh real-MySQL tenant schema: both tests pass, confirming (a) content-hash dedup — one image embedded on two pages of one PDF produces exactly one `stored_image` row with `usage_count=2`; (b) page-overlap association — two distinct `generated_question` rows (one per page) both get an association row to the same image, each with non-empty `alt_text`; (c) reference-counted removal — removing one of two associations leaves the row intact at `usage_count=1`, removing the second genuinely deletes the row (confirmed via direct SQL after each removal) and triggers storage cleanup; (d) a second independent PDF/session upload with byte-identical image content reuses the same `stored_image` row (`usage_count` reaches 2, no second row ever created), verified both via raw SQL and via `QuestionImageRepository.countForImage`.
4. **Wrote and ran my own additional concurrency test** (not left in the repo — deleted after the run, per test hygiene) directly exercising `ImageAssociationService` through the real app/DB, going beyond nexus-dev's own coverage:
   - Uploaded a 3-page PDF with the same image on all 3 pages (`usage_count=3`, 3 real associations), then fired **all three removals concurrently** (`Promise.all`). Result: exactly one of the three calls reported `imageDeleted: true`, all three reported `removed: true`, the `stored_image` row was genuinely gone afterward (confirmed via SQL), and no negative/stale `usage_count` was left behind. **This is the headline guarantee, and it holds correctly under real concurrent load with real row-locking.**
   - Fired **two concurrent removal calls targeting the exact same `question_image` id** on a 2-association image. This surfaced a real defect (see Defect 1 below).

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-PDF-11 content-hash dedup | Identical image bytes across 2 sessions → 1 `stored_image` row, `usage_count=2`, no duplicate storage write | Pass | `pdf-image-extraction.e2e-spec.ts` test 2 (re-run by QA), SQL checks |
| FR-PDF-11 page-overlap association | 2-page real PDF, same image on both pages → both distinct `generated_question` rows get an association | Pass | `pdf-image-extraction.e2e-spec.ts` test 1 (re-run by QA); `page-overlap.util.ts` code read confirms range-overlap (not exact-match) semantics; unit suite `page-overlap.spec.ts` green |
| FR-FILE-3 usage-count survives partial removal | Shared image (2 associations) survives removing 1 of 2; deleted only on the 2nd | Pass | `pdf-image-extraction.e2e-spec.ts` test 1 (re-run by QA), direct SQL before/after each removal |
| FR-FILE-3 usage-count under concurrency (sequential-distinct) | 3 real associations on 1 image, all 3 removed **concurrently** | Pass | QA's own additional e2e test (see above); exactly 1 delete, no negative count |
| FR-FILE-3 usage-count under concurrency (duplicate/same call) | Same `question_image` id removed **twice concurrently** | **Fail (non-blocking)** | QA's own additional e2e test — see Defect 1 |
| Atomic usage_count updates (not read-modify-write) | Code read of `StoredImageRepository.increment/decrementUsageCount` | Pass | Both use `createQueryBuilder().update().set({ usageCount: () => 'usage_count ± 1' })` — genuine atomic SQL, not app-level read-then-write |
| `ON DELETE RESTRICT` DB-level backstop | Code/migration read | Pass | Migration DDL literally has `CONSTRAINT fk_qi_img FOREIGN KEY (image_id) REFERENCES stored_image(id) ON DELETE RESTRICT`; also **empirically triggered** as the root cause surfaced by Defect 1's failure path (see below) — proof the constraint is real and enforced, not just declared |
| Real pipeline integration (upload → extract → dedup → associate) | Full HTTP upload of a real PDF with embedded PNG, real `pdf-parse` extraction, real MySQL | Pass | Both re-run e2e tests, exercised via real HTTP endpoints (`POST /pdf-processing/upload`, `GET /pdf-processing/sessions/:id`) |
| Unit suite regression | Full apps/api suite | Pass | 171 suites / 1434 tests green (re-run by QA), matches nexus-dev's reported numbers |
| Static analysis | typecheck + lint | Pass | Both clean, re-run by QA |
| Security spot-check (this phase's own claims) | Code read: no new HTTP endpoint, storage keys derived server-side from tenantId/sessionId/hash, parameterized queries only | Pass | Confirmed by reading `image-extraction.service.ts`/`image-association.service.ts` — no raw string concatenation, no user-controlled storage-key input |

## Defects found

### Defect 1 — Concurrent duplicate removal of the same association throws an unhandled 500 instead of being idempotent (Non-blocking for Dev-25a's own exit gate; flag for whoever builds the manual removal endpoint next, i.e. relevant to Dev-25b or a future manual-media phase)

**Expected:** `ImageAssociationService.removeAssociation`/`removeAssociationAndCleanupStorage` is documented (implicitly, by analogy with `associateWithQuestion`'s explicit idempotent-duplicate-call handling) to be a safe operation to retry/duplicate — the reference-counting design's whole premise is safety under concurrent access. Firing the same removal twice concurrently (e.g. a UI double-click, or a retried request) should either both report "not found the second time" gracefully, or otherwise not surface an unhandled 500.

**Actual:** `QuestionImageRepository.deleteAndReturn` does a plain `findOne` (read) followed by a separate `delete` (write) — not an atomic delete-and-check. Under two concurrent transactions targeting the *same* `question_image` row:
- Transaction A: `findOne` sees the row, deletes it, commits, decrements `usage_count` (e.g. 2→1).
- Transaction B (racing before A commits): `findOne` also sees the row (its own snapshot, under REPEATABLE READ, still shows it as existing), then its `DELETE` blocks on A's row lock, unblocks after A commits — but by then the row is already gone, so B's `DELETE` affects 0 rows, yet the code doesn't check affected-row count and still treats `deleteAndReturn` as having succeeded (reusing the previously-fetched-but-now-stale entity). B then proceeds to decrement `usage_count` a second time for an association that's already gone, potentially reaching a decremented count of 0 when it's actually already at the "should be deleted" state a different transaction handled — in the reproduction, the resulting attempt to delete the (already-being-deleted-by-A) `stored_image` row races A's own deletion of the same row, and the *second* transaction's `DELETE FROM stored_image` hits `fk_qi_img ... ON DELETE RESTRICT` because a phantom/leftover reference exists at that instant, surfacing as an uncaught `QueryFailedError` wrapped into an `InternalDomainError` — a 500-class failure, not a graceful no-op.

**Repro steps:**
1. Upload a PDF with the same image embedded on 2 pages (produces 2 real `generated_question` rows, 1 shared `stored_image` row with `usage_count=2`, 2 `question_image` association rows).
2. Take one association's id and fire `imageAssociation.removeAssociationAndCleanupStorage(sameId)` **twice concurrently** (`Promise.all`) inside the correct tenant context.
3. Observe: one call succeeds; the other throws `InternalDomainError: An unexpected error occurred. Please try again later.`, with an underlying `QueryFailedError: Cannot delete or update a parent row: a foreign key constraint fails (... fk_qi_img ...)`.
4. Reproduced twice (both as part of a larger concurrent test run and in isolation running only that one test) — not flaky.

**Severity: Non-blocking.** No HTTP endpoint currently exposes `removeAssociation` (nexus-dev's own completion notes confirm the manual add/remove endpoint from LLD §7.9 is explicitly deferred, not built this phase) and the automatic pipeline path never calls removal at all — so this defect has **no live production surface today**. It does, however, contradict the "reference-counted removal is safe under concurrency" framing implied by this phase's own headline exit gate, and it **will** become reachable the moment a manual remove-image endpoint is built (flagged for Dev-25b or whichever phase adds it). Root cause is narrow and well-understood (non-atomic find-then-delete in `QuestionImageRepository.deleteAndReturn` — needs a `DELETE ... RETURNING`-equivalent or an atomic conditional delete, or a duplicate-request guard in `ImageAssociationService.removeAssociation` itself).

**Note on the DISTINCT-associations concurrency case** (explicitly requested by the orchestrator): this one **passes** — 3 concurrent removals of 3 *different* associations on the same shared image correctly resulted in exactly one final delete, no negative/stale usage_count, confirmed via SQL. The defect above is specific to firing the identical association-removal call twice, not to genuine concurrent-but-distinct removals, which is the scenario Dev-25a's own exit gate and this phase's actual current call sites (none yet) care about.

## Overall verdict

**Ready to advance — Dev-25a is QA-green.** The plan's own exit gate ("usage-count test proving a shared image survives removal of one of its associations") and every FR-PDF-11/FR-FILE-3 behavior in scope hold correctly, verified independently against real MySQL/real HTTP/real image bytes, including the harder concurrent-distinct-removals race the orchestrator specifically asked me to construct. Defect 1 is a real, reproducible robustness gap but is currently unreachable (no endpoint exists that could trigger it) — it is flagged for whoever builds the deferred manual add/remove media endpoint, not a blocker for this phase's own scope or exit gate.