# QA Report - Phase 4, apps/agent Python deployable (BL-013-BL-016)

**Date:** 2026-08-19
**Scope:** Python agent deployable (`apps/agent`) - FR-STT-1..4, FR-LLM-1..4, FR-TTS-1..4,
FR-AGENT-1..5, plus cross-cutting AI-boundary/residency/secrets/import-linter checks per
the dispatch's verify-immediately list. Read-only awareness of `packages/contracts` and the
TS half of the cross-language contract test (`apps/api/src/modules/deployment-config/domain/agent-config-cross-language.contract.spec.ts`)
to verify the shared fixture test; the TS `/internal` API and Angular captions work are out
of this QA pass's scope (parallel agents/dispatches).

**Environment:** Windows sandbox, no Docker/LiveKit/Postgres reachable (same carried-forward
limitation as every prior phase). Built a real Python 3.13 venv and installed `apps/agent`
editable with its full `[dev]` extras (real `openai`, `anthropic`, `google-genai`,
`deepgram-sdk`, `faster-whisper`, `elevenlabs`, `livekit-agents`, `langgraph`, `pydantic-ai`
- not stubs). Ran the real backend Jest suite for the TS half of the contract test via
`pnpm install` + `npx jest` in `apps/api` (no live Postgres needed for this particular spec -
it's pure schema validation, no DB).

## Full regression (independently re-run, not trusted from dev's claim)

| Check | Dev claim | QA result |
|---|---|---|
| `pytest` | 141/141 passed | Confirmed: 141 passed |
| Coverage | 90% | Confirmed: 89.84% (rounds to 90%), fail_under=80 gate passes |
| `ruff check .` | clean | Confirmed: "All checks passed!" |
| `lint-imports` (import-linter) | 3/3 contracts kept | Confirmed: 3 kept, 0 broken (82 files, 220 dependencies) |

## Verify-immediately items

### 1. AI/vendor-SDK boundary
- Grepped the entire `apps/agent` tree: `openai`/`anthropic`/`google.genai`/`deepgram`/
  `faster_whisper`/`elevenlabs`/`bithuman` imports appear only inside `adapters/**`.
  Confirmed by `lint-imports` (vendor-sdk-isolation + orchestration-uses-ports contracts
  kept) and by direct grep.
- `apps/api` (TypeScript): grepped for openai/anthropic/google-genai/google-generative/
  deepgram/elevenlabs - zero SDK imports; the only hits are the literal string enum values
  openai/anthropic/google and deepgram/faster-whisper used as logical
  provider-key discriminants in `get-runtime-config.use-case.ts`, not SDK imports. Clean.
- However, see D-3 below: the `allow_indirect_imports=True` setting on the
  `vendor-sdk-isolation` contract is a genuine, reproducible loophole in the guardrail
  itself (independently proven with a live probe), even though the current codebase does
  not exploit it.

### 2. Residency enforcement (compliance-critical)
- `residency/filter.py`'s `build_payload` is genuinely the sole path to a `ResidencyPayload`
  - `ILLMProvider.complete_stream`/`complete_structured` accept no other shape, and every
  LLM adapter (`openai.py`, `anthropic.py`, `google.py`) builds its vendor-shaped message
  list exclusively from residency.system_prompt/residency.messages/residency.retrieved_chunks,
  never from the unused `messages` parameter also passed in (confirmed by code read of all
  three adapters - the extra `messages` arg is accepted for `ILLMProvider` protocol
  symmetry but never read by any adapter).
- Traced both runtime orchestrators (`graph_langgraph.py`, `graph_pydantic_ai.py`) - both
  pass only the already-built `ResidencyPayload` through `run_with_failover`; neither
  reads audio/video or attaches anything extra. No bypass path found.
- `prompt_and_transcript` vs `prompt_text_only` correctly gate `prior_transcript` inclusion.
  `none` correctly raises rather than silently degrading.
- Found D-4 (Low, latent - not currently exploitable): `build_payload` raises
  `ResidencyBlockedError` for mode == "none" unconditionally, regardless of whether
  the configured LLM is actually remote or self-hosted. FR-LLM-3 specifically says none
  is "blocked at save for remote LLMs" (implying it's legitimate for a self-hosted
  LLM). Today this is harmless because `LlmProviderKey` in `runtime_config.py` is
  Literal["openai","anthropic","google"] - all three are hosting: remote per the
  catalog, and the TS backend's `combination-rules.ts` (CONFIG_RESIDENCY_BLOCKS_LLM)
  already blocks none + any hosting === remote LLM at save time, so no real
  published config can ever reach the Python runtime with mode == "none". But the
  function's own logic doesn't defend on that fact - it should either accept a hosting
  flag and only raise for remote, or the discrepancy should be documented as intentional.
  Compounding this: `pipeline.py`'s `_process_utterance` has no exception handling for
  `ResidencyBlockedError` at all (only `LlmUnavailableError` is caught) - if this were
  ever reached (e.g. if a future on-prem LLM catalog entry is added, which the codebase's
  own `_openai_compatible.py` docstring flags as an intended future "escape hatch"), the
  exception would propagate to `run_consumer_loop`'s blanket except Exception, which
  only logs utterance_processing_failed and silently drops the turn - no degraded-mode
  entry, no user-visible signal, forever, for every utterance in that session. Recommend
  fixing before any on-prem LLM catalog entry is ever added, not blocking today.

### 3. Failover (FR-LLM-2)
- Dev's own `tests/orchestration/test_failover.py` covers the ladder correctly with fake
  doubles (retry/backoff, non-retryable-skips-retry, primary-exhausts-then-fallback,
  LLM_MODEL_NOT_FOUND retried exactly once, both-exhausted raises LlmUnavailableError).
- Independently re-verified with real adapter classes (not the dev's own fakes): built
  a standalone harness instantiating the real `OpenAiLlmAdapter` and `AnthropicLlmAdapter`
  against respx-mocked HTTP endpoints - mocked OpenAI's chat/completions to return
  500, mocked Anthropic's v1/messages to return a genuine SSE stream - and called the
  real `run_with_failover`. Result: provider_key="anthropic", used_fallback=True,
  streamed reply text "hello" decoded correctly. Confirmed: failover genuinely engages
  a different real fallback provider end-to-end, not just with test doubles.

### 4. Secrets handling
- `secrets/directory_store.py`: independently tested path-traversal resistance directly -
  ../outside.txt, ..\outside.txt, ../../outside.txt all correctly raise
  SecretNotFoundError ("escapes the secrets directory"); a legitimate credential_ref
  resolves correctly.
- `registry/registry.py` resolves every secret once via SecretStorePort and hands only
  the resolved string to adapter constructors - no adapter reads os.environ or the
  filesystem directly.
- `telemetry/logging.py`'s `_redact_processor` redacts api_key, credential_ref,
  token, authorization, text, transcript (case-insensitive key match) before any
  log line renders. `orchestration/tools.py` logs only api_ref on tool failures, never
  api_key. Confirmed: credentials are resolved by reference, never logged, never
  baked into a payload.

### 5. Cross-language contract test - verified real, not a no-op
- Both `apps/agent/tests/contracts/test_agent_config_contract.py` (pytest) and
  `apps/api/.../agent-config-cross-language.contract.spec.ts` (jest) independently run
  green against the real, shared fixture directory
  (`apps/agent/fixtures/agent-config/{valid,invalid}/*.yaml`) - confirmed by reading both
  files' path resolution (Python: `Path(__file__).parents[2] / "fixtures" / ...`;
  TS: `join(__dirname, '..','..','..','..','..', 'agent','fixtures','agent-config')`) -
  same physical directory, not two divergent copies.
- Deliberately corrupted `fixtures/agent-config/valid/example-a.yaml` (changed
  retry.max_attempts: 3 to 5 while leaving backoff_ms at length 3, violating the
  documented backoff_ms.length === max_attempts cross-field rule both sides enforce).
  Re-ran both suites: Python pytest failed (ValidationError: backoff_ms length must
  equal max_attempts) and TS jest failed (acceptsAgentConfig returned false,
  expected true) - on the identical fixture. Restored the file; both suites green again
  (Python 11/11, TS 11/11). Confirmed: this is a real, load-bearing test, not a no-op.

### 6. import-linter contracts - independently verified, including the loophole question
- Ran `lint-imports` directly (not trusting the dev's report): 3 kept, 0 broken on the
  real, unmodified codebase.
- D-3 (Moderate) - the allow_indirect_imports=True question, live-probed:
  1. Probe A: added a literal `import openai` to `telemetry/hops.py` - `lint-imports`
     correctly reported "Vendor SDKs only inside adapters BROKEN" (avatar_agent.telemetry
     is not allowed to import openai). Direct-import detection genuinely works.
  2. Probe B (the loophole test): reverted Probe A, then added
     `from avatar_agent.adapters.llm.openai import OpenAiLlmAdapter` (an adapter
     submodule, which itself imports the real openai package) to `telemetry/hops.py`
     - `lint-imports` reported 3 kept, 0 broken - no violation at all.
  - Root cause: (a) the layers contract's layers= list only names entrypoint /
    orchestration / registry / adapters / ports - telemetry, residency,
    summary, and contracts are not members of that contract at all, so it cannot
    restrict what they import; (b) the vendor-sdk-isolation contract's
    forbidden_modules list names vendor package names (openai, anthropic, ...),
    not avatar_agent.adapters itself, so importing an adapter submodule directly is
    never a "forbidden module" match, regardless of allow_indirect_imports; (c)
    orchestration-uses-ports only restricts avatar_agent.orchestration, not the other
    five source modules in the vendor-sdk-isolation contract's list.
  - Conclusion: yes, allow_indirect_imports=True is a reasonable choice for making
    entrypoint's legitimate registry-mediated reach to a vendor SDK satisfiable (that
    part of the dev's justification comment holds up), but it is not the only gap - even
    with allow_indirect_imports=False this particular loophole (a non-adapter module
    importing an adapter submodule directly) would not be caught, because no contract
    forbids telemetry/residency/summary/contracts from importing
    avatar_agent.adapters at all (only orchestration has that specific restriction).
    Today the real codebase does not exploit this (confirmed clean both before and after
    the probes, reverted cleanly, dependency count back to 220). Recommend a 4th contract
    (or extending orchestration-uses-ports's source_modules list to include
    telemetry, residency, summary, contracts, ports) so the "only registry
    imports adapters" guarantee LLD Sec3.3 actually states is enforced for every module,
    not just orchestration.

### 7. Hop metrics (FR-STT-4/FR-LLM-4/FR-TTS-4)
- LLM hop (hop="llm", first_token_ms, total_ms, provider_key, used_fallback):
  genuinely sent via control_plane.send_hops in pipeline.py's success path, the
  degraded-mode path (error_code="LLM_UNAVAILABLE"), unit-tested
  (test_process_utterance_success_records_llm_and_tts_hops_and_speaks). Confirmed.
- TTS hop (hop="tts", first_audio_ms, total_ms, and an error-hop on TtsError):
  genuinely sent from pipeline.py._speak, unit-tested. Confirmed.
- STT hop (hop="stt", first_partial_ms, final_ms) - NOT RECORDED ANYWHERE. See
  D-1 below; this is the single most significant finding of this pass.

## D-1 (BLOCKING) - STT is never wired into the pipeline; FR-STT-3/FR-STT-4 cannot fire

**Module:** apps/agent/src/avatar_agent/entrypoint.py (handle_job), plus the dead
telemetry/hops.py::HopRecorder.

- ConversationPipeline.on_final_utterance(text) is the only entry point that feeds a
  transcript into the STT->LLM->TTS loop. Grepped the entire src/ tree:
  on_final_utterance has zero callers anywhere in the shipped code (only defined in
  pipeline.py and called from its own test file). entrypoint.handle_job - the actual
  LiveKit job entrypoint - never subscribes to a room audio track, never calls
  stt.transcribe()/stt.stream(...) on the resolved STT adapter, and never calls
  pipeline.on_final_utterance(...). The function's body literally just awaits
  ctx.room.disconnected (or None if that attribute doesn't exist) and then sends an
  ended event - there is no STT streaming loop present at all, not even an
  unverified/untested one.
- The module docstring's own comment ("Real per-frame audio-track subscription -> STT
  streaming ... wiring lives here in production; not exercised in this sandbox") is
  not accurate - there is no such wiring in the code, tested or not. This is a
  materially different, more serious claim than the disclosed "same class of gap as
  Phase 3's LiveKit item" - Phase 3's gap was "written but not run against a live
  server"; here the composition itself does not exist, so even a reachable live LiveKit
  server would produce zero conversation turns.
- Direct consequence for FR-STT-4: HopItem(hop="stt", first_partial_ms=..., final_ms=...)
  is never constructed or sent anywhere in the codebase (grepped - zero matches). The
  HopRecorder class in telemetry/hops.py (whose docstring says "every hop... records
  its own timing fields" and which pipeline.py's own class docstring claims is what
  instruments "every hop this pipeline runs") is never imported or instantiated by
  pipeline.py or anywhere else - pipeline.py calls control_plane.send_hops(...)
  directly for llm/tts, bypassing HopRecorder entirely, and no stt hop is ever
  built by any code path. The spec's own words apply directly: "Missing instrumentation
  is a defect" (FR-STT-4).
- Also blocks: FR-STT-3's "empty audio / no speech for 60s... keep session alive" boundary
  (there is no STT loop to apply this to), and the entire FR-AGENT-1 golden path
  ("Orchestrate STT -> LLM (+ tools) -> TTS -> avatar") beyond the LLM->TTS half, which is
  the only half actually exercised by any test in this repo.
- Not covered by any test: tests/test_entrypoint.py only tests build_pipeline
  (pure composition of adapters), never handle_job itself; there is no test file
  exercising room/track subscription at all.

## D-2 (BLOCKING) - FR-AGENT-2 tool invocation is entirely unwired end-to-end

**Modules:** entrypoint.py::build_pipeline, orchestration/pipeline.py.

- orchestration/tools.py (ToolExecutor, 10s timeout, 32 KiB cap, TOOL_TIMEOUT/
  TOOL_HTTP_ERROR/TOOL_RESPONSE_TRUNCATED) is correctly implemented and unit-tested
  in isolation - that part of the work is genuinely solid.
- However, entrypoint.build_pipeline hardcodes tools=[] and tool_specs=[]
  unconditionally, with a comment claiming "ToolDefinition resolution is done by the
  control plane's runtime-config response" - but cfg.agent.tools (the real
  list[ToolConfig] the tenant configured, confirmed present in
  contracts/runtime_config.py's AgentBlock.tools) is never read anywhere in
  entrypoint.py. Grepped the whole src/ tree for ToolSpec( (the constructor that
  would build a real tool spec for the LLM) and cfg.agent.tools - zero matches
  outside the schema definition itself. No matter what agent.tools[] a tenant
  publishes with enabled: true, the running agent registers nothing and the LLM is
  never told a tool exists.
- Deeper still: ConversationPipeline.__init__ stores self._tool_executor but
  pipeline.py never calls tool_executor.invoke(...) anywhere - there is no
  tool-call-detection step in _process_utterance's LLM-streaming loop at all. The
  LlmChunk TypedDict (ports/llm.py) only carries delta/done fields - there is no
  field to represent a model-requested tool call in the streaming contract, so even if
  tool_specs were correctly populated, there is no code path that could detect a tool
  call, execute it via ToolExecutor, and feed the result back to the model for a second
  turn (the standard tool-use loop FR-AGENT-2 describes).
- Net effect: FR-AGENT-2 (and the tool half of FR-AGENT-1/FR-AGENT-5) does not exist as
  a working feature beyond an isolated, unit-tested-but-never-invoked ToolExecutor
  class. No test in the repo exercises tool registration, tool-call detection, or
  tool-result feedback at the pipeline level (tests/orchestration/test_pipeline.py's
  full test list has zero tool-related cases).

## D-3 (Moderate) - import-linter's vendor-sdk-isolation contract has a proven, reproducible loophole

See item 6 above for the full write-up and probe evidence. Summary: telemetry,
residency, summary, and contracts can import an adapters/** submodule directly
(reaching a vendor SDK indirectly) without breaking any of the 3 current contracts,
because no contract actually restricts inbound imports to adapters for those four
modules (only orchestration has that restriction, via orchestration-uses-ports). Not
currently exploited in the real codebase (verified clean before/after probing). The dev's
own code comment correctly justifies allow_indirect_imports=True for entrypoint's
legitimate registry-mediated path, but does not address this separate gap, which exists
independently of that setting.

## D-4 (Low, latent/not currently exploitable) - see item 2 above

residency/filter.py::build_payload raises unconditionally for mode == "none" without
regard to LLM hosting, and pipeline.py has no exception handling for
ResidencyBlockedError. Currently unreachable because the only 3 canonical LLM providers
are all hosting: remote and the TS backend blocks none + remote at save. Recommend
fixing before any self-hosted/on-prem LLM catalog entry is added (the codebase's own
_openai_compatible.py frames this as a planned future path), and/or adding explicit
exception handling in pipeline.py so a residency-policy defect degrades the session
visibly instead of silently dropping every turn.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-STT-1 (Deepgram adapter, required, retry semantics) | Adapter unit tests (dev's), build_pipeline propagates FactoryLoadError for unresolvable STT credential (independently re-read) | PASS (adapter level) / See D-1 for wiring gap | tests/adapters/stt/test_deepgram.py, tests/test_entrypoint.py |
| FR-STT-2 (faster-whisper adapter) | Adapter unit tests | PASS (adapter level) | tests/adapters/stt/test_faster_whisper.py |
| FR-STT-3 (streaming partials, zero-length drop, 60s boundary) | pipeline.on_final_utterance zero-length-drop unit test (dev's); no wiring exists to actually feed a transcript from a live/real STT stream | FAIL (unreachable in shipped code) | D-1 |
| FR-STT-4 (instrument STT hop) | Grepped for any hop="stt" construction | FAIL - never recorded | D-1 |
| FR-LLM-1 (openai/anthropic/google swappable, LLM_MODEL_NOT_FOUND retry-once) | Dev's failover tests + my own real-adapter/respx harness | PASS | tests/orchestration/test_failover.py, QA harness above |
| FR-LLM-2 (primary+fallback, bounded retries, degraded on exhaustion, queue depth 3/oldest-drop) | Dev's tests + independent real-adapter failover proof; pipeline queue-overflow test read | PASS | as above, tests/orchestration/test_pipeline.py::test_queue_overflow_drops_the_oldest_pending_entry |
| FR-LLM-3 (residency-aware payload) | Code trace of build_payload/all 3 LLM adapters/both orchestrators; no bypass found | PASS, with D-4 caveat (latent, not live) | residency/filter.py, adapter reads above |
| FR-LLM-4 (instrument LLM hop) | Code trace + dev's unit test | PASS | pipeline.py lines sending hop="llm" |
| FR-TTS-1 (Fish Speech default, unknown-voice handling) | Adapter unit tests (dev's) | PASS (adapter level) | tests/adapters/tts/test_fish_speech.py |
| FR-TTS-2 (ElevenLabs adapter, residency-subject) | Adapter unit tests | PASS (adapter level) | tests/adapters/tts/test_elevenlabs.py |
| FR-TTS-3 (stream to avatar/room, skip-empty) | pipeline._speak/empty-reply-skip unit test read | PASS (LLM->TTS half only; no avatar/room publish this phase, disclosed and in-scope-deferred per decision log) | pipeline.py, test_process_utterance_with_empty_llm_reply_skips_tts_entirely |
| FR-TTS-4 (instrument TTS hop) | Code trace + dev's unit test | PASS | pipeline.py hop="tts" |
| FR-AGENT-1 (orchestrate STT->LLM(+tools)->TTS->avatar) | Full trace of entrypoint.py/pipeline.py | FAIL - STT half (D-1) and tools half (D-2) both unwired; only LLM->TTS half genuinely works | D-1, D-2 |
| FR-AGENT-2 (tool invocation) | Full trace of tools.py/pipeline.py/entrypoint.py | FAIL - never wired end-to-end | D-2 |
| FR-AGENT-3 (conversational memory) | Code trace: SessionMemory correctly added/read every turn in pipeline.py, window/enabled honored | PASS | orchestration/memory.py, pipeline.py |
| FR-AGENT-4 (RAG, optional, non-fatal) | Code trace: RagRetriever(index=None) always returns no chunks, retrieve() called every turn, never fatal | PASS (disclosed as a deliberate non-implementation, matches decision log) | orchestration/rag.py, pipeline.py |
| FR-AGENT-5 (customer internal APIs via tools, untrusted/capped/redacted) | tools.py unit tests (32 KiB cap, credential-in-header not logged) | PASS at the isolated-class level only - see D-2, never actually reachable at runtime | tests/orchestration/test_tools.py |

## AI/vendor-SDK boundary - final verdict
Clean in the actual codebase (grep + import-linter + 2 live probes all agree), but the
guardrail has a proven structural gap (D-3) that should be closed rather than relied on
by convention alone.

## Overall verdict: FAIL

Full regression, secrets handling, residency-payload construction, failover, and the
cross-language contract test are all genuinely solid and independently re-verified
against real dependencies (not mocks alone) wherever feasible in this sandbox. However,
two of this phase's headline features do not work end-to-end as shipped:

- D-1 (Blocking): the STT half of the conversation loop is never wired into the
  pipeline at all (not merely untested against a live server) - no transcript can ever
  reach the LLM in production as this code stands, and FR-STT-4's hop instrumentation
  requirement is unmet.
- D-2 (Blocking): FR-AGENT-2 tool invocation is unwired at both the composition root
  and the pipeline's turn-processing loop - configured tools are never registered,
  exposed to the model, or invoked.

D-3 (Moderate, import-linter guardrail gap) and D-4 (Low, latent residency-payload
inconsistency) should be batched into the same retry. Recommend a narrowly-scoped retry
to nexus-dev for D-1 and D-2 (the actual audio/track/STT-streaming wiring in
entrypoint.handle_job, plus a real tool-call-detection/execution loop in
pipeline.py fed from cfg.agent.tools), with D-3/D-4 batched in; do not re-run the
full regression suite blind afterward - QA should specifically re-drive an actual
utterance cycle (STT text in -> LLM -> TTS out, with a real or faithfully-faked LiveKit
audio path) and a real tool-call round-trip before signing this phase off.
