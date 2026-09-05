# Agent Builder v2 — Backlog (Reasoning / Skills / RAG / Orchestration / HITL)

Continues `docs/BACKLOG.md` (v1, **closed** — all P0 items BL-001–BL-025 shipped, phases 1–7 done, `docs/NEXUS_STATE.md` records `current_phase: done`) with a new, separately-tracked phase sequence for the capability layer specified in `docs/v2/AgentBuilder_Reasoning_Skills_RAG_Orchestration_HITL.md`. This file is kept separate from `docs/BACKLOG.md` by deliberate choice, not oversight: v1 is a closed historical record, v2 is a new, independently-scoped effort that has not started building.

`FR ref(s)` here cites the v2 spec's own rule IDs (`R-G*`, `R-S*`, `R-T*`, `R-R*`, `R-H*`, `V-*`) since that document is this subsystem's functional-requirement source, exactly as `docs/BACKLOG.md` cites `FR-*` IDs from `docs/PRODUCT_SPECIFICATION.md`.

`ID` numbering continues from `BL-033` (v1 reserved `BL-026`–`BL-032` for its own P2 tail — see `docs/BACKLOG.md`).

**Two scope decisions made before this backlog was written (see `docs/v2/ARCHITECTURE_NOTES.md` §0 and §6 for full reasoning):**
- **Multi-environment (dev/staging/production) isolation is descoped for v1.** "Production" is the only real enforcement target for every environment-conditional rule below; dev/staging remain UI-only labels with no backend gating difference. Real isolation is its own future backlog item (see Deferred section).
- **Config version history (`ConfigVersion`) is treated as foundational**, not bolted on later — introduced in Phase 9 alongside the graph schema change, because R-G8 requires the graph be versioned/diffable/rollback-able like any other config, and retrofitting history after 8 phases of schema growth would be far more disruptive than building it in from the start of the schema's evolution.

---

## Backlog table

| ID | FR ref(s) | Title | Priority | Phase | Depends on | Rationale |
|---|---|---|---|---|---|---|
| BL-033 | R-T1, R-T2, R-T5 | Tools registry: real CRUD API + test-invoke endpoint, replacing the read-only stub | P0 | 8 | v1 BL-016 (`ToolDefinition` model exists, no CRUD) | Every later subsystem (Skill tools, graph Tool nodes, consequential gating) needs tools to be a manageable entity, not a stub count. |
| BL-034 | R-T1, R-T2, R-T3 | Tools tab in the builder: always-available attach panel, base-prompt token-cost banner | P0 | 8 | BL-033 | First new builder tab; establishes the pattern (attach/detach, cost display) reused by Skills/Reasoning tabs later. |
| BL-035 | R-G1, R-G2, R-G7, R-G9 | Config schema: `llm:` → `reasoning.graph[]` (LLM/Tool/Retrieve-stub/Router/Speak/End node types) + `ConfigVersion` model (append-only, written on publish) | P0 | 9 | BL-034 | Foundational schema + versioning change everything else builds on; must land before any node-type work to avoid rework. |
| BL-036 | R-G1–R-G9 | Multi-node graph interpreter (Python, shared by `langgraph`/`pydantic-ai` runtimes) — node execution state machine, `on_error` edges | P0 | 9 | BL-035 | The actual execution engine; today's "graph" is one node wrapping retry logic. |
| BL-037 | (new — testing infra, no direct rule ref) | Shared "Test call" / eval-suite harness (backend endpoint + minimal assertion model + UI panel) | P0 | 9 | BL-036 | Referenced as a publish gate throughout A3–A5's use cases; every later tab (Reasoning, Skills, Knowledge playground) reuses this one component instead of rebuilding it four times. |
| BL-038 | R-G1–R-G9 | Reasoning tab v1: structured node-card list + inspector (not a canvas — see `docs/v2/UX_SCOPE.md`) | P0 | 9 | BL-036, BL-037 | An admin can build Router → Tool/Retrieve(stub)/Speak branches and run a test call. |
| BL-039 | R-G9 | Session detail: node-level execution trace (extends the existing hop table) | P0 | 9 | BL-036 | Debugging a graph turn needs node-level visibility, not just stt/llm/tts/avatar hops. |
| BL-040 | R-G10, V-1 | Critical-path computation (TypeScript, publish-time) + turn budget field + V-1 enforcement | P0 | 10 | BL-035, BL-038 | The single most important constraint in voice orchestration (per spec's own framing); nothing about A4 works without it. |
| BL-041 | R-G10, R-G13 | Turn budget panel UI (critical path bar, all-paths list) + deadline degradation runtime (soft/hard cut, `on_deadline` edges) | P0 | 10 | BL-040 | Matches UC-G3 end to end: an over-budget graph is caught in the builder and degrades gracefully at runtime if it slips through. |
| BL-042 | R-G3 (Parallel branch of A3.3) | Parallel node + join policies `all`/`first_success`/`quorum`/`all_settled` (`best_of` deferred — see below) | P0 | 11 | BL-040, BL-041 | UC-G1's fix pattern (sequential → parallel to recover budget) needs both the node type and a working budget panel to be meaningful. |
| BL-043 | R-G4, R-G5, V-2, V-4 | Loop node + mandatory 3-guard validation (iteration/duration/cost) + no-cycle-outside-loop check | P0 | 11 | BL-042 | Loop is the highest-risk node type (unbounded execution) — guards are non-negotiable, ship alongside Parallel since both need lane/budget maturity. |
| BL-044 | R-R1, R-R2, V-9 | RAG ingestion pipeline: parser, fixed-size chunking (pluggable strategy interface for semantic/heading-aware later), embedding (new standalone Python embed service), index write (pgvector), coarse re-index cost/duration estimate | P0 | 12a | none of BL-033–043 (parallelizable workstream) | Prerequisite for everything else in A7 — `RagIndexPort` is a total stub today; nothing in the retrieval half means anything without a real index behind it. |
| BL-045 | R-R3, R-R4, R-R5 (rewrite — see deferred note), R-R7, R-R8, V-10 | RAG retrieval pipeline: hybrid search (pgvector cosine + Postgres FTS), metadata filter, threshold + `KnowledgeGap` logging, token-capped injection, all budgeted | P0 | 12b | BL-044, BL-040 (reuses budget-bar pattern) | Replaces the `RagRetriever` stub with the real online half of A7. |
| BL-046 | R-R1, R-R2, V-9 | Knowledge tab: Sources sub-tab (per-source ingestion config, re-index button) | P0 | 12a | BL-044 | Operator surface for ingestion config. |
| BL-047 | R-R3–R-R10 | Knowledge tab: Pipeline sub-tab (6-stage retrieval form + budget total) + real Retrieve graph node (replaces Phase 9's stub) | P0 | 12b | BL-045, BL-038 | Retrieve node becomes real; pipeline config surfaced. |
| BL-048 | R-R9 | Retrieval playground | P0 | 12b | BL-045, BL-037 | UC-R1 end-to-end: diagnose and fix a retrieval defect from the playground, reusing the Phase 9 test harness. |
| BL-049 | R-S1, R-S3, R-S4 (tenant-scope only — platform-library adopt flow deferred), R-S8 | Skill entity: `Skill`/`SkillVersion` models, immutable versioning, tenant-shared scoping, per-environment enable toggle (UI-only per the environment descope) | P0 | 13 | BL-034 (tools to attach), BL-047 (knowledge filters to attach), BL-038 (Router node for router-decided triggering) | Skills is a packaging feature — needs tools/knowledge/router to already exist or it packages nothing. |
| BL-050 | R-S1, R-S2, R-S5, R-S7 | Skills library + Skill editor screens (progressive disclosure, base-prompt cost panel) | P0 | 13 | BL-049 | UC-S2 (one skill, two agents, one approval rule) buildable. |
| BL-051 | R-S1, R-S6, V-11, V-12 | Skill graph node type (model-decided + router-decided triggering) + `skillRefsKnownAndEnabledRule` (V-12) + full base-prompt token ceiling (V-11) | P0 | 13 | BL-050, BL-038 | Completes the progressive-disclosure runtime mechanism end to end. |
| BL-052 | R-H1, R-H7 | HITL gate entity: `HitlGate`/`HitlDecision`/`ReviewerGroup` models, all 6 mandatory fields, decision audit trail | P0 | 14 | BL-051 (R-S6: a skill may declare a gate) | Foundation for every HITL use case. |
| BL-053 | R-H2, R-H4, R-H5 | HITL graph node type: blocking-gate pause/resume in the interpreter (`await` inside the graph, short-poll decision delivery), hold-treatment speech | P0 | 14 | BL-052, BL-036 | The mechanically hardest piece of runtime surgery in this whole effort — pausing a live voice turn without breaking the pipeline. |
| BL-054 | R-H1, R-H3 | HITL config screen (gate type Blocking/Deferred/Pre-speech enabled; Whisper/Post-hoc shown disabled — see `docs/v2/UX_SCOPE.md`) | P0 | 14 | BL-053 | Operator surface for gate configuration. |
| BL-055 | R-H6, R-H7 | Reviewer console (minimal): queue, approve/deny/edit-and-approve | P0 | 14 | BL-053 | UC-H1 (live approval) buildable end to end. |
| BL-056 | R-H5, R-H9 | Caller-side hold-treatment UX + deferred-approval async queue, track-to-closure, in-app/email outcome notification (SMS deferred — see below) | P0 | 14 | BL-053 | UC-H2 (deferred approval, "the one most teams forget to build" per the spec) — the doc explicitly calls this the correct default, not a nice-to-have. |
| BL-057 | V-6, V-7, V-8 | Consequential-tool gating wired to the Tools tab (BL-034) | P0 | 14 | BL-052, BL-034 | Two-feature dependency: needs both Tools' `consequential` flag and HITL gates to exist simultaneously. |
| BL-058 | R-G6, V-3 | Sub-agent node: delegation to an already-published sibling agent (not inline persona authoring — see below), nesting depth ≤ 2 | P0 | 15 | BL-041, BL-042/043 (budget/lane maturity) | Completeness item; minimal version avoids duplicating the whole Agent Builder inside a node inspector. |
| BL-059 | (A3.2 Handoff — intent only, telephony deferred) | Handoff node: record handoff, transition session state, fire alert | P0 | 15 | BL-038 | Telephony transfer mechanics are out of this doc's data-model scope; ship the intent/state side only. |
| BL-060 | (A3.2 State — in-memory only) | State node: session-scoped variable read/write, in-memory per session (no Postgres write path) | P0 | 15 | BL-038 | Deliberate simplification — no clear v1 consumer for persisted per-turn state writes. |
| BL-061 | A9.1, A9.2 | Overview tab: read-only rollup of Pipeline/Reasoning/Capabilities/Behaviour + right-rail budget/cost/validation summary | P0 | 16 | BL-033–060 (reads every other tab's already-built state) | Sequenced last by construction — it's a composition of everything else, not new logic. |
| BL-062 | (A9.1 Dynamics — net-new fields, no A3–A8 dependency) | Dynamics tab: barge-in, endpointing, verbosity, no-input, call limits | P0 | 16 | BL-034 (pattern reuse only) | Genuinely independent of A3–A8; can be pulled forward if a phase needs filler work, but sequenced last for backlog clarity. |
| BL-063 | V-5, V-11, V-12 (finalization) | Remaining validation wiring: `on_deadline` half of V-5, full V-11 sum, final V-12 sweep | P0 | 16 | BL-041, BL-051 | These rules split across two phases each (see `docs/v2/ARCHITECTURE_NOTES.md` §6); this item closes out the second half. |
| BL-064 | A9.1 (Privacy tab) | Privacy tab: relabel/relocate the existing Residency screen under the new 8-tab shell | P0 | 16 | BL-061 | Reorganization only, no new logic — bundled with shell consolidation. |
| BL-065 | A9.1 | 8-tab builder shell (`mat-tab-group` replacing the current single-page layout) | P0 | 16 | BL-061, BL-064 | Ships the container once every tab's content exists; building the shell earlier would just be empty tabs. |

## Deferred (P2) — explicitly tracked, not silently dropped

| ID | Title | Depends on | Rationale |
|---|---|---|---|
| BL-066 | Real multi-environment (dev/staging/production) config isolation | — | Bigger than the rest of this spec combined (separate draft/published rows and publish pipelines per environment); descoped for v1 per the decision above. Every `environments[]` field ships as a UI-only label until this lands. |
| BL-067 | Speculative retrieval on partial transcript (R-G11) | BL-047 | Needs STT partial-transcript hooks wired into the retrieval trigger; opt-in optimisation, off by default in the spec's own UI. |
| BL-068 | Speculative speech / pre-synthesised Speak nodes (R-G12) | BL-041 | Same category as BL-067 — real runtime latency engineering (TTS pre-synthesis cache, interruption semantics), not required for the headline "catch an over-budget graph" value. |
| BL-069 | `best_of` join policy (judge-node pattern) | BL-042 | Spec itself flags this "expensive"; needs a judge-LLM cost/latency model of its own. |
| BL-070 | True cross-encoder reranking | BL-045 | Needs a hosted rerank model or paid third-party API — new vendor integration and credential type, comparable in weight to the existing GPU-adjacent provider pool. |
| BL-071 | Semantic / heading-aware chunking strategies | BL-044 | Ship behind the pluggable `ChunkerPort` from BL-044 so this is additive later, not a redesign. |
| BL-072 | Crawl-type knowledge sources | BL-044 | Needs a scheduler, dedup, change detection — real scope beyond upload-only. |
| BL-073 | Skills "Extract from prompt" AI-assist | BL-050 | LLM-assisted refactor tool, not core plumbing — good v2.2 candidate once Skills v1 has usage data. |
| BL-074 | Platform-library skill publish + cross-tenant adopt flow | BL-049 | Marketplace-shaped feature with its own governance questions; tenant-level sharing (BL-049) already solves the actual pain point (UC-S2). |
| BL-075 | Supervisor whisper console | BL-053 | A second real-time surface (live transcript streaming, mid-call context injection) — genuinely separate engineering from gate-based HITL. |
| BL-076 | Post-hoc HITL review queue | BL-052 | Largely covered by existing session-log/transcript review once node-level traces (BL-039) exist; dedicated queue adds little. |
| BL-077 | SMS/telephony notification channel for deferred approvals | BL-056 | Requires a telephony-provider integration decision outside this spec's scope; the deferred-approval mechanism itself (BL-056) doesn't need a specific channel to be correct. |
| BL-078 | Config version diff view + rollback UI ("Compare to v12", Overview Diff button) | BL-035 | `ConfigVersion` storage lands in Phase 9 (BL-035), but the diff/rollback UI is deferred until a phase has UI capacity — read-at-diff-time backend logic is cheap, the UI is not on the critical path to any Phase 9–16 exit condition. |
| BL-079 | True drag-and-drop graph canvas (replacing the Phase 9 structured list) | BL-038 | Multi-week UI investment (layout engine, connection drawing, lane bands) orthogonal to whether the graph executes correctly; revisit only if the list view proves unreadable past ~15 nodes in practice. |
| BL-080 | Sub-agent inline persona authoring (full node-inspector UI for designing a sub-agent in place) | BL-058 | BL-058's "delegate to an existing published agent" covers most of the value; a full inline authoring UI duplicates the entire Agent Builder inside a node inspector. |

---

## Phase map

| Phase | Theme | Items | Exit condition |
|---|---|---|---|
| 8 | Tools registry | BL-033–034 | Admin manages tools without API hacks; replaces the v1 read-only count. |
| 9 | Reasoning graph engine v1 | BL-035–039 | An admin builds Router→Tool/Retrieve(stub)/Speak branches, runs a test call, sees node-level session detail; config schema's `llm:` → `reasoning.graph` with real version history. |
| 10 | Latency governance v1 | BL-040–041 | UC-G3: an over-budget graph is caught and fixable in the builder before publish; deadline degradation runtime live. |
| 11 | Parallel & Loop | BL-042–043 | UC-G1 step 8 (sequential→parallel to fix budget) buildable end-to-end. |
| 12a | RAG ingestion | BL-044, BL-046 | A source can be uploaded, chunked, embedded, and queried. |
| 12b | RAG retrieval + Knowledge tab | BL-045, BL-047–048 | UC-R1 end-to-end: diagnose and fix a retrieval defect from the playground. |
| 13 | Skills | BL-049–051 | UC-S2 (one skill, two agents, one approval rule) works. |
| 14 | HITL v1 (Blocking/Deferred/Pre-speech) | BL-052–057 | UC-H1 and UC-H2 both work end-to-end; consequential-tool gating enforced. |
| 15 | Sub-agent, Handoff, State | BL-058–060 | All 13 A3.2 node types exist in some form. |
| 16 | Builder consolidation | BL-061–065 | Full 8-tab builder live; all V-1..V-12 enforced somewhere in the product. |

**Phase 12a and Phases 8–11 have no dependency on each other and may run as parallel workstreams if staffed separately** — everything else is strictly sequential per the `Depends on` column above.

## Suggested next slice

Start **Phase 8** (BL-033 → BL-034) via the Nexus pipeline (`nexus-architect` should first read `docs/v2/ARCHITECTURE_NOTES.md` for the target schema/module design before the phase's own architecture pass). Do not start Phase 9's schema change (BL-035) until Phase 8's Tools CRUD is settled — several later Gate B rules assume a working `ToolDefinition` repository.
