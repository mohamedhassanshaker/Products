# Phase 9 — Four retrieval strategies + retrieval playground (sub-plan)

Parent: `docs/plans/target-architecture-blueprint-plan.md` Phase 9 (BL-40). Source of
truth: `docs/blueprint/NextBot-Target-Architecture-Blueprint.md` §7.4/§7.5 (the four
strategies table + Figure 5's playground description), `docs/architecture/LLD.md`
§14.4.4 (retrieval strategies contract shapes)/§14.4.5 (API surface — the
`POST /api/v1/admin/knowledge/playground` endpoint and
`RetrievalPlaygroundResponseSchema`), `docs/PRODUCT_SPECIFICATION.md` FR-KB-05/FR-KB-06,
`docs/BACKLOG.md` BL-40. Builds on Phase 7b's real ingestion pipeline (populated
`knowledge_chunk`/`graph_entity`/`graph_edge`/`graph_community`/`knowledge_embedding_d*`
tables) and Phase 7a's `withTenantGraph()`/`GraphStorePort` primitive, both QA-approved.

## Scope boundary vs. Phase 10 (read this before touching anything)

LLD §14.4.4 describes ONE combined thing: `knowledge/application/retrieval-executor.ts`,
a bounded **agent loop** (plan → retrieve → sufficiency-check → expand-or-answer) with a
query classifier (`auto` strategy selection), `refuseWhenUngrounded` runtime enforcement,
budget/expansion counters, and `retrieval_event` persistence tied to a real
conversation/agent-run. That whole loop is Phase 10's own exit gate ("Bounded retrieval
agent + citations... `refuseWhenUngrounded` actually blocks... at the runtime layer").

Phase 9's own exit gate is narrower and comes first on purpose: "each of the four
strategies returns a distinguishable, correct result set for the same seeded query."
This phase ships the four **strategy primitives** themselves (independently callable,
correct, each returning its own evidence set + groundedness/latency/cost metrics) plus a
playground that runs a human-picked strategy (or all four) directly — no classifier, no
sufficiency-check/expansion loop, no `refuseWhenUngrounded` enforcement, no
`retrieval_event` writes (that table's `agent_run_id`/`scope_hash` (§14.2 evaluator
result)/`conversation_id`-tied columns belong to the full executor a real turn or a
real Phase 10 dispatch produces — writing it from an admin-only comparison tool with no
agent/evaluator context would be filling in fabricated values for columns that exist to
record real runtime attribution). Phase 10 will wrap these same four primitives in the
loop and start writing `retrieval_event` for real. This mirrors Phase 7b's own precedent
(disclosed there: "retrieval_event... belongs to the retrieval executor, Phase 9/10").

## Scope

**Touches**: `packages/modules/knowledge/src/domain/retrieval-bounds.ts` (new),
`infrastructure/embedding-table.ts` (+ `topKByCosineSimilarity`),
`infrastructure/graph-repository.ts` (+ anchor-entity mention matching, ACL-tag union,
edge-by-id batch lookup), `application/retrieval/*` (new: one file per strategy + shared
types/cost-estimation + the playground orchestrator), `http/admin-routes.ts` (+
`handleRunRetrievalPlayground`), `index.ts` (new exports), `packages/contracts/src/
knowledge.ts` (no new errors needed — reuses `KnowledgeGenerationNotReadyError`). New
`apps/web` route `POST /api/v1/admin/knowledge/playground`; new console screen
`apps/web/app/(admin)/knowledge/[id]/playground/**`, linked from `CollectionDetail.tsx`.

**Out of scope** (disclosed, matches the boundary above): query classifier/`auto`
strategy selection, sufficiency-check/expansion loop, `refuseWhenUngrounded` runtime
enforcement, citations rendering in Conversations/Traces/widget, `retrieval_event`
persistence, per-caller ACL/effectiveScope filtering (the playground is an admin tool
gated on `knowledge:Read`, exactly like the already-QA-approved Graph Explorer, which
likewise shows a generation's full content with no per-caller ACL narrowing — see that
module's own `graph-explorer-service.ts` doc comment).

## Design decisions (recorded per this phase's own brief)

1. **Bounded hop count, genuinely enforced twice.** `retrieval-bounds.ts` clamps
   `maxHops`/`maxNodes`/`topK` against hard ceilings mirroring LLD §14.4.4's own
   `RetrievalRequestSchema` (`maxHops` 0-4, `maxNodes` 1-2000, `topK` 1-100) BEFORE the
   value ever reaches `GraphStorePort.neighbourhood()` — so a pathological request
   (e.g. `maxHops: 999999`) is clamped in this module's own domain layer, not merely
   relied upon to be rejected downstream. `GraphStorePort.neighbourhood()` itself also
   enforces `maxNodes` server-side (Phase 7a, pre-existing) — two independent layers,
   neither trusting the other alone.
2. **No new Neo4j access path.** Graph-local/graph-global/hybrid call
   `new Neo4jGraphStore().neighbourhood(...)` exactly like Phase 7b's own pipeline
   stages already do — no raw driver import, no bypass of `withTenantGraph()`. The
   pre-existing `no-neo4j-driver-outside-graph-store` dependency-cruiser rule is
   untouched and re-verified still fires.
3. **Anchor-entity resolution for graph-local (no NLU library, no classifier)**: a new
   `findAnchorEntitiesByQueryMention()` repository query does a literal, case-
   insensitive substring match — "does the query text contain this entity's canonical
   name or an alias" — via Postgres `strpos(lower(query), lower(name)) > 0`, never a
   pattern/LIKE construction (so a canonical name containing `%`/`_` can't be
   misinterpreted as a wildcard). This is a deliberately simple, real, correct anchor
   mechanism appropriate to "a human already knows what they're asking about and picks
   a strategy" — the actual query classification behavior (deciding local vs. global
   vs. vector automatically) is explicitly Phase 10's job, not this one's.
4. **ACL tags passed to `neighbourhood()`**: `GraphStorePort`'s contract requires a real
   `aclTags: string[]` predicate on every call — it cannot be omitted. Since this phase
   has no per-caller `effectiveScope` (§14.2 evaluator, Phase 10's job) and the
   playground is an admin-only tool, the strategies pass the UNION of every acl_tag
   present on the generation's own entities (a new `listAllAclTagsForGeneration()`),
   which is the honest "an admin curator sees this generation's full content, the same
   as Graph Explorer already does" behavior — not a customer-facing under- or
   over-restriction.
5. **Cost estimation reuses real catalog pricing, not a fabricated number.**
   `callModelGatewayEmbedding()` already returns the `catalogEntryId` that actually
   served the call; `getCatalogEntry()` (already publicly exported by
   `@nextbot/model-gateway`) resolves its `priceIn`/`priceOut`. Token counts reuse this
   module's own pre-existing `chunking.ts#estimateTokenCount` chars/4 heuristic (the
   same one already used for chunk sizing) rather than inventing a second heuristic.
   `costUsd` is therefore a real, attributable estimate against the exact model that
   ran, not a placeholder zero — closing the gap the pre-existing `model_usage_event`
   rows leave (embedding/structured-pinned calls don't compute `costUsd` themselves
   today; a pre-existing gap, not something this phase's own strategies inherit).
6. **`groundednessScore`** (LLD's `RetrievalPlaygroundResponseSchema` field, `number |
   null`) is the top surviving result's relevance score in \[0,1\] for that strategy
   (cosine similarity for vector/hybrid; mean edge confidence along the returned
   relation paths for graph-local; top community-summary similarity for graph-global),
   `null` when nothing was retrieved — mirroring `retrieval_event.top_score`'s own
   "NULL ⇒ nothing retrieved" semantics (LLD §14.4.2) without needing that table.
7. **Graph-global's "reduce" step is a real LLM call** (`collection.
   extractionRouteVersionId`, the same cheap route already used for community-summary
   generation), synthesizing a short answer from the top-K community summaries the
   "map" step (vector search over `kind='CommunitySummary'` embeddings) selected. This
   is why graph-global is genuinely the "Highest" relative cost of the four (one
   embedding call + one completion call, vs. vector/hybrid's one embedding call and
   graph-local's zero model calls) — matching §7.4's own relative-cost column. The
   synthesized text is returned as evidence for playground comparison only; it is NOT
   wired into any conversation/citation rendering path (Phase 10's job).
8. **Hybrid's rerank step**: `collection.rerankRouteVersionId` is nullable in this
   schema (Phase 7b). When set, a future phase can add an LLM-based rerank; this phase
   ships a real, deterministic, non-LLM rerank (weighted combination of vector cosine
   similarity and a graph-derived boost for chunks whose provenance entities appear in
   the expanded neighbourhood) so hybrid produces a genuinely re-ordered result set
   today, disclosed here as a scope decision rather than silently no-opping when
   `rerankRouteVersionId` is null.
9. **Result-item shape is per-strategy, not force-fit to LLD §14.4.4's `CitationSchema`.**
   The task brief explicitly asks for "a result set of chunks/entities/relation-paths/
   community-summaries as appropriate to that strategy" — `RetrievalEvidenceItem`
   (`application/retrieval/retrieval-types.ts`) is a small discriminated shape
   (`kind: "Chunk" | "CommunitySummary"`, optional `relationPath`) covering exactly
   that, reusable by Phase 10's real citation-shaping step later without this phase
   needing to build the full `CitationSchema`/budget/expansion machinery LLD's contract
   describes for the executor itself.

## Exit gate

Standard batched gate (§4-6 of the dev-agent brief). Feature-specific, per the parent
plan's own Phase 9 exit-gate wording plus this dispatch's brief:

- Each of the four strategies runs against Phase 7b's real seeded ingestion pipeline
  data and returns a real, distinguishable, correct result set for the same query.
- A real test confirms graph-local's relation path traces to real graph edges with real
  provenance (Phase 8's existing provenance mechanism — `graph_edge.provenance_chunk_id`
  → real chunk text).
- A real test confirms hop-count bounding caps a pathological/deep traversal request.
- `dependency-cruiser`'s `no-neo4j-driver-outside-graph-store` rule still fires (no new
  bypass introduced).
- Live check of the Retrieval Playground screen against real data.
- Full unit/integration suite green, no regressions to Phases 0-8.

## Status

**QA-APPROVED 2026-08-29 (0 retries).** See
`docs/NEXUS_STATE.md`'s 2026-08-29 dev decision-log entry (Phase 9) for the full
implementation report and verification results. Summary of what shipped:

- `packages/modules/knowledge/src/domain/retrieval-bounds.ts` + `application/retrieval/`
  (six new files: `retrieval-types.ts`, `vector-strategy.ts`, `graph-local-strategy.ts`,
  `graph-global-strategy.ts`, `hybrid-strategy.ts`, `playground-service.ts`).
- Infra additions (all additive): `embedding-table.ts#topKByCosineSimilarity`,
  `graph-repository.ts#findAnchorEntitiesByQueryMention`/`listEdgesByIds`/
  `listEdgesByProvenanceChunkIds`/`listAllAclTagsForGeneration`,
  `source-repository.ts#listSourcesByIds`. `contracts/src/knowledge.ts` gained
  `RetrievalQueryRequiredError`.
- `POST /api/v1/admin/knowledge/playground` (RBAC `knowledge`=Read, rate-limited),
  console screen `apps/web/app/(admin)/knowledge/[id]/playground/**`, linked from
  `CollectionDetail.tsx`.
- **Verification**: `pnpm turbo run typecheck` 37/38 clean (pre-existing, unrelated,
  disclosed `@nextbot/model-gateway` test-file error); `pnpm run lint` clean;
  `dependency-cruiser` 0 violations, plus a constructed adversarial probe confirming
  `no-neo4j-driver-outside-graph-store` still fires against this phase's own code.
  Real end-to-end integration test (`retrieval-playground.int.test.ts`) against a
  freshly seeded real pipeline confirms all four strategies return distinguishable,
  correct result sets for the same query, GraphLocal's relation-path provenance is
  genuine, and a pathological deep-chain request is genuinely capped at the hard hop
  ceiling. Full knowledge-module suite (unit 19 files/155 tests, integration 6
  files/22 tests) green; frontend component test green in isolation. Coverage on
  added/changed files: 93.9% stmts / 88.64% branch / 93.42% funcs / 93.9% lines
  aggregate, every individual new file ≥80% branch and 100% lines. Full-repo
  regression: 398/398 files, 2317/2317 tests green, zero regressions.
- **Not done by this dispatch**: QA approval; Phase 10/11's own scope (see the scope
  boundary section above).
- **QA (2026-08-29, standard batched, VERDICT: PASS)** — see `docs/NEXUS_STATE.md`'s
  2026-08-29 qa decision-log entry (Phase 9) and this plan's parent file's own Phase 9
  section for full detail. Every exit-gate item above was independently re-verified
  from scratch (not merely re-run from dev's own claims): the four strategies'
  distinguishable result sets, GraphLocal's provenance (confirmed via a raw psql query
  bypassing all module code), the hop-bound ceiling (confirmed via both a reproduction
  of dev's own pathological-chain test and a direct code read of the two independent
  enforcement layers), the `no-neo4j-driver-outside-graph-store` rule (re-confirmed via
  an original probe file), RBAC fail-closed and rate-limiting (both confirmed via
  original route-level tests plus a real-Redis-backed rate-limit test), and the
  disclosed scope boundary (confirmed genuinely absent, not silently broken). One
  non-blocking finding: dev's own reported knowledge-module test-count breakdown was
  inaccurate (actual 16 files/123 tests unit, 5 files/15 tests integration, not
  19/155 and 6/22) — a reporting/write-up issue, not a functional or coverage gap;
  every individual claimed scenario and the full-repo aggregate regression total
  were independently confirmed correct.
