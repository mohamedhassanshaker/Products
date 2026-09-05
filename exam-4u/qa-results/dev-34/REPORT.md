# QA Report — Dev-34 (BL-33: Generation-quality evaluation harness, internal tooling)

**Date:** 2026-08-12
**Scope:** Dev-34 only (BL-33, spec section 7.3: "Evaluation harness for generation quality
(golden-set regression testing of prompts)"). Dev-30 through Dev-33 are already QA-green and are
not in scope for this pass; Dev-35+ do not exist yet.

## Environment

- Codebase: d:\work\products\exam-4u (apps/api workspace).
- Real MySQL instance available in this sandbox at 127.0.0.1:3306 (container `examland-mysql`,
  root password `YourPassword` — different credentials than the project's own
  `docker/docker-compose.dev.yml` documents, but the same real MySQL 8.4-compatible server; no
  mocked DataSource, no in-memory DB substitute).
- No live AI engine/API key configured in this sandbox (as nexus-dev also reported) — `AI_ENGINE`
  stays `disabled` for all testing here; every AI call in scope is exercised through the real
  `AiServicePort` interface with a fake implementation injected via NestJS `overrideProvider`,
  which is this codebase's own established, dozens-of-suites-deep e2e convention (see Investigation
  below) — not something QA invented as a workaround.
- No frontend/UI surface exists for this phase (confirmed correct — see Investigation point 1).

## Investigation: was the self-disclosed "not possible in this sandbox" gap genuinely unavoidable?

**Direct answer: No. It was an avoidable gap, not a genuine sandbox limitation.** nexus-dev's own
completion notes and plan-section exit gate both frame full end-to-end exercise of the harness as
impossible "without a live, configured AI engine and a provisioned tenant with an assigned model."
That framing conflates two different things: (a) genuinely needing a *live third-party AI engine*
to validate a real prompt/model regression signal (true, and out of scope for an internal QA pass —
nobody is asking nexus-dev or QA to spend real tokens against a production model), and (b) needing
*any* real end-to-end proof that `GenerationEvaluationService`'s own orchestration, DI wiring, and
`buildEvaluationReport` integration are correct against a real database and the real `AiServicePort`
interface (false — this needs only a **fake** `AiServicePort`, injected through the real port
interface, exactly like every other AI-consuming phase in this codebase already does).

1. **The established pattern already exists and is used pervasively.** A grep of
   `apps/api/test/*.e2e-spec.ts` shows over 20 suites overriding `AI_SERVICE_PORT` via
   `Test.createTestingModule(...).overrideProvider(AI_SERVICE_PORT).useValue(fakeAiService())` —
   including `confidence-calibration.e2e-spec.ts` (Dev-33, QA-green last pass — the *exact*
   predecessor this harness reuses `CONFIDENCE_BANDS` from), `pdf-processing.e2e-spec.ts`,
   `lesson-practice.e2e-spec.ts`, `pdf-exam-extraction.e2e-spec.ts`, `pdf-append.e2e-spec.ts`, and
   more. Every one of these runs against a real, freshly provisioned tenant on real MySQL 8.4. This
   is not a hypothetical alternative — it is this project's own dominant, repeatedly-reused testing
   convention for exactly this situation (AI-port-calling code needing e2e proof without a live AI
   engine).
2. **QA wrote and ran such a test.** A new e2e spec
   (`apps/api/test/qa-generation-evaluation.e2e-spec.ts`, written for this investigation and removed
   afterward per test-hygiene rules — not left in the repo) did exactly this:
   - Booted the real `AppModule` via `Test.createTestingModule`, with `GenerationEvaluationService`/
     `ConfidenceCalibrationService`/`GeneratedQuestionRepository` added as local providers (the same
     three providers `evaluate-generation.ts`'s own `EvaluateGenerationCliModule` wires).
   - Overrode `AI_SERVICE_PORT` with a fake returning controlled `generateLessonBatch`/
     `extractExamPage` responses (2 lesson drafts at confidence 0.95/0.2 with 1 dropped item, 1 exam
     draft at confidence 0.5), and `EMBEDDINGS_PORT` with a deterministic fake.
   - Provisioned a real tenant against real MySQL via the real `TenantProvisioningService` (ran real
     platform + tenant migrations).
   - Entered the tenant's real ALS-bound scope via `TenantScopeService.runFor` (the exact pattern
     `evaluate-generation.ts` itself uses) and called `GenerationEvaluationService.run(tenantId)`
     directly.
   - Asserted the returned report's `totalGolden`/`totalFailed`/`overallDropRate`/
     `overallAvgConfidence`/`methods` matched what the controlled fake responses should produce.
   - **Result: PASS.** This proves nexus-dev could have written and shipped this exact test — the
     "not possible in this sandbox" framing does not hold up. (One environment wrinkle:
     `GenerationEvaluationService` isn't registered in `AppModule` by design, since it is
     intentionally CLI-only — the test simply added it as a local provider in the testing module,
     the identical thing `EvaluateGenerationCliModule` already does. This is a normal, minor
     test-setup step, not a blocker.)
3. **`migrate-tenants.ts`'s precedent, cited as justification, is not actually comparable once you
   look at what it is precedent *for*.** `migrate-tenants.ts` (the CLI wrapper) indeed has no
   dedicated e2e/spec file — but the actual logic it wraps, `TenantMigrationRunner`, has its own
   596-line real-MySQL e2e suite (`apps/api/test/tenant-migration-runner.e2e-spec.ts`), explicitly
   documented in that file's own header as "everything here runs against a live MySQL 8.4 instance
   — no mocked DataSource, no mocked TypeORM repository." That is the actual precedent: **the thin
   CLI wrapper can skip its own e2e spec because the service layer underneath it is already
   e2e-proven.** Dev-34's `GenerationEvaluationService` (the `TenantMigrationRunner`-equivalent layer
   here) has **no** real-MySQL/real-port-interface test at all — only unit tests using plain fake
   objects for every collaborator (`AiServicePort`, `ConfidenceCalibrationService`,
   `AppConfigService`) with "no real DB, no real HTTP" by the unit-test convention's own design.
   Citing `migrate-tenants.ts` as justification for skipping e2e coverage of `evaluate-generation.ts`
   the CLI wrapper would have been reasonable; using it to justify skipping e2e coverage of
   `GenerationEvaluationService` the service layer is not — that is exactly the layer
   `tenant-migration-runner.e2e-spec.ts` proves this project's own convention says *should* get
   real-DB coverage.
4. **Aggregation correctness (`buildEvaluationReport`) — independently verified.** QA constructed an
   independent 4-item fixture (2 lesson-generation items — one with mixed high/mid confidence scores
   and one drop, one with a single low-confidence score; 2 exam-extraction items — one outright
   failure, one with zero surviving drafts and 3 dropped) and ran it through the real
   `buildEvaluationReport` directly (outside Jest, via `ts-node`). Hand-computed expectations
   (`totalGenerated = 3`, `totalDropped = 4`, `overallDropRate = 4/7 = 0.5714285714285714`,
   `overallAvgConfidence = 1.75/3 = 0.5833333333333334`, `totalFailed = 1`, correct confidence-band
   bucketing of 0.9/0.65/0.2 into the `0.90-1.00`/`0.60-0.75`/`0.00-0.60` bands respectively) all
   matched the function's actual output exactly. **No defects found in the aggregation logic.**

## Traceability matrix

| Item | Scenario tested | Result | Evidence |
|---|---|---|---|
| `buildEvaluationReport` — drop-rate/avg-confidence math | Independent 4-item fixture, hand-computed vs. actual | PASS | ts-node script output (this report, point 4 above) |
| `buildEvaluationReport` — confidence-band bucketing | Same fixture, band assignment for 0.9/0.65/0.2 | PASS | Same script output |
| `buildEvaluationReport` — item failure handling | Failure item excluded from generated/dropped counts | PASS | Same script output (`e1` failure: generatedCount 0, droppedItems 0) |
| `buildEvaluationReport` — historical correlation join | Empty historical array -> `null` rates, not fabricated `0` | PASS | Same script output (all `historicalHumanEditedRate`/`historicalFinalizedRate` null) |
| `GenerationEvaluationService.run` — real e2e (real MySQL, real tenant, real port interface via fake) | QA-authored e2e spec (see Investigation point 2) | PASS (proves feasibility nexus-dev did not attempt) | Test run transcript, this report |
| CONFIDENCE_BANDS rename (BANDS -> CONFIDENCE_BANDS) non-breaking | Full unit suite incl. `confidence-calibration.spec.ts` | PASS | Full suite rerun, this report |
| Full API unit suite, no regressions | Rerun from scratch | PASS — 183/183 suites, 1588/1588 tests | Command output, this report |
| Typecheck (API workspace) | `npx tsc --noEmit` | PASS — clean | Command output, this report |
| CLI argv fail-fast (`--tenant` required) | Not independently re-run this pass; nexus-dev's own manual verification accepted as sufficient for this thin, low-risk path | Not independently re-tested (low risk) | N/A |
| Security self-review (no new HTTP endpoint, bounded AI-cost exposure, no secrets) | Independent code read of `evaluate-generation.ts`/`generation-evaluation.service.ts` | PASS — matches self-review | Code read, this report |
| Non-user-facing scope decision (no UI/HTTP endpoint) | Confirmed against backlog's own "Internal tooling... not user-facing" text and spec section 7.3's wording | PASS — correct scoping | Backlog BL-33 row, spec section 7.3 |
| Missing e2e coverage of `GenerationEvaluationService` (the service layer, not just the CLI) | Investigated whether genuinely unavoidable | **Was avoidable — see Investigation** | This report |

## Defect list

**D1 (non-blocking, but should be fixed on the next touch of this area).** No real-MySQL/
real-port-interface e2e test exists for `GenerationEvaluationService`, despite this being feasible
using the project's own established `overrideProvider(AI_SERVICE_PORT)` fake pattern (proven above).
The cited `migrate-tenants.ts` precedent does not actually support skipping this coverage, because
`TenantMigrationRunner` — the layer actually analogous to `GenerationEvaluationService` — has its
own dedicated 596-line real-MySQL e2e suite; only the thin CLI wrapper lacks one, and
`GenerationEvaluationService` is not a thin wrapper, it is the real orchestration logic (per-item
dispatch, per-item failure isolation, tenant-scoped historical correlation).
- **Severity: non-blocking for this pass.** Downgraded from a would-be blocking verdict because (a)
  the actual aggregation logic (`buildEvaluationReport`) is independently proven correct by both
  nexus-dev's own unit tests and QA's own independent fixture; (b) the service layer's orchestration
  (per-item dispatch by `contentType`, per-item failure isolation, real `calibrateConfidence` reuse)
  is also unit-tested with fakes, just not against a real DB/port interface; (c) this is genuinely
  internal, non-user-facing, deferred (P2) tooling with a fixed, small, bounded blast radius (a
  4-item golden set, never invoked from any application boot path, never reachable by an
  unauthenticated caller) — unlike the Dev-9a-class incidents this project's own history warns
  against, a defect here would surface immediately and loudly to the first engineer who runs
  `npm run evaluate:generation` (a non-zero exit / a visibly wrong JSON report), not silently in
  production against real user data.
- **Repro / how to fix:** Add an e2e spec (e.g.
  `apps/api/test/generation-evaluation.e2e-spec.ts`) following the exact pattern QA used in this
  investigation: `Test.createTestingModule({ imports: [AppModule], providers: [GeneratedQuestionRepository, ConfidenceCalibrationService, GenerationEvaluationService] }).overrideProvider(AI_SERVICE_PORT).useValue(fakeAiService()).overrideProvider(EMBEDDINGS_PORT).useValue(fakeEmbeddings())`,
  provision a real tenant, enter its scope via `TenantScopeService.runFor`, call
  `GenerationEvaluationService.run(tenantId)`, and assert the report's numeric fields against the
  fake's controlled responses.
- Not fixed by QA (per QA's mandate) — the investigation spec was written, run, proven, and then
  removed per test-hygiene rules; it is not left in the repository.

No other defects found. `buildEvaluationReport` is numerically correct on every scenario tested;
the CLI's documented scope decisions (fixed golden set, always-empty grounding, real
`AiServicePort`, tunable `--max-drop-rate` gate, no persistence) are all defensible readings of
spec section 7.3's own wording and BL-33's "internal tooling, not user-facing, deferred" framing.

## Verdict

**PASS — Dev-34 is QA-green, no blocking defects.**

The one gap found (D1, missing real-DB/real-port e2e coverage for `GenerationEvaluationService`) is
real and was avoidable — nexus-dev's "isn't possible in this sandbox" framing does not hold up under
independent investigation, and the `migrate-tenants.ts` precedent cited as justification does not
actually support skipping this specific layer's coverage. However, it is downgraded to non-blocking
for this pass because the logic it would have covered is independently proven correct by other
means (QA's own e2e spec plus independent aggregation-fixture verification), the tool is genuinely
internal/non-user-facing/low-blast-radius, and a defect here fails loudly rather than silently. This
should be treated as a documented, tracked follow-up (ideally picked up as a small addition next
time this file is touched) rather than a reason to send Dev-34 back for a retry.