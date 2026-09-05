# QA Report - Dev-30 (BL-29: reranking / relevance floor + hybrid search for retrieval)

**Date:** 2026-08-11
**Scope:** Dev-30 only (first pickup of Phase 6/P2). Dev-31+ explicitly out of scope, none exist yet.
**Environment:** Local Docker - examland-mysql (MySQL, root/YourPassword), examland-qdrant (Qdrant),
apps/api run via its own Jest unit/e2e harness (e2e specs boot the Nest app themselves against the
live containers). No production system touched.

## 1. Scope-derivation sanity check

Read spec section 7.3 directly (docs/PRODUCT_SPECIFICATION.md lines 1032-1051). Confirmed the two
bullets nexus-dev's scope write-up in docs/plans/examland-mvp-plan.md ("Dev-30 - BL-29" section)
relies on are genuinely separate and independently listed:

- "Reranking / relevance-score floor and hybrid (keyword + vector) search for RAG retrieval." (BL-29)
- "Cross-encoder reranking of retrieved chunks." (separate bullet, no matching backlog item)

This is a real textual distinction in the spec, not a convenient narrowing invented by nexus-dev.
Cross-referencing docs/BACKLOG.md's BL-29 row confirms the backlog item's own title bundles
"reranking" and "hybrid search" as one item, consistent with treating them as one integrated
fusion/re-sort step rather than adding a second, separate cross-encoder pass. There is no existing
"score this chunk against this query" contract on AiServicePort, so a real cross-encoder pass would
require new AI-engine infrastructure this phase correctly avoided building unprompted.

Verdict: scope-derivation is reasonable and faithful to the spec. Not a work-avoidance narrowing -
it is the literal reading of section 7.3's two separate bullets, and BL-29's own title supports
bundling "reranking" into the fusion step rather than requiring a distinct mechanism.

## 2. Hybrid search recall - independent verification

Read the real e2e proof in apps/api/test/curricula-ingestion.e2e-spec.ts ("Dev-30/BL-29 hybrid
search..." describe block, lines 527-623). It constructs deterministic orthogonal/at-cosine vectors
so a distinctive-keyword chunk sits at cosine exactly 0 to the query while 5 decoys sit at cosine 0.3
with zero keyword overlap. Confirms a pure vectorAdapter.searchChunks call at topK=3 excludes the
keyword chunk, then RetrievalService.retrieve at the identical topK=3 includes it. Real, non-trivial
recall proof, not tautological.

Independently re-ran this exact suite against live Docker MySQL/Qdrant (DB_USER=root
DB_PASSWORD=YourPassword npx jest --config test/jest-e2e.json curricula-ingestion) - PASS, 16/16,
including this recall test. I judged re-running this deterministic live-Qdrant proof to be equivalent
evidentiary weight to constructing a parallel independent fixture, since it is already a genuine
live-Qdrant proof (not a mocked unit test) using exact orthogonal-vector construction rather than
anything tuned to pass. Also independently read and confirmed the equivalent unit-level exit gate in
retrieval.service.spec.ts ("HYBRID-SEARCH RECALL EXIT GATE") - logic matches the live proof.

Verdict: PASS. Hybrid search genuinely improves recall over dense-only retrieval, proven live
against real Qdrant, not just mocked.

## 3. Relevance floor - independent verification

Read hybrid-rerank.ts's rerankFuseAndFilter: filters with result.fusedScore > options.relevanceFloor
(strict greater-than, so a score exactly at the floor is excluded) before sorting/slicing to topK -
below-floor candidates are dropped entirely, not merely ranked low. Confirmed via the unit test
"RELEVANCE FLOOR EXIT GATE" in retrieval.service.spec.ts (a genuinely below-floor candidate is
excluded from the result array entirely, length asserted). Re-ran this unit suite myself - pass.

Verdict: PASS. Floor is exclusion, not down-ranking, and applied to the fused score (not raw
dense-only score) per the documented design decision.

## 4. Zero VectorStorePort change / zero caller signature change - code-level verification

- Read apps/api/src/vector/domain/vector-store.port.ts: searchChunks/scrollChunks signatures are
  unchanged from their pre-Dev-30 shape (both already existed; scrollChunks with withVector was
  already a documented Dev-13/VEC-BOOT primitive, confirmed by reading the Qdrant adapter).
- Read apps/api/src/infrastructure/vector/qdrant.adapter.ts: scrollChunks's tenant scoping is
  identical to searchChunks's - both go through the same buildFilter (always includes a mandatory
  tenantId match clause) and the same assertNoLeak defense-in-depth post-filter. Dev-30 did not
  touch this file at all - the chokepoint Dev-13 built is untouched.
- Grepped for all callers of RetrievalService.retrieve: prompt-practice.service.ts,
  lesson-practice.service.ts, full-bank-assessment.service.ts, exam-extraction.service.ts,
  lesson-generation.service.ts - exactly 5, matching the claim, all calling the same
  retrieve(scope, text, topK) shape with no changes needed.

Verdict: PASS. Genuinely zero interface/caller-signature change; Dev-13's tenant-isolation
chokepoint (buildFilter/assertNoLeak) is completely untouched by this phase.

## 5. Tenant isolation regression - independent re-run

Re-ran test/vector-tenant-isolation.e2e-spec.ts against live Qdrant myself (not reusing any
nexus-dev-authored run) - PASS, all cases green (ran together with curricula-ingestion, 26/26
combined). The scrollChunks call RetrievalService.retrieve now issues goes through the exact same
tenant-scoped buildFilter/assertNoLeak path as every other chunk read in the codebase (verified in
section 4) - the broader candidate pool this phase introduces does not bypass tenant scoping; it is
simply a larger limit argument to an already-tenant-scoped method.

Verdict: PASS. No cross-tenant leak introduced.

## 6. Fusion scoring - independent verification

Read fuseScore: (1 - lexicalWeight) * denseScore + lexicalWeight * lexicalScoreValue - a genuine
weighted blend of both signals (default lexicalWeight 0.35, dense majority weight 0.65), not one
channel dominating/ignored. Confirmed via:
- "RERANKING EXIT GATE" unit test (lexical weight 0.6 override) - a lexically-strong/dense-weak
  candidate genuinely outranks a dense-strong/lexically-empty one, proving lexical is not ignored.
- "keeps Qdrant's own reported dense score" unit test (lexicalWeight 0) - proving dense is not
  silently overridden when lexical weight is zero.
- The live e2e recall test's own commented arithmetic (dense 0 weighted 0.65 plus lexical ~0.9
  weighted 0.35 approx 0.315 for the keyword chunk vs. dense 0.3 weighted 0.65 approx 0.195 for
  decoys) - hand-checked, arithmetic is correct.

Verdict: PASS. Fusion genuinely blends both signals per the documented weight; neither channel
silently dominates or is ignored at the default configuration.

## 7. CurriculaService.search exclusion - confirmed genuinely out of scope, not accidentally broken

Grepped curricula.service.ts: its search method calls this.vectorStore.searchChunks(...) directly
(line ~329), never touching RetrievalService at all. This confirms FR-CUR-3's endpoint is completely
unaffected by Dev-30's changes - it retains its pre-existing "ranked, highest similarity first"
dense-only behavior exactly as before, not silently degraded or broken. The plan's own documented
flag (item 5 in the scope-decision writeup) accurately describes this as a candidate follow-up, not
a silent inconsistency.

Verdict: PASS. Genuinely out of scope, correctly untouched, not a regression.

## 8. Full unit suite + e2e re-runs - independently reproduced

- npm run test -w apps/api (full unit suite, no filters): 177 suites / 1531 tests, all green - exact
  match to nexus-dev's self-reported numbers.
- npm run lint (workspace-wide): clean, zero warnings/errors.
- e2e (against live MySQL/Qdrant, DB_USER=root DB_PASSWORD=YourPassword, --runInBand):
  - curricula-ingestion.e2e-spec.ts + vector-tenant-isolation.e2e-spec.ts: 26/26 green (includes the
    new Dev-30 recall proof).
  - pdf-processing.e2e-spec.ts + prompt-practice.e2e-spec.ts + lesson-generation-restart.e2e-spec.ts +
    full-bank-assessment-restart.e2e-spec.ts: 21/21 green.

Verdict: PASS. No regressions found in any re-run suite.

## Traceability matrix

| Item | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| Scope faithfulness to spec 7.3 | Read spec 7.3 + BACKLOG.md BL-29 directly, compared to plan's scope writeup | PASS | spec lines 1032-1051; plan "Dev-30 - BL-29" section |
| Hybrid search recall (headline exit gate) | Live-Qdrant deterministic orthogonal-vector recall proof, re-run independently | PASS | curricula-ingestion.e2e-spec.ts 16/16 (this session's own run) |
| Relevance floor (exclusion, not down-rank) | Code read (strict greater-than filter before slice) + unit exit-gate test | PASS | hybrid-rerank.ts:149; retrieval.service.spec.ts "RELEVANCE FLOOR EXIT GATE" |
| Zero VectorStorePort/caller signature change | Code read of port interface, adapter, and all 5 call sites | PASS | vector-store.port.ts, qdrant.adapter.ts, 5 caller files |
| Tenant isolation regression | Live re-run of vector-tenant-isolation.e2e-spec.ts | PASS | 26/26 (this session's own run) |
| Fusion scoring (genuine blend) | Code read of fuseScore + 2 unit exit-gate tests + hand-checked e2e arithmetic | PASS | hybrid-rerank.ts:118-120; retrieval.service.spec.ts |
| CurriculaService.search exclusion | Grep confirms direct VectorStorePort call, no RetrievalService dependency | PASS | curricula.service.ts:329 |
| Full unit suite regression | Independent re-run | PASS | 177 suites / 1531 tests |
| Lint | Independent re-run | PASS | 0 warnings/errors |
| e2e regression (5 existing grounded-generation call sites) | Independent re-run of all 5 named e2e suites | PASS | 21/21 plus 26/26 |

## Defects

None found. No blocking or non-blocking defects in Dev-30's own implementation.

Non-blocking, pre-existing observations (not Dev-30 defects, noted for completeness):
- Docker MySQL/Qdrant have a long-standing accumulation of leftover per-run schemas/collections from
  many prior phases' e2e runs (e.g. t_catalog_e2e_* / examland_e2e_aicost_*); this predates Dev-30 and
  is a general test-hygiene item for the project, not something this phase introduced or worsened. My
  own re-runs used the suites' own randomized-suffix/self-cleanup convention identically to every
  prior QA pass.

## Overall verdict

PASS - Dev-30 is QA-green, no blocking defects. The self-derived Phase-6 scope is reasonable and
faithful to spec section 7.3's actual wording (the reranking/hybrid-search-as-one-bullet vs.
cross-encoder-as-a-separate-bullet distinction is real, not a convenient narrowing). All claimed
implementation details, test counts, and e2e suite results were independently reproduced against a
live environment, not merely trusted.
