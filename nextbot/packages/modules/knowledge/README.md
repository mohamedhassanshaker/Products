# @nextbot/knowledge

Target Architecture Blueprint Phase 7b (BL-38, ADR-0018, LLD §14.4) — Module B:
Knowledge and Graph RAG. Collections and sources, and the full 9-stage ingestion
pipeline (Ingest → Parse → Chunk → ExtractEntities → Resolve → BuildGraph →
CommunityDetection → CommunitySummaries → Embed → Index), pinned to a Phase 2
model-catalog embedding model. Builds on Phase 7a's `@nextbot/graph-store`
(`withTenantGraph()`, `Neo4jGraphStore`) exclusively for all graph-store I/O.

Phase 8 (BL-39, FR-KB-04) adds the Graph Explorer — a read-only entity/relation/
community browser with per-relation provenance drill-down, reached from a
collection's Generations table. **It reads exclusively through Postgres**
(`graph-explorer-service.ts`), never through `@nextbot/graph-store` — every field it
shows (canonical name, type, summary, community, relation type/weight, provenance) is
already the Postgres side's own system-of-record data per this file's own §14.4.1
split; the graph store's node/edge records deliberately carry no name/summary/text
field, so a live Neo4j traversal would add latency for zero new information a
read-only inspection screen needs. See `docs/NEXUS_STATE.md`'s 2026-08-29 dev
decision-log entry (Phase 8) for the full write-up, including the visualization-
approach decision (table-based navigator, not a graph-canvas — no charting/
graph-rendering library exists anywhere in this monorepo).

## Scope this phase covers

- `knowledge_collection`/`knowledge_source`/`knowledge_index_generation`/
  `knowledge_document`/`knowledge_chunk` + the five `knowledge_embedding_d*` tables.
- The Postgres side of the graph (`graph_entity`/`graph_edge`/`graph_community`/
  `graph_entity_merge_candidate`) — structure/ids/summary text; the graph store
  itself holds structure+ids only (ADR-0018 §2.4).
- `knowledge_ingestion_job` — the Postgres work table (`FOR UPDATE SKIP LOCKED`)
  drained by a scheduled pump, per LLD §14.4.3's own "no queue library" guidance.
- Embedding-model pinning: a generation's `embedding_catalog_entry_id`/`dimension`
  are stamped once at generation-build time from the collection's
  `embedding_route_version_id` and never updated afterward.
- Residency enforcement at collection-configuration time (`KNOWLEDGE_REGION_MISMATCH`).
- ACL capture at ingestion, propagated to every chunk/entity/edge (retrieval-time
  filtering is Phase 9/10's job — not built here).
- Console: Knowledge Collections list/detail + source management
  (`apps/web/app/(admin)/knowledge/**`).

## Explicitly out of scope (later phases)

Knowledge governance's remaining pieces beyond residency/ACL capture (Phase 11) — real
per-caller `effectiveScope`/ACL narrowing via the §14.2 permission-intersection
evaluator (this module still reuses the Phase 8/9 "full generation ACL union"
precedent), PII read-time re-masking against the requesting agent's trust level,
retention/purge cascade, freshness/staleness beyond the collection-level max-staleness
check Phase 10 already enforces, and coverage reporting. The Resolve-stage
human-review queue's console UI (`graph_entity_merge_candidate` — FR-KB-02) is also
not built: it is a distinct feature from Phase 8's FR-KB-04 explorer per
`docs/BACKLOG.md`'s own BL-39 scope line, which names only entities/relations/
communities/provenance; the repository functions (`listMergeCandidatesForGeneration`/
`decideMergeCandidate`) already exist from Phase 7b, unused by any HTTP route or
console screen. Multi-collection fan-out for the bounded retrieval agent (Phase 10
ships `spec.knowledge.collections` as an array but its executor only ever reads
`collectionIds[0]` — see Phase 10's own section below).

## Phase 9 — Four retrieval strategies + Retrieval Playground (BL-40, FR-KB-05)

`application/retrieval/` adds four independently-callable strategy functions
(`runVectorRetrieval`/`runGraphLocalRetrieval`/`runGraphGlobalRetrieval`/
`runHybridRetrieval`) plus `runRetrievalPlayground`, the orchestrator behind
`POST /api/v1/admin/knowledge/playground` (console: `/knowledge/{id}/playground`).
Full detail, disclosed design decisions, and verification results are in
`docs/plans/target-architecture-blueprint-phase9-plan.md`. Summary:

- **Scope boundary vs. Phase 10**: this phase ships the four strategy PRIMITIVES and a
  human-driven comparison playground — no query classifier (`auto` strategy
  selection), no sufficiency-check/expansion loop, no `refuseWhenUngrounded` runtime
  enforcement, no `retrieval_event` persistence. All four of those are LLD §14.4.4's
  bounded retrieval AGENT (`knowledge/application/retrieval-executor.ts`), explicitly
  Phase 10's own exit gate, not this phase's.
- Vector: top-k cosine similarity over `knowledge_chunk` embeddings
  (`infrastructure/embedding-table.ts#topKByCosineSimilarity`, drizzle-orm's
  `cosineDistance()`). GraphLocal: literal substring anchor-entity matching
  (`infrastructure/graph-repository.ts#findAnchorEntitiesByQueryMention`, no NLU) +
  `GraphStorePort.neighbourhood()` (through `withTenantGraph()`, no new access path) +
  real relation-path evidence. GraphGlobal: vector search over
  `kind='CommunitySummary'` embeddings ("map") + a real completion call synthesizing
  an answer ("reduce") — the only strategy making two real model calls, matching
  §7.4's "Highest" relative-cost column. Hybrid: vector recall + a bounded 1-hop
  graph expansion of the recalled chunks' own entities + a deterministic (non-LLM)
  rerank boost for chunks whose entities survived the expansion.
- Hop/node/topK bounds are clamped in `domain/retrieval-bounds.ts` (hard ceilings:
  maxHops 4, maxNodes 2000, topK 100 — mirroring LLD §14.4.4's `RetrievalRequestSchema`)
  BEFORE reaching `GraphStorePort.neighbourhood()`, which separately enforces its own
  ceiling server-side — two independent layers.
- `groundednessScore`/`latencyMs`/`costUsd` metrics per strategy (Blueprint Figure 5).
  Cost is a real estimate against the exact `model_catalog_entry` that served the
  call (`callModelGatewayEmbedding`'s own returned `catalogEntryId`), never a
  placeholder.
- **Not shipped this phase, disclosed**: `retrieval_event` (LLD §14.4.2) — its
  `agent_run_id`/`scope_hash` (the §14.2 evaluator result)/`conversation_id`-tied
  columns belong to a real turn or Phase 10 dispatch's context, which a human-driven
  admin comparison tool doesn't have; the playground response schema itself
  (`RetrievalPlaygroundResponseSchema`) doesn't require a `retrievalEventId` either.
  Per-caller ACL/`effectiveScope` filtering — the playground is `knowledge:Read`-gated
  admin tooling showing a generation's full content, the same precedent the Graph
  Explorer (Phase 8) already established.

## Phase 10 — Bounded retrieval agent + citations (BL-41, FR-KB-05/06/07)

`application/retrieval/retrieval-executor.ts`'s `runBoundedRetrieval` — LLD §14.4.4's
loop for real: classify (or use the pinned strategy) → retrieve → sufficiency-check →
expand (hard-capped, `domain/retrieval-bounds.ts#clampMaxExpansions`) → answer → THE
safety-critical grounding check (`refuseWhenUngrounded`, enforced by discarding an
already-produced model answer, never merely skipping the ask) → write `retrieval_event`
→ return. Called from `orchestration/application/turn-pipeline.ts` — the ONE call site
LLD §14.4.4 names — for a knowledge-scoped agent version's "reply" action.

- **`retrieval_event` is shipped for real this phase** (`packages/db/src/schema/
  knowledge.ts`, migrations `0068`/`0069`) — deferred by both Phase 7b's and Phase 9's
  own schema/dispatch, this is the phase that actually reads/writes it.
- **Query classification** (`application/retrieval/query-classifier.ts`): a
  deterministic, zero-cost anchor check first (Phase 9's own
  `findAnchorEntitiesByQueryMention`, reused) — no anchor → `Vector`, no model call.
  Only when an anchor exists does a real, cheap `plannerRoute` (default `chat.router`)
  structured-output call decide narrow (`GraphLocal`) vs. broad (`GraphGlobal`).
- **Sufficiency check** (`application/retrieval/sufficiency-check.ts`): same cheap
  route, `SufficiencySchema`. Its "insufficient" opinion can only ever cause the
  bounded loop's `for` statement to continue to its NEXT iteration — the loop's own
  upper bound (`attempt <= maxExpansions`) is what actually stops it, never the model.
- **Budget**: reuses Phase 9's own real per-call cost measurement, accumulated across
  the loop — NOT Model Gateway v2's `model_budget` (Day/Month-scoped, a different
  concept) and NOT `authz`'s `BudgetSchema` evaluator (needs a persisted
  `ScopeDescriptor` on `agent_definition_version` that doesn't exist yet — see
  `packages/modules/authz`'s own already-disclosed module-allow-list note).
- **Citations**: `@nextbot/contracts`'s new `CitationSchema` (LLD §14.4.4) rides on
  `TextPayload.citations?: Citation[]` — no new `MessageContentType`, every channel
  degrades for free. GraphGlobal's community-shaped evidence is uncitable as-is
  (`CitationSchema` structurally requires a real chunk), so it's derived into real
  chunk-grounded citations from its top communities' member entities' edges
  (`deriveGraphGlobalChunkEvidence`) rather than left un-citable or faked.
- **`agentVersion` YAML gains `spec.knowledge`/`spec.plannerRoute`**
  (`@nextbot/contracts`'s `agent-platform.ts`) — Blueprint §7.5's exact example shape,
  resolved once at save time (`@nextbot/agent-platform`'s `createAgentDefinitionVersion`):
  collection NAME pins resolved via this module's own new
  `resolveKnowledgeCollectionPin` (mirrors `@nextbot/skills`'s `resolveSkillPin`
  discipline — first unresolvable reference fails the save). New module allow-list
  edges: `orchestration → knowledge`, `agent-platform → knowledge`.
- **Disclosed narrowing (single-collection)**: `spec.knowledge.collections` accepts an
  array, but `runBoundedRetrieval` only ever reads `collectionIds[0]` — Phase 9's four
  strategy functions are single-collection by design, and merging evidence pools
  across independently-built indexes (score normalization, cross-collection ACL
  reconciliation) is real, separate complexity left for a future phase.
- **Disclosed narrowing (ACL scope)**: same "full generation ACL union" precedent
  Phase 8/9 already established (real per-caller `effectiveScope` filtering via the
  §14.2 evaluator is Phase 11/14 territory — `agent_definition_version` has no
  persisted `ScopeDescriptor` yet).
- **Citations render in three places**: Conversations (`ConversationDetail.tsx`'s
  transcript, straight off the persisted message payload), Runtime Traces
  (`ConversationDetail.tsx`'s own Trace Viewer section — the real span-level trace UI
  in this codebase, NOT the separate `RuntimeTraces.tsx` flat run-list screen, which is
  explicitly out of scope for span-level data by its own pre-existing doc comment), and
  the customer widget (`TextBubble.tsx`'s new `CitationChips`, tested against the real
  widget artifact).

Full detail, disclosed decisions, and verification results are in
`docs/plans/target-architecture-blueprint-plan.md`'s Phase 10 section and
`docs/NEXUS_STATE.md`'s 2026-08-29 dev decision-log entry (Phase 10).

## Disclosed scope decisions

1. **No new `apps/ingest` deployable.** LLD §15.3.2 names a dedicated deployable
   for this pipeline's resource profile. This phase ships the pipeline's logic and
   scheduled jobs (`knowledge.ingestion-pump`, `knowledge.lease-reaper`,
   `knowledge.source-sync`) inside `apps/worker` instead, reusing its existing
   `ScheduledJob` contract verbatim — matching the fast-follow reconciliation job's
   own brief, which explicitly pointed at `apps/worker`'s idiom. Containerizing a
   genuinely separate deployable (so long CPU-bound ingestion work doesn't compete
   with `apps/worker`'s short reconciliation sweeps) is `nexus-deploy` scope, not
   `nexus-dev`'s, and the `ScheduledJob` contract is identical either way — only the
   process boundary would change.
2. **No object-storage abstraction existed anywhere in this codebase before this
   phase.** `infrastructure/upload-store.ts` is a minimal, local-disk-backed store
   scoped to this module only, sufficient for a real small-document ingest/e2e test.
   A shared `@nextbot/object-store` package is a reasonable future extraction once a
   second real consumer needs one (e.g. escalation attachments).
3. **`Upload`/`Url` source kinds get a real Ingest-stage fetch; `McpResource`/
   `Connector` do not (yet).** Neither `@nextbot/mcp-registry` nor
   `@nextbot/connectors` exposes a "read a resource"/"invoke and get a result"
   function today. Both kinds are fully modeled in the schema/locator/ACL-capture
   path (so console source management and the ACL data model are real for all four
   kinds), but their content fetch is a per-document failure
   (`SOURCE_KIND_NOT_YET_INTEGRATED`) rather than attempted — never blocking the
   source or other sources.
4. **Chunk token counts are a `chars/4` heuristic**, not a real tokenizer — no
   tokenizer library exists in this codebase yet; adding one is a dependency
   decision outside this phase's bar-check scope. Advisory only (chunk sizing/
   overlap), never a billing or context-window-exactness path.
5. **Community detection is single-level (level 0) only**, via a real, deterministic
   label-propagation implementation (`domain/community-detect.ts`) — not a literal
   Leiden/Louvain, and not hierarchical. `graph_community.level`/`parent_id` are
   ready for a later phase to add real levels without a schema change. FR-KB-02's
   "hierarchical clustering" aspiration is a quality refinement, not a structural
   requirement a working pipeline must satisfy on day one.
6. **`CommunitySummaries` and the entity/community-embedding half of `Embed` are ONE
   job per generation each (looping internally over every stale item), not one job
   row per community/entity.** `knowledge_ingestion_job` has no `community_id`
   column, and its idempotency key (`coalesce(document_id, source_id,
   generation_id)`) would collapse multiple same-generation, no-document/source rows
   onto one key regardless. The OBSERVABLE behavior LLD asks for — only stale items
   regenerate, one item's failure never blocks the rest — is preserved via an
   internal per-item `try`/`catch` loop. `Ingest` (per source), `Parse`/`Chunk`/
   `ExtractEntities` (per document) DO get real, separate job rows — those stages
   have a real schema column to key on.
7. **No entity-level summarization stage.** FR-KB-02's own pipeline stage list only
   names "community summaries", not entity summaries — `graph_entity.summary` stays
   `NULL` for every entity this phase produces (a legitimate state per its own
   nullable column), and the Embed stage's "entity summary" embedding target simply
   has nothing to embed yet. A later phase can add a dedicated entity-summarization
   step without a schema change.
8. **Mid-flight route-version consistency reads the collection's current pin at
   each stage**, rather than a route-version id threaded through every job's input.
   The hard FR-KB-03 guarantee — an already-built generation's
   `embedding_catalog_entry_id`/`dimension` are immutable once stamped — is fully
   enforced via the stamped column (there is no code path that ever updates it).
   This is a disclosed, minor simplification only for the theoretical case of an
   admin changing a collection's route-key config in the middle of an active build.

## RBAC

Two new modules (`packages/contracts/src/iam.ts`'s `RbacModule` union): `knowledge`
(collections/sources CRUD, ingestion status, generations) and `knowledge_config`
(the narrower embedding/rerank model choice + chunking/extraction policy fields) —
split so a curator can add sources without changing retrieval behavior, per the
dispatch's own instruction (sourced from `docs/blueprint/NextBot-Target-Architecture-
Blueprint.md` §5.2, which predates/supersedes `PRODUCT_SPECIFICATION.md`'s
pre-blueprint FR-ADM-02 module list — confirmed no such module table exists in the
current spec itself).
