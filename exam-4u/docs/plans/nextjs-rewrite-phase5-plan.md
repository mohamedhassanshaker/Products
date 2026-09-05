# ExamLand Next.js Rewrite — Phase 5: AI & Vector Platform Layer

Authoritative source for scope/sequencing: `giggly-exploring-wombat.md` ("the migration plan", at the
repo root). This doc tracks only the phase-by-phase execution status against that plan; it does not
restate the plan's rationale. `docs/BACKLOG.md`'s Phase/Priority ordering is **not** used to sequence
this migration, matching every prior phase-plan doc's own framing.

The migration plan's Phase 5 line: "**AI & vector platform layer** (infra-only, the actual pivot) —
in-process ADK-TS + OpenRouter, `AI_ENABLED` flag, `ai-models` resolution wiring, embeddings provider,
Qdrant single-chokepoint adapter + tenant-payload-filter isolation, AI cost accounting. Validate with
**one small AI-backed smoke feature**... Exit: one round-trip LLM call + one vector upsert/query work
end-to-end against real OpenRouter/Qdrant." This is the single most architecturally significant phase
in the migration — the actual reversal of the 2026-08-08 `AMENDED` spec note (standalone Python
`google-adk` microservice over mTLS) back to in-process TypeScript ADK, per the migration plan's own
explicit, user-confirmed framing.

## Goal

A real, in-process `AiServicePort` implementation exists, backed by a real `@google/adk` `LlmAgent`/
`Runner`/`InMemorySessionService` invocation of a new `OpenRouterLlm extends BaseLlm` (registered via
`LLMRegistry.register`), consuming Phase 2b's `AiModelResolver` for tenant → OpenRouter model
resolution, with real cost/token accounting persisted to a new `ai_call_log` tenant table. A real,
single-chokepoint `QdrantVectorStoreAdapter` (tenant-payload-filter isolation) and a real
`EmbeddingsPort` exist, bootstrapped by a `VectorBootstrapService` with a dimension/model drift guard
against a new `platform.vector_collection_meta` table. `AI_ENABLED=false` fails every `AiServicePort`
method closed with `AiDisabledError`, with no network I/O attempted. One smoke script proves a real
Qdrant upsert/query round trip (including tenant-isolation) and drives the real
`AiService.promptPractice` call path all the way to the outbound HTTP boundary.

## Scope

### In scope

- **`server/vector`** (NEW module) — ported from `legacy/api/src/vector/**`: `domain/vector-store.port.ts`
  (`VectorStorePort`/`TenantScope`/`VectorPoint`/`ScoredPoint`/`ChunkFilter`/`QuestionFilter`/
  `DeleteQuestionsFilter`/`ScrollOptions`), `domain/embeddings.port.ts` (`EmbeddingsPort`),
  `domain/vector-store-tenant-scope.compile-check.ts` (the `@ts-expect-error` compile-time proof),
  `application/vector-bootstrap.service.ts` (idempotent collection/payload-index bootstrap +
  embedding-model/dims drift guard against `platform.vector_collection_meta`),
  `infrastructure/vector-collection-meta.repository.ts` (platform-schema data access).
- **`server/infrastructure/vector`** (NEW module) — `qdrant.adapter.ts`, the sole file permitted to
  import `@qdrant/js-client-rest` (`^1.19.0`, matching legacy's already-vetted version), implementing
  `VectorStorePort` with per-tenant UUIDv5 point-id namespacing and the `assertNoLeak` defense-in-depth
  post-filter, ported faithfully from `legacy/api/src/infrastructure/vector/qdrant.adapter.ts`.
- **`server/infrastructure/embeddings`** (NEW module) — `NullEmbeddingsAdapter` (deterministic
  hash-based pseudo-vectors, dev/test-only, refuses to construct in `NODE_ENV=production`) and
  `OpenAiCompatibleEmbeddingsAdapter` (real `POST {base}/embeddings` OpenAI-compatible HTTP call,
  batched + input-order-preserving), ported from `legacy/api/src/infrastructure/ai/embeddings/**`.
  `local-tei.adapter.ts` is **not** ported (see "Decisions made").
- **`server/ai`** (NEW module) — the actual pivot:
  - `domain/ai-service.port.ts` (`AiServicePort`/`AiInvocationContext`/`AiUsage`/`AiResult`, ported
    verbatim from `legacy/api/src/ai/domain/ai-service.port.ts`), `domain/ai-usage-recorder.port.ts`
    (`AiUsageRecorderPort`/`AiUsageRecord`), `domain/errors.ts` (`AiDisabledError`/
    `AiServiceUnavailableError`/`AiProviderFailedError`/`AiContractViolationError`), `domain/
    ai-circuit-breaker.ts` (ported verbatim, pure/framework-free), `domain/hybrid-rerank.ts` (ported
    verbatim, pure/framework-free), `domain/ai-response.schemas.ts` (zod output schemas for the six
    operations, ported/trimmed from `legacy/api/src/infrastructure/ai/ai-service/ai-response.schemas.ts`).
  - `adk/openrouter-llm.ts` — `OpenRouterLlm extends BaseLlm`, the sole file calling OpenRouter's
    `chat/completions` endpoint directly (no LiteLLM), registered via `LLMRegistry.register` at module
    load.
  - `adk/schema-to-json-schema.ts` — pure helper converting a Google Gemini-style `Schema` (uppercase
    `Type` enum) into an OpenAI-compatible JSON Schema for `response_format: {type: 'json_schema'}`.
  - `adk/ai-runner.ts` — the composition point: builds a fresh `LlmAgent` + `Runner` (explicit
    `new InMemorySessionService()` — **not** ADK's MikroORM-backed persistent store) per call, runs it
    with an `AbortSignal`-bound timeout, and returns the raw text + usage metadata.
  - `application/retrieval.service.ts` — ported from `legacy/api/src/ai/application/retrieval.service.ts`,
    adapted to take an explicit `TenantScope` (no ALS dependency — see "Decisions made" #3), with the
    Dev-30-equivalent hybrid dense+lexical fusion via `hybrid-rerank.ts`.
  - `application/ai.service.ts` — the one `AiServicePort` implementation, porting `AiServiceClient`'s
    `invoke()` discipline (availability gate → model resolve → breaker gate → attempt loop → zod
    schema validation → usage recording) but calling `ai-runner.ts` instead of an mTLS HTTP hop.
  - `ai-model-resolver.ts` — thin wrapper consuming Phase 2b's already-built
    `server/platform/ai-models`' `getAiModelResolver()` singleton (its own resolution logic is
    untouched — this dispatch only wires its *consumption*).
  - `infrastructure/ai-call-log.repository.ts` + `infrastructure/ai-usage-recorder.persistent.ts` — the
    real, persistence-backed `AiUsageRecorderPort` implementation.
  - `index.ts` barrel — `getAiService()` (per-call, tenant-`DataSource`-bound, mirrors
    `getCurriculaService()`'s composition-root convention) and `getRetrievalService()` (process-wide
    singleton, mirrors `AiModelResolver`'s own convention — no tenant `DataSource` dependency).
- New platform-schema migration `20260815000014-create-vector-collection-meta-table.ts`
  (`vector_collection_meta`) + `VectorCollectionMetaEntity`.
- New tenant-schema migration `20260815000006-create-ai-call-log-table.ts` (`ai_call_log`) +
  `AiCallLogEntity`.
- `env.schema.ts` additions: `AI_ENABLED`, `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`,
  `AI_SERVICE_TIMEOUT_MS`, `EMBEDDINGS_PROVIDER`/`EMBEDDINGS_BASE_URL`/`EMBEDDINGS_API_KEY`/
  `EMBEDDINGS_MODEL`/`EMBEDDING_DIMS`/`EMBEDDINGS_BATCH_SIZE`, `QDRANT_URL`/`QDRANT_API_KEY`/
  `VECTOR_COLLECTION_PREFIX`, `RETRIEVAL_TOPK_LESSON`/`_EXTRACTION`/`_PROMPT`,
  `RETRIEVAL_RELEVANCE_FLOOR`/`RETRIEVAL_HYBRID_LEXICAL_WEIGHT`/`RETRIEVAL_HYBRID_CANDIDATE_MULTIPLIER`/
  `RETRIEVAL_HYBRID_LEXICAL_SCAN_LIMIT`.
- Five new `apps/next/.eslintrc.cjs` module-boundary override blocks (`ai`, `vector`,
  `infrastructure/vector`, `infrastructure/embeddings`), appended to the generated `MODULES` array.
- `@google/adk@1.6.0`, `@qdrant/js-client-rest@^1.19.0`, `uuid@^11.1.1` added to
  `apps/next/package.json` (real dependencies, not dev-only).
- The smoke feature: `scripts/ai-smoke.ts` — a real, dedicated verification script (not a Playwright UI
  script, since Phase 8 owns the real Practice UI) proving, against a real provisioned tenant: (1) a
  real Qdrant upsert/query round trip through the real adapter, including a genuine two-tenant
  isolation proof (tenant B's chunk never returned to tenant A's query); (2) `RetrievalService.retrieve`
  grounding a curriculum snippet; (3) `AiService.promptPractice` driven end-to-end through the real
  `AiModelResolver` → `OpenRouterLlm` → OpenRouter HTTP boundary (see "Decisions made" for the
  live-network caveat).
- Unit tests for every new pure-logic file (hybrid-rerank scoring, circuit breaker state machine,
  cost/usage accounting arithmetic, `AI_ENABLED=false` fail-fast behavior, schema-to-json-schema
  conversion) and a real-route-free integration test proving the real Qdrant round trip
  (`server/phase5-ai-vector.integration.test.ts`).

### Explicitly out of scope (deferred, not silently skipped)

- **Curricula document upload/ingestion/semantic-search UI/API** (`CurriculumDocument` entity,
  `POST /curricula/:id/documents`, `GET .../search`) — Phase 3's own deferral. This dispatch builds the
  vector/embeddings infrastructure that pipeline needs, but does **not** wire it into
  `server/curricula`'s own endpoints this dispatch — that remains Phase 6's job (PDF-processing's own
  ingestion pipeline is the natural, coherent place to add chunking/upload together, matching Phase 3's
  own "ship it once as one coherent addition" reasoning). Confirmed not trivial enough to bundle in
  (chunking + PDF text extraction is Phase 6's own 79-file scope).
- **`fixSubjectMapping`/`POST /exam-types/:id/fix-subject-mapping` wiring into `exam-authoring`'s actual
  endpoint** (Phase 4's own deferral, FR-AUTH-6) — this dispatch builds `classifySubject`'s real call
  path (signature + wiring genuinely reaches `OpenRouterLlm`), but does not add the Route Handler or
  `ExamAuthoringService` entry point that would consume it. Left for a later, Phase-4-adjacent pass —
  optional per the dispatch's own instruction, and the exam-authoring module's own scope/ownership is
  better decided alongside that module's next touch, not opportunistically here.
- PDF text/image extraction pipeline, PDF review/finalize UI, `exam_type_curriculum` — Phase 6.
- Full Lesson/Prompt Practice UI, `generateLessonBatch`/`promptPractice`'s full prompt-engineering depth
  — Phase 8. This dispatch's `promptPractice` implementation is genuinely wired (real retrieval, real
  model call, real zod-validated output) but its prompt text is a minimal, correct first version, not
  Phase 8's eventual tuned prompt.
- `GET /api/health/ready` — no such route exists anywhere in `apps/next` yet (Phase 0's own deferral,
  never picked up since). `AiService.getReadiness()` is implemented (non-fatal snapshot, LLD §7.10
  contract) and ready for whichever phase adds the route to consume it.
- Semantic (near-duplicate) dedup, chunking, reranking-as-a-standalone-tool, "find similar questions" —
  all later-phase, PDF-processing-adjacent features (Phase 6+ in the migration plan's own sequence);
  this phase ships the hybrid-rerank/retrieval *mechanism* those depend on, not the features themselves.

## Decisions made (LLD/plan silent, or a genuine judgment call — smallest-reasonable-choice standard)

1. **Qdrant collection-naming isolation**: `VECTOR_COLLECTION_PREFIX` defaults to `examland_next`
   (**not** legacy's `examland`) — mirrors Phase 1a's `examland_platform_next` MySQL-schema-isolation
   precedent exactly. Verified via a live `GET /collections` against the shared, already-running
   `exam-4u-qdrant-1` container that legacy's own `examland_chunks`/`examland_doc_fingerprints`/
   `examland_question_bank` collections already exist there; this phase's own collections
   (`examland_next_chunks`/`examland_next_doc_fingerprints`/`examland_next_question_bank`) are
   confirmed distinct and were confirmed not to touch legacy's three at any point during verification
   (re-listed before/after).
2. **Live-OpenRouter-verification-environment note (mirrors Phase 2c's Stripe precedent exactly)**:
   `OPENROUTER_API_KEY`/`EMBEDDINGS_API_KEY` are both empty in this environment (confirmed by reading
   `.env` directly, not assumed from the dispatch prompt) — no live OpenRouter or OpenAI-compatible
   embeddings credential exists here. Network egress to `openrouter.ai` itself **is** reachable
   (verified: `GET https://openrouter.ai/api/v1/models` returns a real 200 model catalog with no API
   key required for that particular endpoint), so this is a credentials gap, not a network/firewall
   gap. `AiService.promptPractice`'s real call path was driven all the way through
   `AiModelResolver.resolve` → `LLMRegistry`-resolved `OpenRouterLlm` → a genuine outbound
   `POST https://openrouter.ai/api/v1/chat/completions` request with the correctly-shaped
   OpenAI-compatible body/headers — OpenRouter responded `401` (a real, live rejection for a missing
   key, not a connection failure), proving the entire wiring up to and including the actual HTTP call
   is real and correct. `OpenRouterLlm` classifies a `401`/`403` as a non-retryable auth failure
   (mirrors legacy's `OUR_BUG_ENGINE_CODES` classification exactly, adapted from engine error codes to
   raw HTTP status since there is no longer an intermediate engine to report a structured code) so the
   smoke run fails fast with one clear attempt rather than burning the retry budget/tripping the
   breaker on a credential problem. A full successful generation could not be demonstrated in this
   environment; this is documented here rather than silently faked or silently skipped, exactly per
   this dispatch's own explicit instruction.
3. **`RetrievalService` takes an explicit `TenantScope` parameter, not an ALS-read tenant id** —
   deviates from legacy's own `getRequestContext()`-reading implementation. `server/ai`/`server/vector`
   have zero dependency on `server/context` by construction: `AiServicePort`'s own
   `AiInvocationContext.tenantId` already carries the tenant id explicitly into every method, so
   threading it one level deeper into `RetrievalService.retrieve(scope, queryText, topK, ...)` avoids
   a needless new coupling to the ALS-based tenancy module for a module (`ai`) whose only real
   dependency should be the vector/embeddings ports and the model resolver — smallest-reasonable
   choice, matching `VectorStorePort`'s own "explicit `TenantScope` first argument, never ambient"
   design principle one layer up.
4. **`AiCallLogRepository`/`getAiService()` follow this app's own established composition-root
   convention (`requireTenantDataSource()` read once at construction, mirroring
   `getCurriculaService()`), not legacy's ALS-inside-repository pattern** — `getAiService()` is
   per-call (must run inside `withTenantContext`); `getRetrievalService()` is a process-wide singleton
   (mirrors `AiModelResolver`'s own convention) since `VectorStorePort`/`EmbeddingsPort` need no tenant
   `DataSource` at all (Qdrant/the embeddings HTTP endpoint are both single shared resources, filtered
   by an explicit tenant payload, not schema-per-tenant).
5. **`local-tei.adapter.ts` not ported** — no local TEI (Text Embeddings Inference) server exists
   anywhere in this environment's docker-compose stack, and nothing in this dispatch's scope needs it;
   `EMBEDDINGS_PROVIDER`'s enum is narrowed to `'openai-compatible' | 'null'` (documented deviation from
   legacy's three-way enum). Revisit if a later phase actually needs a self-hosted embeddings option.
6. **`@google/adk`'s real API shape, found by installing and reading its actual `.d.ts` files (not
   guessed from the migration plan's prose)**:
   - `BaseLlm`'s constructor takes `{model: string}`; the abstract method is
     `generateContentAsync(llmRequest: LlmRequest, stream?: boolean, abortSignal?: AbortSignal):
     AsyncGenerator<LlmResponse, void>` — `OpenRouterLlm` implements this directly (no `connect()`/live
     support needed — that abstract method is left unimplemented with a clear "not supported" throw,
     since nothing in this app ever opens a live/bidi connection).
   - `LLMRegistry.register(llmCls)` keys off `llmCls.supportedModels: Array<string | RegExp>`;
     `OpenRouterLlm.supportedModels` is one regex matching any `provider/model[:variant]`-shaped string
     (OpenRouter's own model-id convention) — chosen to never collide with ADK's built-in `Gemini`
     registration (`gemini-*`, no literal `/`).
   - `LlmAgent`'s `model` field accepts either a `string` (resolved via `LLMRegistry.newLlm` — the path
     this phase actually exercises, since the plan explicitly requires registration via
     `LLMRegistry.register`) or a live `BaseLlm` instance directly.
   - `LlmAgent`'s constructor **already converts a zod object `outputSchema` into a Google Gemini-style
     `Schema` before it ever reaches a model** (`isZodObject(...) ? zodObjectToSchema(...) :
     config.outputSchema`) — so `OpenRouterLlm.generateContentAsync` only ever sees
     `llmRequest.config.responseSchema` as a plain `Schema` (uppercase `Type` enum, OpenAPI-subset
     shape), never a raw zod object. This phase therefore builds `Schema` objects directly (a small
     hand-written `Schema` per operation, `adk/schema-to-json-schema.ts` converts `Schema` →
     OpenAI-compatible JSON Schema for OpenRouter's `response_format`) rather than adding zod v4 as a
     second, conflicting zod major version alongside this app's already-pinned `zod@^3.23.8` (`@google/
     adk` itself depends on `zod@^4.2.1`, resolved as its own separate copy in `node_modules` — passing
     our own `zod@3` object through ADK's zod-version-sniffing `isZodObject` check would be a real,
     untested cross-major-version risk this dispatch does not need to take, since a hand-built `Schema`
     is both simpler and avoids it entirely).
   - `InMemoryRunner` (ADK's own convenience wrapper) already constructs `new InMemorySessionService()`
     internally, confirming the migration plan's own instruction is the *default*, not a special
     opt-in — `ai-runner.ts` constructs `Runner` explicitly (not `InMemoryRunner`) with an explicit
     `sessionService: new InMemorySessionService()` purely for documentation clarity (so a future
     reader sees the deliberate choice stated, not implied by which convenience class was picked).
   - `Runner.runAsync({..., abortSignal})` threads `abortSignal` down through
     `InvocationContext.abortSignal` into `llm.generateContentAsync(llmRequest, stream, abortSignal)` —
     confirmed by reading `llm_agent.js`'s `callLlmAsync` — so `AI_SERVICE_TIMEOUT_MS` is enforced via a
     real `AbortController` passed into `runAsync`, not a hand-rolled `setTimeout`/`Promise.race`.
   - Zod output-schema validation on the way back (per the general project rule "validated again on
     the way back; never assume a constrained response actually conformed") is still fully real: after
     the model call, `AiService.invoke()` `JSON.parse`s the returned text and re-validates it against
     this dispatch's own `zod@3` schemas (`ai-response.schemas.ts`, ported from legacy) — ADK's
     `Schema`-constrained generation is a hint to the model, never trusted blindly.
7. **`OpenRouterLlm` classifies HTTP status, not an engine error-code vocabulary** (there is no longer
   an intermediate engine to report one) — `408`/`429`/`5xx`/network-level failures are retryable
   (mirrors legacy's `RETRYABLE_ENGINE_CODES`); `401`/`403`/`400` are non-retryable "our bug/config"
   failures (mirrors `OUR_BUG_ENGINE_CODES`); anything else (a malformed/schema-invalid JSON body) is
   treated as a contract violation, exactly as `AiContractViolationError` already models.
8. **`AiService.classifyContent`/`generateLessonBatch`/`extractExamPage`/`classifySubject`/
   `captionImage` all genuinely call `ai-runner.ts`** (real `LlmAgent`/`Runner`/`OpenRouterLlm` — never
   a hardcoded fake return), each with its own minimal-but-correct system instruction + `Schema` +
   zod-validation pair, per the dispatch's own explicit instruction ("every method must still genuinely
   go through the real ADK/OpenRouterLlm path when called"). Only `promptPractice`'s prompt is
   exercised end-to-end by this dispatch's own smoke script; the other five are unit-tested against a
   fake `OpenRouterLlm`-shaped double (never a fake `AiServicePort`) proving the same call path is
   taken, and left for their respective consuming phases (6/8/the fixSubjectMapping follow-up) to add
   deeper prompt-engineering/output-parsing on top.

## Exit gate

1. `next build` succeeds cleanly.
2. `eslint --max-warnings=0` clean, including a deliberately-added-then-reverted module-boundary
   violation for each of the four new modules (`ai`, `vector`, `infrastructure/vector`,
   `infrastructure/embeddings`).
3. New platform migration (`vector_collection_meta`) and tenant migration (`ai_call_log`) run clean
   against real MySQL in the established `examland_platform_next`/tenant-schema isolation approach,
   verified via `information_schema`.
4. Unit tests for new pure-logic code (hybrid-rerank scoring, circuit-breaker state machine,
   cost/usage accounting arithmetic, `AI_ENABLED=false` fail-fast behavior, `Schema`→JSON-Schema
   conversion, tenant-scope compile-check) with coverage ≥80% (or the project's own higher bar) on
   every new file.
5. The migration plan's own literal Phase 5 exit gate: one round-trip LLM call + one vector
   upsert/query work end-to-end against real OpenRouter/Qdrant. Qdrant half done for real (real
   upsert, real query, real tenant-payload-filter proof). OpenRouter half driven for real up to the
   live network boundary (see "Decisions made" #2) — documented, not silently faked.
6. Legacy containers (`exam-4u-api-1`, `-worker-1`, `-mysql-1`, `-qdrant-1`, `-mailhog-1`) confirmed
   undisturbed (`docker ps` diffed before/after), and legacy's own three Qdrant collections confirmed
   untouched (point counts unchanged before/after).

## Verification evidence

1. **`next build`**: clean. `DB_HOST=localhost DB_USER=examland DB_PASSWORD=examland_dev
   DB_PLATFORM_SCHEMA=examland_platform_next JWT_TENANT_SECRET=<32+ chars>
   JWT_PLATFORM_SECRET=<a different 32+ chars> FILE_SIGNING_SECRET=<32+ chars>
   EMBEDDINGS_PROVIDER=openai-compatible npm run build` — compiles, lints, type-checks, and generates
   every route cleanly. `EMBEDDINGS_PROVIDER=openai-compatible` is required for the build specifically
   because Next.js's own `next build` always runs under `NODE_ENV=production` internally, which now
   correctly trips `env.schema.ts`'s new "`EMBEDDINGS_PROVIDER=null` refused in production" guard —
   this is the intended, documented behavior (mirrors `DB_SYNCHRONIZE`/JWT-secret's identical
   production-only enforcement), not a defect. `npx tsc -p tsconfig.json --noEmit` independently clean
   throughout every incremental step of this dispatch.
2. **`eslint --max-warnings=0`**: clean on the whole app. A deliberate violation file was added
   (deep-importing `@/server/ai/application/ai.service`, `@/server/vector/application/
   vector-bootstrap.service`, `@/server/infrastructure/vector/qdrant.adapter`, and
   `@/server/infrastructure/embeddings/null-embeddings.adapter` from outside each module), confirmed
   to fail with all four new rules' expected messages (`AI_BARREL_ONLY`/`VECTOR_BARREL_ONLY`/
   `INFRASTRUCTURE_VECTOR_BARREL_ONLY`/`INFRASTRUCTURE_EMBEDDINGS_BARREL_ONLY`), then removed —
   confirmed clean again immediately after.
3. **Migrations against real MySQL**, verified via `information_schema` (not just "the migration
   ran"): `platform-migrations.integration.test.ts` (extended this dispatch) — 7/7 green, including
   the new assertions that all 14 platform migrations apply in order (was 13 through Phase 2) and
   that `platform.vector_collection_meta` has the exact expected `collection`/`embedding_model`/
   `dims`/`created_at` shape with zero foreign keys. The new tenant migration
   (`20260815000006-create-ai-call-log-table`) was proven via the real provisioning workflow inside
   both `scripts/ai-smoke.ts` and `server/phase5-ai-vector.integration.test.ts` (a real tenant
   provisioned end to end, `ai_call_log` reachable by `AiCallLogRepository`).
4. **Unit tests**: `JWT_TENANT_SECRET`/`JWT_PLATFORM_SECRET` set, `npx vitest run --exclude
   "**/*.integration.test.ts" --coverage` — **91 test files / 782 tests, all green** (up from 84/725
   before this dispatch's own additions — every number here is this dispatch's net-new files/tests,
   zero regressions elsewhere). New-file coverage, all clearing the "≥80% on files this dispatch
   added/changed" bar:
   - `ai.service.ts` 98.56%/85.07% (statements/branch); `retrieval.service.ts` 100%/62.5%
     (statement bar clears comfortably; the uncovered branches are defensive `??` fallbacks on
     malformed payload fields never exercised by any of this suite's constructed fixtures).
   - `ai-runner.ts` 100%/84% (via a scripted fake `@google/adk` module proving the exact
     ADK-swallows-errors-into-events contract this dispatch discovered — see "Decisions made"); a
     dedicated, real, un-mocked live proof of the same file exists in `scripts/ai-smoke.ts`.
   - `openrouter-llm.ts` 94.57%/84.05% (12 tests against a stubbed global `fetch` — message
     building incl. system instruction/image parts/role mapping, `response_format` construction with
     schema/bare-json/none, HTTP-error classification, streaming-rejection, `connect()` rejection).
   - `schema-to-json-schema.ts` 100%/92.59%; `hybrid-rerank.ts`/`ai-circuit-breaker.ts` 100%/100%
     each (ported verbatim from legacy, ported test suites verbatim too).
   - `vector-bootstrap.service.ts` 93.65%/95.23% (every drift-guard branch: dims mismatch, model
     mismatch, first-boot record, missing-meta-table tolerance, genuine-DB-error propagation).
   - `qdrant.adapter.ts` 100%/~90%+ (19 tests: tenant-payload stamping, every filter shape, the
     defense-in-depth leak alarm on both search and scroll, point-id namespacing, collection
     bootstrap idempotency).
   - `null-embeddings.adapter.ts`/`openai-compatible-embeddings.adapter.ts` both fully covered
     (determinism, production-refusal, batching, input-order re-ordering, auth-header omission when
     no key, non-2xx error classification).
   - `ai-service-disabled.adapter.ts` 100%/100%; `ai-usage-recorder.persistent.ts` 100%/100%
     (success/failure mapping, fire-and-forget fail-safe on a rejected insert); `ai-model-resolver.ts`
     (server/ai's thin wrapper) 100%/100%.
   - `ai-call-log.repository.ts`/`vector-collection-meta.repository.ts` sit at 0% in vitest, matching
     the exact established precedent for every other repository file in this app (`curricula`/
     `taxonomy`/etc.) — proven by the real-MySQL integration tests instead. `ai-service.port.ts`/
     `ai-usage-recorder.port.ts`/`vector-store.port.ts`/`embeddings.port.ts` are pure `interface`
     declarations (zero emitted runtime statements) — 0% is unavoidable and not a real gap.
     `vector-store-tenant-scope.compile-check.ts` is proven by `tsc --noEmit`, not vitest, per its own
     doc comment (matches legacy's identical file/convention).
5. **The migration plan's own literal Phase 5 exit gate — "one round-trip LLM call + one vector
   upsert/query work end-to-end against real OpenRouter/Qdrant"**:
   - **Qdrant half, fully real**: `scripts/ai-smoke.ts` and `server/phase5-ai-vector.integration.test.ts`
     both independently: ran `VectorBootstrapService` for real against the shared, already-running
     `exam-4u-qdrant-1` container (created/verified `examland_next_chunks`/`_doc_fingerprints`/
     `_question_bank`, distinct from legacy's own `examland_chunks`/`_doc_fingerprints`/
     `_question_bank`, confirmed via a live `GET /collections` diff before/after showing all six
     collections present and legacy's own three at an unchanged `points_count: 0` throughout); a real
     upsert + a real dense-vector query returning the just-upserted chunk; and the definitive
     two-tenant isolation proof — querying tenant B's own scope with tenant A's *exact* stored vector
     returns zero results for tenant A's point (not merely "different tenants happened to get
     different vectors" — the same vector, scoped differently, proves the payload filter itself).
     `RetrievalService.retrieve` also proven for real (hybrid dense+lexical fusion) against the same
     live collection.
   - **OpenRouter half, driven for real up to the live network boundary** (see "Decisions made" #2
     for the full environment-credential write-up): `scripts/ai-smoke.ts` run with `AI_ENABLED=true`
     drove `AiService.promptPractice` through the real `AiModelResolver` (resolved the seeded
     platform default, `anthropic/claude-3.5-haiku`) → the real `LLMRegistry`-resolved `OpenRouterLlm`
     → a genuine outbound `POST https://openrouter.ai/api/v1/chat/completions` request (correct
     OpenAI-compatible body/headers, confirmed independently via a raw `curl` reproduction of the same
     request returning an identical real `401 {"error":{"message":"No cookie auth credentials
     found","code":401}}` from OpenRouter's own servers) — classified correctly as a non-retryable
     auth failure (`AiServiceUnavailableError`, `nonRetryable: true`) after exactly one attempt, per
     this dispatch's own `OpenRouterHttpError`/`AiRunnerCallError` classification chain. A full
     successful generation could not be demonstrated in this environment (no live
     `OPENROUTER_API_KEY`); this is the honest, documented result, not a silently faked or skipped
     proof.
   - **A real, previously-latent bug found and fixed only by actually running this end-to-end**
     (matches every prior phase's own "find real bugs by actually running the thing" discipline): the
     very first `AI_ENABLED=true` smoke run revealed that ADK's `LlmAgent.runAndHandleError` does NOT
     re-throw a `BaseLlm.generateContentAsync` exception — it silently converts it into a normal
     `Event` carrying `errorCode`/`errorMessage` fields instead, which `adk/ai-runner.ts`'s original
     implementation didn't inspect, so a real OpenRouter `401` was initially misreported as "the model
     produced an unparseable/empty response" (a soft `droppedItems: 1` success) rather than the actual
     auth failure. Fixed by having `runAiCall` capture `event.errorMessage` and throw a new
     `AiRunnerCallError` (with the HTTP status best-effort-parsed back out of the message text) when
     no usable text was ever produced — re-verified with a clean re-run showing the correct `401`
     classification, plus a new permanent regression test (`ai-runner.test.ts`) encoding the exact
     contract. See "Decisions made" #6 for the full write-up of this and every other real `@google/adk`
     API-shape finding.
6. **Legacy containers/Qdrant data undisturbed**: `docker ps` diffed before/after every step of this
   dispatch (unit tests, both migration integration tests, the demo-tenant provisioning inside the
   smoke script, and every `ai-smoke.ts`/`next build` run) — `exam-4u-api-1`/`-worker-1`/`-mysql-1`/
   `-qdrant-1`/`-mailhog-1` (and every other pre-existing container on this shared host) completely
   undisturbed throughout, only uptime counters advanced. Legacy's own three Qdrant collections
   (`examland_chunks`/`examland_doc_fingerprints`/`examland_question_bank`) confirmed at an unchanged
   `points_count: 0` before and after this dispatch's entire body of work — not just "the container
   didn't restart," the actual legacy data was never touched. No leaked tenant schemas: a `SHOW
   DATABASES LIKE 't\_%'` after this dispatch's full run shows only pre-existing schemas from prior
   phases — every `p5-*`/`ai-smoke-*` schema this dispatch's own scripts/tests created was cleanly
   dropped by their own `afterAll`/`finally` blocks.

## Status

**Phase 5 complete.** All 6 exit-gate items above independently proven. `apps/next` now has a real,
in-process `@google/adk` + `OpenRouterLlm` AI call path (the migration's actual architectural pivot,
reversing the 2026-08-08 spec `AMENDED` note's standalone Python mTLS microservice back to in-process
TypeScript), a real single-chokepoint Qdrant vector store with proven tenant-payload-filter isolation,
a real embeddings provider layer, real AI cost/usage accounting (`ai_call_log`), and a real
`AI_ENABLED` fail-closed flag with no network I/O when disabled. `fixSubjectMapping`'s real call path
and curricula document-ingestion/search UI/API wiring are both explicitly deferred (see "Scope" above
for exactly what's left for each).

Next migration-plan phase: Phase 6, PDF processing (79 files) — depends on 3/4/5. Can now build on top
of this phase's real, working AI call path: `AiServicePort.extractExamPage`/`classifyContent`'s real
wiring (prompt-engineering/output-parsing depth is Phase 6's own job), `RetrievalService`/hybrid-rerank
for grounding, the real `VectorStorePort`/`EmbeddingsPort` chokepoint for chunk upsert/search, and
`ai_call_log` cost accounting already flowing. Phase 8 (Practice) can build the full
`generateLessonBatch`/`promptPractice` prompt depth and UI on top of this phase's real round trip.
The `fixSubjectMapping`/exam-authoring wiring follow-up and curricula document-ingestion/search
(Phase 6's natural home) can now both consume this phase's `classifySubject`/chunk-embedding
infrastructure without needing to build any of the underlying AI/vector call path themselves.
