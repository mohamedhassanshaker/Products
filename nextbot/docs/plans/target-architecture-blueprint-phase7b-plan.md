# Phase 7b — Knowledge ingestion pipeline (sub-plan)

**Status: IMPLEMENTED 2026-08-29, ready for standard batched QA — NOT yet
QA-approved.** All slices below (0-3) are complete. See
`docs/plans/target-architecture-blueprint-plan.md`'s Phase 7 "7b implementation
summary" subsection and `docs/NEXUS_STATE.md`'s 2026-08-29 dev decision-log entry
(Phase 7b) for the full implementation report and verification results.

Parent: `docs/plans/target-architecture-blueprint-plan.md` Phase 7. This sub-plan tracks
7b's internal slices only; 7a (graph-store tenant-isolation primitive) is QA-approved
and out of scope here except for the two disclosed fast-follow fixes below, which QA's
7a pass explicitly asked to land before/alongside 7b.

Source of truth: `docs/architecture/LLD.md` §14.4 (schema, pipeline, port), HLD §15.8,
ADR-0018, `docs/PRODUCT_SPECIFICATION.md` FR-KB-01–09 (FR-KB-09 explicitly deferred),
`docs/BACKLOG.md` BL-38.

## Slice 0 — Fast-follow fixes to Phase 7a's `packages/graph-store`

**Goal**: the two non-blocking gaps QA's 7a pass found are closed, since 7b's own
reconciliation-job design depends on both.

1. `ensureIndexesAndConstraints()`'s `CREATE CONSTRAINT/INDEX ... IF NOT EXISTS` race
   produces `Neo.ClientError.Schema.EquivalentSchemaRuleAlreadyExists`, which
   `ALREADY_SATISFIED_CODES` doesn't tolerate. Investigated per the dispatch brief:
   this is genuinely the same benign "someone else already created it" class already
   tolerated for `CREATE DATABASE`/`ROLE`/`USER` (verified against real Neo4j 5
   Enterprise: the constraint/index really is created correctly by the winning
   racer), not a symptom of a deeper correctness problem — so the fix is adding the
   code (and its constraint-specific sibling) to the tolerance set, not adding
   locking. Locking would also work but is strictly more machinery for a race this
   codebase already has an established, tested tolerance idiom for.
2. New reconciliation job (`packages/modules/tenancy` + `apps/worker`) repairing any
   `tenant_graph_database_route` row left at `provisionedAt IS NULL`, following the
   existing cross-tenant sweep idiom (`reconcileDueServersAcrossAllTenants`).

**Scope**: `packages/graph-store/src/provisioning/tenant-database-provisioner.ts` (one
tolerance-set line + a doc-comment correction), its unit + int test files;
`packages/modules/tenancy/src/application/reconcile-graph-provisioning.ts` (new);
`apps/worker/src/tenancy-graph-provisioning-reconcile.ts` (new) + `index.ts`
registration.

**Exit gate**: a real 5-concurrent-call repro of QA's exact scenario now succeeds
cleanly; a real int test simulates a stranded `provisionedAt IS NULL` row and confirms
the job repairs it.

**Flag to orchestrator**: these two fixes touch the security-critical graph-store
primitive from 7a (an already QA-approved isolation boundary). Recommend a quick,
targeted look at just this diff (not a full immediate-QA pass — the change is a
one-line tolerance-set addition plus a new, additive, non-invasive reconciliation job
that only ever calls the already-audited `ensureTenantGraphDatabase`) rather than
folding it silently into 7b's batched gate, given this project's own precedent of
extra scrutiny on anything touching a tenant-isolation boundary. The rest of 7b is
ordinary batched-gate work.

## Slice 1 — Schema + migrations

`packages/db/src/schema/knowledge.ts`: all LLD §14.4.2 tables except `retrieval_event`
(disclosed narrowing — nothing in 7b's own scope reads/writes it; it belongs to the
retrieval executor, Phase 9/10, which doesn't exist yet, so shipping an unused table
now would only be schema for schema's sake). Everything else per LLD verbatim:
`knowledge_collection`, `knowledge_source`, `knowledge_index_generation`,
`knowledge_document`, `knowledge_chunk`, the 5 `knowledge_embedding_d*` tables (Drizzle
factory), `graph_entity`, `graph_edge`, `graph_community`,
`graph_entity_merge_candidate`, `knowledge_ingestion_job`.

Migrations `0065` (schema) + `0066` (RLS) — the established split. Every new
tenant-scoped table added to `TENANT_SCOPED_TABLES` in the same change (skills' own
migration missed this; not repeating it) and to `@nextbot/db/testing`'s fixture
tenant-teardown list.

RBAC: two new `RbacModule` literals per the dispatch's explicit instruction (this
content lives in `docs/blueprint/NextBot-Target-Architecture-Blueprint.md` §5.2, which
predates/supersedes the current `PRODUCT_SPECIFICATION.md`'s pre-blueprint FR-ADM-02
module list — confirmed no `§5.2` module table exists in the product spec itself;
following the blueprint doc and the dispatch's explicit instruction rather than the
stale FR-ADM-02 prose, matching this project's established precedent of new blueprint
modules sometimes reusing/extending the existing RBAC surface, this time by explicit
instruction adding two real new ones): `"knowledge"` (collections/sources CRUD,
ingestion status, generations) and `"knowledge_config"` (embedding/rerank model
choice, chunking/extraction policy — the fields whose change can trigger a re-embed).
Added to `packages/contracts/src/iam.ts`, `system-roles.ts`, `rbac-module-labels.ts`,
`AdminShell.tsx` nav.

## Slice 2 — Model Gateway plumbing this phase needs and adds

`@nextbot/model-gateway` gets two additions (both additive, no existing signature
changed): `callModelGatewayEmbedding` (wraps `@nextbot/ai-registry`'s `embed()` with
route resolution/usage-logging — did not exist at any layer above `ai-registry`
before this phase) and pinned-version call variants (`resolveModelChainForRouteVersion`,
`callModelGatewayStructuredPinned`, `callModelGatewayEmbeddingPinned`) so ingestion
calls the *exact* `model_route_version` a collection/generation pinned, not whatever
is currently Published under that route name — the by-name resolution path every
existing caller uses is correct for chat but wrong for this phase's immutable-pin
requirement. `model_usage_event.knowledge_generation_id` (a column Phase 2 already
added but never wired to any insert path) is now populated for every ingestion model
call. `eslint.config.mjs`'s `MODULE_ALLOW_LIST` gains `knowledge: ["tenancy",
"model-gateway"]`.

## Slice 3 — `packages/modules/knowledge` pipeline

Domain/application/infrastructure/http per the established module shape (copied from
`packages/modules/skills`). Nine stages implemented as real, working async pipeline
functions dispatched by a Postgres-work-table pump (`knowledge_ingestion_job`,
`FOR UPDATE SKIP LOCKED`), following LLD §14.4.3's stage table exactly. Disclosed,
bounded simplifications (each documented in code, not silently narrowed):

- **Deployable**: LLD §15.3.2 names a new `apps/ingest` deployable. This dispatch
  ships the pipeline's logic and scheduled jobs inside `apps/worker` instead (the
  fast-follow's own brief pointed at `apps/worker`'s idiom explicitly for the
  reconciliation job, and containerizing a new deployable is `nexus-deploy` scope, not
  `nexus-dev`'s, per this pipeline's own division of labor). The `ScheduledJob`
  contract and the Postgres-work-table design are identical either way; only the
  process boundary differs. Flagged for `nexus-deploy` to split out if/when
  `apps/worker`'s short reconciliation sweeps and this pipeline's longer CPU-bound
  jobs actually contend.
- **Object storage**: no object-store abstraction exists anywhere in this codebase yet.
  A minimal `infrastructure/upload-store.ts` (local-disk-backed, env-configurable root
  dir) is added scoped to this module only, sufficient for a real small-document
  upload/ingest/e2e test; a shared `@nextbot/object-store` package is a reasonable
  future extraction once a second consumer needs one, not manufactured here for a
  single caller.
- **Source kinds**: `Upload` and `Url` get a real, working `Ingest` stage (local-disk
  read; single-page HTTP fetch respecting a `respectRobots` flag check). `McpResource`
  and `Connector` kinds are fully modeled in the schema/locator/ACL-capture path (so
  console source-management and the ACL data model are real for all four kinds, per
  the dispatch's own instruction that retrieval-time filtering is a later phase's job
  and this phase only needs the ACL data model correctly populated) but their actual
  content fetch is stubbed with a clear per-document failure
  (`code: "SOURCE_KIND_NOT_YET_INTEGRATED"`) recorded in `knowledge_source.failures` —
  neither `packages/modules/mcp-registry` nor `packages/modules/connectors` exposes a
  "read a resource"/"invoke and get a result" function yet to integrate against for
  real. This never blocks the collection (per-document failure semantics already
  required by FR-KB-01/02).
- **Chunk token counts**: approximated (`Math.ceil(text.length / 4)`, a standard
  cheap English-text heuristic) rather than a real tokenizer — no tokenizer library
  exists in this codebase yet and adding one is a dependency decision outside this
  phase's bar-check scope; token counts are advisory (chunk sizing/overlap), not a
  billing or context-window-exactness path.
- **Entity resolution**: deterministic normalization (lowercase/trim/alias-set merge)
  plus real embedding-cosine-similarity merge suggestions (via the pinned embedding
  route), auto-merge ≥ `resolveAutoMergeAbove`, review band written to
  `graph_entity_merge_candidate` — exactly as LLD specifies.
- **Community detection**: a real, deterministic label-propagation implementation
  (`domain/community-detect.ts`, pure, unit-tested) run in the worker over
  `GraphStorePort.projectEdges`'s output, per ADR-0018 §2.5 ("not Neo4j GDS"). Ships
  **single-level (level 0) only** this phase — LLD's "hierarchical clustering"
  aspiration (multiple `level`s with parent/child rollup) is a quality refinement, not
  a structural requirement FR-KB-02 mandates for a working pipeline, and building a
  true multi-level Leiden implementation is out of this phase's reasonable bar.
  `graph_community.level` stays valid/queryable at `0` for every community; the
  column and `parent_id` are ready for a later phase to add real levels without a
  schema change.

**Console**: `/knowledge` (list, gated `knowledge:Read`/`Write`), collection detail
(status badge, per-stage progress, sources table, add-source form), all under
`apps/web/app/(admin)/knowledge/**` + `apps/web/app/api/v1/admin/knowledge/**`. Graph
explorer, retrieval playground (Phase 8/9) and merge-candidate decision UI (needed by
Resolve's review queue but its *review* UI is arguably Phase 8/11 territory) are out
of scope; the review queue is populated and queryable via the API even though no
console screen renders it yet this phase (flagged, not silently dropped).

## Exit gate (7b)

Standard batched gate (§4–6 of the dev brief) plus:
- Real end-to-end ingestion: a real small `.txt`/`.md` test document through all 9
  stages, real Postgres rows (chunks/entities/edges/communities/embeddings), real
  Neo4j nodes/edges for a seeded tenant, queryable via `GraphStorePort.neighbourhood`.
- Embedding-pinning immutability test.
- Residency rejection test at collection-configuration time.
- Concurrency-race + reconciliation-job tests (Slice 0).
- No regression to Phases 0–7a.
