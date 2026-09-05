# QA Report -- Dev-36 (BL-35: Image-aware RAG) + NODE_OPTIONS follow-up investigation

Date: 2026-08-12
Scope: Dev-36 only (image-aware RAG / vision captioning into retrieval) and the
follow-up investigation that root-caused the 16/33 pdf-processing.service.spec.ts
failures as a NODE_OPTIONS invocation issue, plus the new jest globalSetup guard.
Dev-30..Dev-35 already QA-green and out of scope (no code in this phase's diff
touches them beyond the sixth AI operation's additive plumbing).

## Environment
- apps/api unit suite: `npm run test` (Jest, ts-jest, NODE_OPTIONS=--experimental-vm-modules
  via cross-env, per package.json script).
- apps/api e2e suite: `DB_USER=root DB_PASSWORD=YourPassword npm run test:e2e -- --runInBand`
  against live Docker containers `examland-mysql` (127.0.0.1:3306) and `examland-qdrant`
  (127.0.0.1:6333), both already running in this environment.
- Independent QA scenario: a scratch e2e spec (`apps/api/test/qa-independent-imgrag.e2e-spec.ts`),
  written, run, and deleted by QA -- never committed, own fixture/keyword, not nexus-dev's.

## 1. NODE_OPTIONS root-cause claim and the new guard -- independently re-verified

- `apps/api/jest.global-setup.js` read directly: hard-fails in `globalSetup` with an
  actionable message when neither `process.execArgv` nor `NODE_OPTIONS` contains
  `--experimental-vm-modules`. Wired into both `apps/api/jest.config.js` and
  `apps/api/test/jest-e2e.json`.
- Ran `npx jest src/modules/pdf-processing/application/pdf-processing.service.spec.ts`
  (bare, no flag) myself: failed in 3.86s with the exact actionable message (not 16
  mystery timeouts). Confirmed.
- Ran the same file correctly (`cross-env NODE_OPTIONS=--experimental-vm-modules npx jest
  <path>`): 33/33 passed in 6.9s. Confirmed.
- Re-ran the full apps/api unit suite via `npm run test`: 184/184 suites, 1605/1605
  tests passed -- exact match to nexus-dev's reported numbers.
- Re-ran the full apps/api e2e suite via `npm run test:e2e -- --runInBand`, run alone
  (see note below): 52/52 suites, 384/384 tests passed -- exact match to nexus-dev's
  reported numbers.
- Process note (not a product defect, but worth recording for future QA passes): an
  earlier e2e attempt in this same QA pass, run concurrently with a separate QA-authored
  e2e spec against the same MySQL container, produced 5 failed suites / 14 failed tests,
  all `ensureSchemaExists`/tenant-provisioning `beforeAll` hook timeouts (5000ms) -- this
  is the exact "container saturated by concurrent app boots" pattern nexus-dev's own
  decision-log entry already documents and warns about. A clean, serial, unaccompanied
  re-run was 100% green. This independently reproduces and reinforces (rather than
  contradicts) nexus-dev's own finding: this failure mode is a real, reproducible artifact
  of concurrent load on the shared MySQL container, not a pdf-processing or Dev-36 defect.
- Verdict: the NODE_OPTIONS root-cause diagnosis is correct, and the globalSetup guard
  genuinely closes this specific false-alarm class. Any future bare `npx jest` invocation
  now fails immediately and unambiguously rather than producing misleading timeouts.

## 2. Vision-captioning contract correctness

- Python: `agents/image_caption.py` builds `ImagePayload` from `input_.imageBase64`/
  `mimeType` and calls `run_single_object(..., image=image)`; `llm/openrouter_client.py`'s
  `ImagePayload`/`_call_once` append the image via `google.genai.types.Part.from_bytes`
  as an additional Content part -- additive, no existing text-only call path touched.
  `agents/factory.py` dispatches `AiOperation.CAPTION_IMAGE -> image_caption.run`.
  `api/routes_ai.py`'s new `POST /v1/ai/caption-image` route is attached to the same
  `router = APIRouter(prefix="/v1/ai", dependencies=V1_DEPENDENCIES)` as the other five --
  confirmed by direct read, mTLS/bearer inherited structurally, cannot be forgotten.
- NestJS: `AiServicePort.captionImage` follows the exact same per-operation method
  convention as the other five (typed in/out, same `AiResult<T>`/`AiInvocationContext`
  shape); `AiServiceClient.captionImage` is a one-line wrapper over the same private
  `invoke()` chokepoint every other operation uses (no new retry/breaker/TLS logic);
  `AiServiceDisabledAdapter.captionImage` throws `AiDisabledError` identically.
  `zImageCaptionOut` validated at the boundary like every other operation's schema.
- Contract-test coverage confirmed equal, not lesser: `ai-service.contract.spec.ts`
  asserts "finds all six shared fixture files" (`caption-image.json` alongside the
  original five) and validates each fixture's response against this side's boundary
  schema -- ran this spec directly, passing. Python's `test_routes_ai.py` has both a
  vision-success round-trip test and a non-image-MIME-type rejection test for
  `caption-image`. `ai-service.client.mtls.spec.ts`'s real-TLS-handshake tests are
  operation-agnostic (they exercise `AiServiceClient`'s transport layer generically),
  so `caption-image` inherits identical mTLS coverage automatically via the shared
  `invoke()` chokepoint -- verified by reading the spec file directly.
- Verdict: genuinely matches Dev-14's established contract convention, extended to a
  sixth operation, not a divergent ad hoc shape.

## 3. Image-aware RAG -- independently constructed own scenario

Wrote and ran (then deleted) my own e2e spec, deliberately not reusing nexus-dev's
fixture content or the "zorbryndrix" keyword:
- Page text: "a history of 19th century trans-continental trade routes and tariff
  negotiations between empires" (real `pdfkit`-generated PDF with a real embedded PNG).
- Mocked `AiServicePort.captionImage` caption: "A schematic diagram of a
  plexovantor gear-driven pressure regulator, showing labeled valves." -- a keyword
  never present in the page text.
- Positive proof: `RetrievalService.retrieve({curriculumId}, 'plexovantor', 5)` (the
  same chokepoint lesson generation/exam extraction/Prompt Practice all call) returned
  a hit whose text is the caption itself (`not.toContain('tariff')` confirmed it is not
  the page-text chunk).
- Ran against live MySQL/Qdrant, real `pdf-parse` extraction, only the AI-engine HTTP
  transport and embedding vectors faked (matching the project's own established e2e
  convention for this class of test).
- Result: PASS. The headline exit-gate genuinely holds under an independently
  authored scenario, not just nexus-dev's own fixture.
- Minor non-blocking QA-design note: a symmetric "page-text query never surfaces the
  caption chunk" assertion could not be made reliably in this tiny (2-chunk) fixture
  corpus with deterministic hash-based fake embeddings (no real semantic discrimination
  at that scale) -- not a product defect, just an artifact of a minimal test corpus; not
  worth pursuing further given nexus-dev's own e2e already demonstrates the converse
  direction (`toContain(CAPTION_ONLY_KEYWORD)`/`not.toContain('mitochondria')`) which is
  the decisive proof.

## 4. Graceful degradation -- independently re-confirmed

Second scenario in my own scratch spec: `captionImage` mocked to reject with
`AI_SERVICE_UNAVAILABLE (simulated)`.
- PDF processing session reached `Completed` (never `Failed`) despite the captioning
  failure.
- `stored_image.generated_alt_text` remained NULL for every image (captioning never
  wrote a caption) -- read via direct MySQL query.
- Confirmed by code read: `ImageCaptioningService.captionAndIndex` wraps the AI call in
  try/catch, logs, and returns `null`; `ImageExtractionService.extractAndAssociate`
  treats `null` as "keep the pre-existing placeholder alt text" and never propagates the
  failure into `PdfProcessingService`'s outer catch (documented in-code, matches
  Dev-25a's own established best-effort convention).
- Note: my fixture used a Reference-classified session, which never generates
  `generated_question` rows, so `question_image` legitimately stayed empty -- this is
  expected pipeline behavior (image-to-question association only applies to
  Lesson/Exam-classified sessions with generated questions), not a defect; I dropped an
  overly strict assertion I had originally written against that table once I understood
  this.
- Verdict: Dev-25a's already-QA-green graceful-degradation behavior is intact.

## 5. Zero regression to RetrievalService -- confirmed via code read

Read `apps/api/src/ai/application/retrieval.service.ts` in full: it is payload-shape-
agnostic -- `toRetrievedChunk` reads `text`/`fileName`/`pageNumber` off an untyped
`Record<string, unknown>` payload regardless of who wrote it. `ImageCaptioningService
.indexCaptionChunk` upserts using exactly this same payload vocabulary
(`curriculumId`/`documentId`/`pageNumber`/`fileName`/`text`/`embeddingModel`), plus two
additive fields (`isImageCaption`/`imageId`) `RetrievalService` never reads. Dev-30's
hybrid-rerank/relevance-floor pipeline (`mergeCandidates`/`rerankFuseAndFilter`) operates
identically on any point regardless of origin -- confirmed both by code read and by my
own e2e scenario, where the caption-derived chunk was correctly retrieved through the
full hybrid dense+lexical+relevance-floor path with zero special-casing.
Verdict: RetrievalService genuinely needed zero changes; confirmed, not just claimed.

## 6. mTLS/contract test coverage

See section 2 above -- confirmed equal coverage to the original five operations (shared
fixture set, generic mTLS transport tests, dedicated Python integration tests for both
the success and rejection path).

## 7. Full suite re-run (correct invocation)

| Suite | Result |
|---|---|
| apps/api unit | 184/184 suites, 1605/1605 tests -- PASS |
| apps/api e2e | 52/52 suites, 384/384 tests -- PASS (clean serial run) |

Both match nexus-dev's own reported numbers exactly.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| BL-35 exit gate: image content becomes discoverable via RAG | Own independently-authored e2e scenario (distinct fixture/keyword) via RetrievalService | PASS | Section 3 |
| Dev-14 contract convention extended correctly to a 6th op | Contract fixture parity test, Python routing/dispatch code read, NestJS port/client/disabled code read | PASS | Section 2 |
| mTLS coverage for new operation | ai-service.client.mtls.spec.ts (generic), ai-service.contract.spec.ts, test_routes_ai.py | PASS | Sections 2, 6 |
| Graceful degradation on captioning failure | Own e2e scenario, AI_SERVICE_UNAVAILABLE simulated | PASS | Section 4 |
| Zero RetrievalService regression / Dev-30 hybrid-rerank works on caption chunks | Code read + own e2e scenario retrieval through full hybrid path | PASS | Section 5 |
| NODE_OPTIONS root cause + globalSetup guard closes the false-alarm class | Bare npx jest (fast, clear fail) + correct invocation (33/33) + full suite re-runs | PASS | Section 1 |
| Full regression (unit + e2e) | npm run test / npm run test:e2e, correct invocation | PASS (184/1605, 52/384) | Section 7 |

No requirement in scope was left untested.

## Defects

None found. No blocking defects. No non-blocking defects specific to Dev-36's own code
(the process-integrity note in Section 1 about concurrent-load e2e contention is an
environmental/testing-methodology observation reinforcing nexus-dev's own prior finding,
not a new product defect, and does not require any code change).

## Verdict

PASS -- Dev-36 (BL-35) is QA-green. No blocking defects. The image-aware RAG exit
gate genuinely holds under an independently constructed scenario. The NODE_OPTIONS
root-cause diagnosis and the new `jest.global-setup.js` guard are independently
re-verified and conclusively close this specific recurring false-alarm class going
forward -- a bare `npx jest` invocation now fails fast and unambiguously instead of
producing misleading test timeouts.
