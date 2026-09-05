# Agent Builder v2 — Architecture Notes

Target architecture for the capability layer specified in `docs/v2/AgentBuilder_Reasoning_Skills_RAG_Orchestration_HITL.md` (A3–A9). Written for a future `nexus-architect` pass — triggered when `docs/v2/BACKLOG.md` Phase 8 actually starts — so it can produce real `docs/architecture/HLD.md` / `LLD.md` / ADR updates without re-deriving the design decisions below from scratch. Nothing here has been implemented; no schema, code, or existing doc has been changed as part of writing this file.

Current-state facts this design is built on (verified against the codebase, not assumed):

- Config is a single mutable row per tenant (`DeploymentConfig`, `apps/api/prisma/schema.prisma`), `status: draft|published`, **no version history table at all**.
- The canonical schema (`packages/contracts/src/agent-config/schema.ts`, TypeBox) has a flat `llm: {primary, fallback, retry}` block; `agent.tools[]`, `agent.memory`, `agent.rag{enabled, index_ref}`.
- Validation is a two-gate pattern: Gate A (`validate-config.use-case.ts` — parse/structural/secret-scan) then Gate B (`domain/combination-rules.ts`, a `COMBINATION_RULES` array of business rules) — this is today's extensible validator seam and is reused throughout this design.
- `ToolDefinition` (Prisma model + `apps/api/src/modules/tools/`) exists with no CRUD controller. Python `ToolExecutor` (`apps/agent/src/avatar_agent/orchestration/tools.py`) does a one-shot HTTP call, no chaining.
- `RagIndexPort` (`apps/agent/src/avatar_agent/orchestration/rag.py`) is an explicitly unimplemented `Protocol` stub.
- Skills and HITL: zero references anywhere in the codebase.
- "Orchestration graph" (`orchestration/graph_langgraph.py`, `graph_pydantic_ai.py`) is a single-node wrapper around `orchestration/failover.py`'s `run_with_failover` — retry/failover logic, not a multi-step graph.
- Cross-language contract discipline (ADR-001): `packages/contracts/src/agent-config/schema.ts` is mirrored in Python at `apps/agent/src/avatar_agent/contracts/runtime_config.py`, enforced by a contract test — every schema change here must update both.
- Session telemetry: `LatencyHop` Prisma model, one row per hop per utterance — the closest existing thing to a "waterfall," but no eval-suite/test-call mechanism exists anywhere.

---

## 0. Two things the spec assumes but never states as prerequisites

1. **Config version history.** R-G8 requires the graph be "part of the ConfigVersion and therefore immutable, versioned, diffable, and rollback-able like any other config" — this only makes sense if config-as-a-whole is versioned, not just the graph subtree. **Decision: build `ConfigVersion` as a foundational piece in Phase 9, alongside the schema's `llm:` → `reasoning.graph` change**, not bolted on later. Versioning only the graph while everything else stays a single mutable row would be an inconsistent, short-lived hack.
2. **Multi-environment (dev/staging/production) isolation.** Several rules (V-1, V-5, V-9, V-12) and every `environments[]` field (skills, HITL gates) are environment-conditional, but `Tenant`/`DeploymentConfig` is single-environment today, full stop. **Decision (made with the user, recorded here so it isn't rediscovered): descope for v1.** Treat "production" as the only real enforcement target; dev/staging stay UI-only labels with no backend gating difference. True isolation (separate draft/published rows and publish pipelines per environment) is `docs/v2/BACKLOG.md` BL-066, tracked but not scheduled.

---

## 1. Config schema evolution

`AgentConfigSchema` (`packages/contracts/src/agent-config/schema.ts`) changes:

- `llm: {primary, fallback, retry}` → absorbed into `reasoning: { graph: GraphNode[], turn_budget_ms: number }`. A minimal single-LLM-node agent's graph node config carries the same `provider/model/fallback/retry` shape today's `llm` block has — the default/simple-agent case (R-G1) stays close to a mechanical rename.
- New top-level: `skills: SkillRef[]` (`{id, version: number | "latest"}`), `knowledge: { sources: [], pipeline: RetrievalPipelineConfig }`, `hitl: { gates: HitlGateRef[] }`.
- `GraphNode` is a **discriminated union on `type`** (TypeBox `T.Union` of 13 object shapes — LLM/Retrieve/Tool/Skill/Sub-agent/Router/Parallel/Loop/HITL/Speak/Handoff/State/End), mirrored as a Pydantic discriminated union in `runtime_config.py`, validated by an extended contract-test fixture corpus (same mechanism as today, larger surface).
- `agent.tools[]` stays a reference list (`{api_ref, enabled}`) — tools remain a separately-managed entity, never inlined, which is what lets a tool be shared across the agent-level/skill-level/graph-node attach routes (R-T1) without duplication.

## 2. Config versioning

New model, additive migration:

```
model ConfigVersion {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId        String   @map("tenant_id") @db.Uuid
  versionNumber   Int      @map("version_number")
  yamlText        String   @map("yaml_text")
  status          ConfigVersionStatus   // published | superseded | rolled_back
  publishedAt     DateTime @map("published_at") @db.Timestamptz
  createdBy       String?  @map("created_by") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz
  rolledBackFrom  String?  @map("rolled_back_from") @db.Uuid

  @@unique([tenantId, versionNumber])
  @@index([tenantId, status])
}
```

- `DeploymentConfig` is **unchanged in shape**, kept as the fast "current" pointer row the runtime-config read path already uses on every session start — no hot-path change.
- **Only publish writes a `ConfigVersion` row** — draft saves behave exactly as today, no snapshot noise on autosave. `SaveConfigUseCase`, after Gate B passes for `save_as: 'published'`, inserts one row (`versionNumber = max+1`) in the same transaction as the `DeploymentConfig` update — additive to the existing method.
- **Diff** computed at read time from two `yamlText` values — no stored diff, no second representation to keep in sync.
- **Rollback** creates a new **draft** prefilled from an old version's `yamlText` (marks that version `rolled_back_from`); it never silently republishes. The admin must still hit Publish, re-running full Gate A/B including whatever V-rules exist at that point. Mirrors this project's own "new commit, not amend" git discipline.
- New use cases fold into the existing `deployment-config` module (config lifecycle, not a new bounded context): `application/list-config-versions.use-case.ts`, `get-config-version-diff.use-case.ts`, `rollback-config-version.use-case.ts`, `infrastructure/prisma-config-version.repository.ts`, ports added to `domain/ports.ts`.
- The diff/rollback **UI** is `docs/v2/BACKLOG.md` BL-078 — deferred; the backend capability lands in Phase 9 but isn't on the critical path of any Phase 9–16 exit condition.

## 3. Orchestration graph engine (Python)

### 3.1 One shared interpreter, not two hand-written graphs

Today's `LangGraphOrchestrator` and `PydanticAiOrchestrator` are already thin single-node wrappers around one shared function (`run_with_failover`). The correct evolution keeps that exact shape:

- New package `avatar_agent/orchestration/graph/`:
  - `ir.py` — `GraphNode`, `GraphDefinition`, parsed from the Pydantic mirror of `reasoning.graph`.
  - `nodes/{llm,retrieve,tool,skill,subagent,router,parallel,loop,hitl,speak,handoff,state,end}.py` — one `NodeExecutor` per type, common Protocol (`async def execute(ctx: TurnContext) -> NodeResult`).
  - `interpreter.py` — the actual multi-node engine: walks `GraphDefinition`, implements the A3.4 state machine (PENDING→RUNNING→COMPLETE/TIMED_OUT/FAILED/CANCELLED), lane separation (background nodes scheduled as detached `asyncio` tasks after `Speak`), join policies (`all`/`first_success`/`quorum(n)`/`all_settled` via `asyncio.gather`/`wait`; `best_of` deferred per BL-069), loop guards enforced at runtime as defense-in-depth behind the publish-time V-2/V-4 checks.
- `LangGraphOrchestrator`/`PydanticAiOrchestrator` become **one-node wrappers around `interpreter.run(graph_definition, ctx)`**, exactly as `_call_llm_node` wraps `run_with_failover` today. This keeps `agent.runtime: langgraph|pydantic-ai` a real, honored choice (preserving ADR-001's vendor-neutrality reasoning) while avoiding two independently-maintained 13-node interpreters — the single largest correctness risk this design avoids.
- `ports/orchestration.py`'s `IOrchestrator.run_turn(...)` signature widens to accept a `GraphDefinition` instead of an implicit single-LLM-call shape — a real, contained interface change.

### 3.2 Node-type infra notes

- **Tool** reuses `ToolExecutor` as-is, wrapped with lane/budget/`on_error`/`on_deadline`.
- **Retrieve** is the RAG pipeline's online half (§4) — stubbed (no-op, logs a gap) until Phase 12b.
- **Skill** resolves and injects a skill body then runs a nested sub-graph or a plain LLM turn (§5).
- **Sub-agent** loads another agent's published `ConfigVersion`, runs it as a nested interpreter invocation with its own budget; nesting depth tracked at runtime as defense-in-depth behind V-3. v1 scope: delegate to an already-published sibling agent only (`docs/v2/BACKLOG.md` BL-058) — no inline persona-authoring UI (BL-080, deferred).
- **Router** needs a constrained condition evaluator — **never `eval()`** (consistent with ADR-001 §3's "tool responses are untrusted, never `eval`'d" discipline) — a small allow-listed expression grammar over turn-state fields only.
- **Speak** requires the largest single piece of pipeline surgery: today `_speak()` in `pipeline.py` is called exactly once, at the end of `_process_utterance`. The interpreter needs to invoke it **mid-turn**, as a side-effecting callback (`ctx.speak(text)`), for HITL hold-treatment (Phase 14) and — if ever built — speculative acknowledgements (BL-068, deferred). Flagged as the largest refactor inside `pipeline.py`.
- **Handoff**: v1 builds only the intent (record handoff, transition session state, fire an alert) — actual PSTN/SIP transfer mechanics are a telephony-integration decision outside this design's scope (BACKLOG BL-059).
- **State**: session-scoped variable read/write, **in-memory only** for v1 — extends the existing per-session state, not a new Postgres write path per turn (BACKLOG BL-060). No clear v1 consumer justifies the write load of persisting every State write.

### 3.3 Turn-budget critical path — split by design, not duplicated

- **Build-time (TypeScript)**: the hard algorithm — longest path over a DAG with lane-aware weights, join-policy-aware branch costs, all-paths enumeration for the builder's panel. New pure function `apps/api/src/modules/deployment-config/domain/critical-path.ts`, invoked as a Gate A/B-adjacent structural check (feeds V-1) and exposed via `/config/validate`'s response so the builder has something to render.
- **Runtime (Python)**: deliberately simpler — per-node budgets were already validated at publish time, so deadline enforcement (R-G13) is just "track cumulative elapsed foreground time as nodes execute, cut in-flight nodes and take `on_deadline` when it crosses the turn budget." No re-run of the critical-path algorithm live. This split avoids maintaining the hard graph algorithm in two languages.
- **R-G11/R-G12 (speculative retrieval/speech)**: both need triggering from `run_stt_loop`'s *partial* events, not just `on_final_utterance` — a real change to the STT→trigger boundary. **Deferred** (BL-067, BL-068) — both are explicitly opt-in, off-by-default optimisations in the spec's own UI, not required for the headline "catch an over-budget graph before publish" value.

## 4. RAG pipeline

### 4.1 Vector store: pgvector on the existing Postgres, not a new vector DB

`schema.prisma` already enables `previewFeatures = ["postgresqlExtensions"]`. Adding `vector` to that list avoids standing up new infrastructure entirely — hybrid search (R-R4) becomes a single-database query: cosine distance (`<=>`) plus Postgres full-text search (`tsvector`/`ts_rank`) on the same `KnowledgeChunk` row, blended by a configurable weight, instead of reconciling results from two separate systems. A dedicated vector DB (Qdrant/Pinecone) is a legitimate future upgrade if chunk volume/latency ever demands it — not required for v1.

Prisma+pgvector friction: no first-class vector column type, so `KnowledgeChunk.embedding` needs `Unsupported("vector(N)")` plus raw-SQL migration additions for the ANN index (`ivfflat`/`hnsw`) and queries — reuses the LLD's existing "raw-SQL migration additions" escape hatch pattern rather than inventing a new one.

### 4.2 New models

`KnowledgeSource` (parser/chunking/embedding config, status, staleness), `KnowledgeChunk` (text mirror + vector + tsvector, doubles as the playground's citation source), `KnowledgeGap` (R-R7's below-threshold events, feeds the gap report).

### 4.3 Ingestion — split by ADR-001's vendor-SDK boundary

Parsing/cleaning/chunking is pure text processing, **no vendor SDK involved** — belongs in TypeScript as a new BullMQ job (`jobs` module gains `knowledge-ingest.processor.ts`, reusing the existing queue/processor pattern exactly). The **embed** step calls a vendor SDK, so per ADR-001 §3 it must live in Python's `adapters/**`. Recommended shape: a **second Python process entrypoint** (`avatar_agent/services/ai_service.py`, e.g. `POST /embed`), sharing the same `ports`/`registry`/`adapters` package as the per-call LiveKit worker — not a new codebase, a second deployment target — reached by the Nest ingestion job over internal HTTP. **This is the single biggest new infrastructure component in the whole plan** — flagged explicitly for `nexus-architect` to size and sequence carefully in Phase 12a.

Embedding provider selection reuses the LLD §7 provider-registry pattern exactly: new `LogicalProviderKey.EMBEDDING_*`, `IEmbeddingProvider` Protocol, `resolve_embedding(cfg, secrets)` — same shape as `resolve_llm`.

### 4.4 Retrieval — the `Retrieve` node executor

Rewrite (optional LLM call) → hybrid search (pgvector + Postgres FTS, weighted) → metadata filter (SQL `WHERE`) → rerank (deferred, BL-070) → threshold (drop + log `KnowledgeGap`, never pass a low score) → inject (token cap). Replaces `RagRetriever`/`RagIndexPort` entirely.

### 4.5 Build now vs. defer

- **Build now**: fixed-size chunking (deterministic, no ML dependency, behind a pluggable `ChunkerPort` so semantic/heading-aware strategies are additive later — BL-071); pgvector hybrid search; threshold + gap logging; token-capped injection; **the retrieval playground** (realistic to ship because it's a thin "dry-run" wrapper around the same retrieval code path the live turn uses — no duplicate-logic risk); re-index cost/duration preview as a coarse linear estimate (chunk_count × constants), explicitly labeled an estimate.
- **Defer**: true cross-encoder reranking (BL-070 — needs a hosted model or paid rerank API, a new vendor integration and credential type, comparable in weight to the existing GPU-adjacent provider pool); semantic/heading-aware chunking (BL-071); crawl-type sources (BL-072 — needs a scheduler, dedup, change detection); speculative retrieval (BL-067).

## 5. Skills as a first-class entity

### 5.1 Storage

```
Skill         (id, tenantId?, platformPublished bool, name, slug, currentPublishedVersionId)
SkillVersion  (id, skillId, versionNumber, description, instructions, triggerMode: model|router,
               tools[] (api_ref refs), knowledgeFilters json, budgetMs, environments[],
               status: draft|published, publishedAt, createdBy)
```

Immutable per version (R-S3), same append-only discipline as `ConfigVersion`. Agents reference `skill_id@version` or `skill_id@latest`; "latest" resolves once at session-start read time in `GetRuntimeConfigUseCase`, mirroring how the rest of runtime config is already resolved once per session (not re-read mid-call).

### 5.2 Scoping

- Tenant-shared: `Skill.tenantId = X`, referenced by any agent config in that tenant, never copied.
- Platform library (BL-074, deferred for v1): `Skill.tenantId = null`, `platformPublished = true`, gated by the existing `RolesGuard`/`@Roles('platform_operator')` pattern. **v1 ships tenant-level sharing only** — the actual pain point UC-S2 describes.

New module `apps/api/src/modules/skills/`, mirroring `tools/` exactly (domain/ports, application use-cases, `infrastructure/prisma-skill.repository.ts`, `interface/skills.controller.ts`).

### 5.3 Progressive disclosure — a wire-shape change, not just a UI concept

`GetRuntimeConfigUseCase`'s response must **not** inline skill instructions into `system_prompt`. It returns `skills: SkillSummaryDto[]` (id, version, name, description only — the ~15-token blurb) alongside `system_prompt`; the Python side builds the effective base prompt by appending only these blurbs. Full `instructions`/`tools`/`knowledgeFilters` are fetched **lazily** through a new internal endpoint (`GET /internal/skills/{id}/versions/{version}/body`, `InternalTokenGuard`-guarded like the rest of `/internal`), called only when the Skill node's trigger fires, cached in-process for that session once triggered. "Release on exit" (A5.2) is realized in the Skill node executor by scoping injected instructions to that node's own sub-turns — never written into persistent `SessionMemory`, so the next unrelated turn's prompt doesn't carry them forward.

### 5.4 Validation

- Skills get their own two-gate validator (own instructions non-empty, HITL gate fully specified if present per R-H1) living in the `skills` module — a different aggregate's lifecycle than `deployment-config`'s.
- The agent config's Gate B gains `skillRefsKnownAndEnabledRule` (V-12), structurally identical to today's `toolRefsKnownRule`.

## 6. HITL

### 6.1 Storage/lifecycle

```
ReviewerGroup   (tenantId, name, members[], notificationChannels)
HitlGate        (tenantId, attachmentKind: tool|skill|graph_node, attachmentRef,
                  triggerCondition json, gateType, reviewerGroupId, slaSeconds,
                  holdTreatmentText, timeoutBehavior, escalateToGroupId?, notifyChannels[],
                  environments[], status)
HitlDecision    (tenantId, sessionId, gateId, utteranceSeq, proposedAction json,
                  reviewerId?, decision: pending|approved|denied|edited_approved|
                  timed_out|escalated|deferred, editedArguments?, justificationNote?,
                  decidedAt, latencyMs, outcomeNotifiedAt?)
```

`HitlGate` rows are referenced by **id** from `hitl.gates[]` (a reference, not an inline block) — mirrors how `agent.tools[]` already references `ToolDefinition` by string rather than inlining it. This is what lets a gate "travel with" a skill (R-S6). `HitlDecision` is simultaneously the audit trail (R-H7), the live reviewer queue (`status='pending'`), and the R-H10 metrics source (hit rate, approval rate, median/p95 latency, timeout rate all derive from aggregate queries over this one table).

### 6.2 How a blocking gate pauses a live voice turn

Less disruptive than it first looks — the existing concurrency model already accommodates it:

1. The interpreter pauses at the HITL node by `await`-ing an asyncio future — no different in kind from awaiting a slow tool call, just a longer bound (up to the SLA, e.g. 45s).
2. Hold treatment and periodic reassurance (R-H5) reuse `_speak()` exactly as it exists today, invoked as a side effect by the HITL node executor at gate-entry and on a cancellable timer.
3. **Decision delivery**: there is currently zero push channel from the control plane back to the Python agent — `/internal` is entirely agent-initiated request/response. Pragmatic, pattern-consistent choice for a first cut: **short-polling** — the HITL node executor polls `GET /internal/hitl-decisions/{id}` every ~1–2s until resolved or its own locally-tracked SLA deadline elapses (defense-in-depth alongside a server-side `hitl-sla-sweep` BullMQ job). Against a 30–45s SLA, 1–2s poll latency is immaterial. A push channel (SSE, or LiveKit room data messages since the agent is already a room participant) is a reasonable fast-follow, explicitly not required for v1.
4. **The one-in-flight-utterance invariant doesn't need to change** — a HITL wait just extends how long `_process_utterance` takes; the existing bounded queue (depth 3, oldest-dropped-on-overflow, FR-LLM-2) already absorbs a caller who keeps talking while the turn is stuck. Flagged as a place the current architecture already accommodates the new requirement, not a gap.
5. Caller abandonment during a gate (R-H10) hooks into existing session/transport disconnect handling to finalize the `HitlDecision` row.

### 6.3 Reviewer console backend / deferred approval

Standard CRUD in a new `hitl` module (`GET /hitl/queue`, `POST /hitl/decisions/{id}/approve|deny|edit-approve`) — same use-case/controller shape as elsewhere; no server-side push infra needed (console polling is a frontend concern).

**Deferred approval's async execution is the one genuinely new capability**: today `ToolExecutor.invoke` only runs inside the live pipeline. A deferred approval must execute a tool call out of band, hours later. Since a `ToolDefinition` invocation is a plain HTTP call with no vendor SDK, it is **not** bound by ADR-001's vendor-SDK-isolation rule — cleanest choice is a small `ToolInvokerService` reimplemented directly in NestJS (mirroring `ToolExecutor`'s HTTP-call/10s-timeout/32KB-cap shape) rather than round-tripping through Python for something never vendor-bound. A new `hitl-deferred-followup` BullMQ processor executes the queued call on approval and calls a new `NotificationPort` (**no notification channel exists anywhere in the codebase today** — genuinely new infra) to notify the caller and reviewer console. v1 ships in-app/email channels only; SMS is BL-077, deferred.

### 6.4 Pre-speech and post-hoc — no new mechanism needed

Pre-speech review is mechanically identical to a blocking gate, positioned between an LLM-compose node and Speak, with the "proposed action" being spoken text rather than a tool call — same `HitlGate`/`HitlDecision` machinery, different `attachmentKind`. Post-hoc review (BL-076, deferred) never touches the live pipeline — a BullMQ job would create sampled `HitlDecision` rows after session-end from the completed transcript.

Supervisor whisper (BL-075, deferred) would reuse the same polling mechanism, not a separate channel: turn-start checks a lightweight endpoint for a pending whisper, injects it as a one-shot system message, marks it consumed.

## 7. Validation — V-1..V-12 onto the existing Gate A/B pattern

| Rule | Gate | Where it lives | Enforced in phase |
|---|---|---|---|
| V-1 critical path ≤ budget | New, production-publish-only | `domain/critical-path.ts` (§3.3) | 10 |
| V-2 loop guards present | Gate A structural | new `domain/graph-rules.ts` | 11 |
| V-3 sub-agent nesting ≤2 | Gate B (needs config-repo read of referenced sub-agent) | `graph-rules.ts` | 15 |
| V-4 no cycles outside Loop | Gate A structural (DFS, excludes Loop-internal back-edges) | `graph-rules.ts` | 11 |
| V-5 `on_error`/`on_deadline` present | Gate A structural, production-publish | `graph-rules.ts` | 9 (`on_error`), 10 (`on_deadline`, needs deadline-degradation runtime) |
| V-6 consequential tool gated/acked | Gate B (needs `ToolDefinition.consequential` + `HitlGate` lookup) | `combination-rules.ts` | 14 |
| V-7 blocking gate reviewer coverage | Gate B (needs `ReviewerGroup` read) | `combination-rules.ts` | 14 |
| V-8 `auto_approve` timeout needs written ack | Gate A structural on `HitlGate` | own field-presence check in `hitl` module (gates aren't inlined YAML) | 14 |
| V-9 knowledge source not stale | Gate B (needs `KnowledgeSource` read) | `combination-rules.ts` | 12a |
| V-10 retrieval stage budgets sum ≤ budget | Gate A structural (pure arithmetic) | pure function over `knowledge.pipeline` | 12b |
| V-11 base prompt+skills+tools ≤ ceiling | Gate A structural, **warning-class** | new `domain/prompt-cost.ts` estimator | 8 (tools term), 13 (skills term completes the sum) |
| V-12 skill referenced exists/enabled | Gate B (needs `SKILL_REPOSITORY` read) | `combination-rules.ts`, mirrors `toolRefsKnownRule` | 13 |

**Contract change required for V-11**: `ConfigError`/`ConfigErrorDto` currently has no severity concept — needs a `severity: 'error' | 'warning'` field added, since V-11 is explicitly a warn-not-block rule (unlike everything else in this table, which blocks production publish).

**Don't enforce a rule "early but incomplete."** V-5 and V-11 each naturally split into two enforcement dates because the rule's second half depends on a later phase's entity — track each half as its own line in that phase's QA acceptance criteria rather than marking the rule "done" prematurely.

## 8. New Prisma models / modules / Python packages (named)

**Prisma** (`apps/api/prisma/schema.prisma`, one additive migration per phase, no destructive changes — same precedent as the existing additive-column history):
`ConfigVersion` (Phase 9), `Skill`/`SkillVersion` (Phase 13), `ReviewerGroup`/`HitlGate`/`HitlDecision` (Phase 14), `KnowledgeSource`/`KnowledgeChunk`(pgvector)/`KnowledgeGap` (Phase 12a/b); additive columns on `ToolDefinition` (`consequential`, `lane`, `perSessionCap`, `perTurnCap`, Phase 8).

**NestJS modules** (`apps/api/src/modules/`):
- `deployment-config/` gains config-version use cases + repository (Phase 9).
- `skills/` — new, four layers mirroring `tools/` (Phase 13).
- `hitl/` — new, four layers: gates, reviewer groups, decisions/queue, whisper (Phase 14).
- `knowledge/` — new, four layers: sources CRUD, ingestion trigger, playground query, gap report (Phase 12a/b).
- `common/notifications/` — new port (`NotificationPort`) + in-app/email adapters (Phase 14) — no precedent exists today.
- `jobs/` gains `knowledge-ingest.processor.ts` (12a), `hitl-sla-sweep.processor.ts`, `hitl-deferred-followup.processor.ts` (14).

**Python** (`apps/agent/src/avatar_agent/`):
- `orchestration/graph/` — `ir.py`, `interpreter.py`, `nodes/{13 types}.py` (Phase 9, extended through 11/13/14/15).
- `contracts/runtime_config.py` gains `ReasoningGraph`, per-type `GraphNodeConfig` union, `SkillSummary`, `HitlGateConfig`, `KnowledgePipelineConfig` — mirrored 1:1 in `packages/contracts/src/agent-config/schema.ts` (Phase 9 onward, contract-test-enforced).
- `ports/embedding.py` + `adapters/embedding/*` + registry additions (Phase 12a).
- `services/ai_service.py` — new standalone process entrypoint for embedding (Phase 12a) — the biggest new infra component in this plan (§4.3).
- `orchestration/graph/nodes/hitl.py` — owns the short-poll client against `/internal/hitl-decisions/{id}` (Phase 14).
