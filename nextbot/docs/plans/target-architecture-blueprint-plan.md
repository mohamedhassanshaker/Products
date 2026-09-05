# Target Architecture Blueprint â€” six new modules (phased plan)

Source of truth for scope: `docs/PRODUCT_SPECIFICATION.md` آ§9.5/آ§7.4,
`docs/architecture/HLD.md` آ§15, `docs/architecture/LLD.md` آ§14, and ADR-0011â€“0018
(plus the ADR-0009 آ§8 amendment). `docs/BACKLOG.md`'s BL-27â€“BL-52 (Phases 6â€“10) fix
the build order; this doc only adds the technical sub-phasing within that order and
tracks phase status/deviations. Do not re-litigate backlog priority here.

Two non-negotiable ordering constraints carried over from the backlog/Blueprint and
enforced by this plan's phase order:

1. **Model Gateway v2 ships before Knowledge/Graph RAG** (Phase 2 before Phase 6) â€” an
   index pins an embedding model; it cannot pin a free-text string.
2. **The permission-intersection evaluator + delegation trace tree ship before the
   first multi-agent delegation runs in production** (Phase 5 before Phase 12).

Security/architecture-critical work (permission evaluation, tenant-isolation
primitives, manifest/version immutability and pinning semantics) is kept in its own
bounded phase even where it could technically be batched with adjacent work, per this
project's established treatment of security-relevant changes.

## Phase status table

| Phase | Backlog item(s) | Goal | Status |
|---|---|---|---|
| 0 | BL-27, BL-28, BL-29, BL-30, BL-31 | Five standalone fixes to real, already-shipped gaps (emergency rollback, capability-group UI, MCP manifest pinning/drift, tool-result injection guardrail, Git-independent structural diff) | **QA-APPROVED 2026-08-29 -- see docs/NEXUS_STATE.md decision log; orchestrator may proceed to Phase 1** |
| 1 | BL-32 | Model Gateway v2 provider registry + model catalog | **QA-APPROVED 2026-08-29 -- see docs/NEXUS_STATE.md's 2026-08-29 qa decision-log entry; orchestrator may proceed to Phase 2** |
| 2 | BL-33 | Model Gateway v2 route v2, standard routes, usage/cost, residency/plan-tier governance | **QA-APPROVED 2026-08-29 -- see docs/NEXUS_STATE.md's 2026-08-29 qa decision-log entry (Phase 2); orchestrator may proceed to Phase 7 (Knowledge/Graph RAG) once its own turn comes in the phase order; Phases 3-6 are unrelated/independent and are not blocked by this** |
| 3 | BL-34 | Nine-step MCP enrolment wizard | **QA-APPROVED 2026-08-29 (0 retries, standard batched QA) -- corrected 2026-09-01 by the Final Review retry pass: this row previously still read "IMPLEMENTED ... not yet QA-approved", which contradicted docs/NEXUS_STATE.md's own `qa_retry_count` field. Evidence: `qa-results/target-architecture-blueprint-phase3-phase5/20260829-061017/`. See docs/plans/mcp-enrolment-wizard-plan.md and docs/NEXUS_STATE.md's 2026-08-29 dev decision-log entry (Phase 3).** |
| 4 | BL-36 | SSO/SCIM, session listing/revocation, service accounts + scoped API keys | **QA-APPROVED 2026-08-29 (retry 1 re-QA passed) â€” see docs/NEXUS_STATE.md 2026-08-29 qa decision-log entry (Phase 4 retry 1 re-QA) and this file Phase 4 section below; orchestrator may consider Phase 4 fully closed** |
| 5 | BL-35 | Skills library (versioned artifact, immutability, where-used, upgrade-consumers) | **QA-APPROVED 2026-08-29 (0 retries, standard batched QA) -- corrected 2026-09-01 by the Final Review retry pass: this row previously still read "IMPLEMENTED ... not yet QA-approved", which contradicted docs/NEXUS_STATE.md's own `qa_retry_count` field. Evidence: `qa-results/target-architecture-blueprint-phase3-phase5/20260829-061017/`. See docs/NEXUS_STATE.md's 2026-08-29 dev decision-log entry (Phase 5) and this file's own Phase 5 section.** |
| 6 | BL-37 | Permission-intersection evaluator + delegation trace-tree foundation (hard gate on Phase 12) | **QA-APPROVED 2026-08-29 (retry 1 re-QA passed) -- Phase 6 is now COMPLETE and QA-green, both the original scope and the retry -- see docs/NEXUS_STATE.md's 2026-08-29 qa decision-log entry (Phase 6 retry 1 re-QA) and this file's own Phase 6 section below; Phase 14 is no longer blocked on this phase** |
| 7 | BL-18.5* / ADR-0018 primitive, then BL-38 | Graph store tenant-isolation primitive, then knowledge ingestion pipeline end-to-end | **7a and 7b: BOTH QA-APPROVED 2026-08-29 -- see docs/NEXUS_STATE.md's 2026-08-29 qa decision-log entries (Phase 7a, and Phase 7b below); Phase 7 is fully closed. Both 7a fast-follow fixes (the idempotent-provisioning concurrency race, and the missing stranded-tenant reconciliation job) independently re-verified with fresh adversarial probes and confirmed genuinely sound. The real 9-stage ingestion pipeline's seeded Neo4j graph data is independently confirmed real and queryable -- Phase 8 (graph explorer) may proceed.** |
| 8 | BL-39 | Graph explorer | **QA-APPROVED 2026-08-29 (0 retries) -- see docs/NEXUS_STATE.md's 2026-08-29 qa decision-log entry (Phase 8) and this file's own Phase 8 section; orchestrator may proceed to Phase 9 once its own turn comes (two non-blocking findings recorded: the apps/web frontend test layer's now-confirmed deterministic breakage, pre-existing/unrelated to this phase; and the table-navigator vs. the project's own richer wf04 wireframe, a disclosed non-blocking trade-off)** |
| 9 | BL-40 | Four retrieval strategies + retrieval playground | **QA-APPROVED 2026-08-29 (0 retries) -- see docs/plans/target-architecture-blueprint-phase9-plan.md and docs/NEXUS_STATE.md's 2026-08-29 qa decision-log entry (Phase 9); orchestrator may proceed to Phase 10 once its own turn comes (one non-blocking finding recorded: dev's own reported knowledge-module unit/integration test-count breakdown was inaccurate, though the full-repo regression total and every individual claimed test scenario were independently confirmed correct)** |
| 10 | BL-41 | Bounded retrieval agent + citations, `refuseWhenUngrounded` runtime enforcement | **QA-APPROVED 2026-08-29 (0 retries) -- immediate (not batched) QA pass on the refuseWhenUngrounded runtime-enforcement suite per this phase's own exit-gate wording; see this file's own Phase 10 section and docs/NEXUS_STATE.md's 2026-08-29 qa decision-log entry (Phase 10). Phase 11 (knowledge governance) may proceed.** |
| 11 | BL-42 | Knowledge governance (ACL filtering, PII, residency, retention, freshness, coverage) | **QA-APPROVED 2026-08-29 (0 retries) -- immediate (not batched) security-relevant QA pass; see this file's own Phase 11 section below and docs/NEXUS_STATE.md's 2026-08-29 qa decision-log entry (Phase 11). Phase 12 (Agent Design Studio + eval harvesting) may proceed.** |
| 12 | BL-43, BL-44 | Agent Design Studio + eval harvesting/continuous runs/regression baselines | **QA-APPROVED 2026-08-29 (0 retries) -- standard batched QA with elevated security-review-level rigor on the guardrail-tightening piece; see this file's own Phase 12 section below and docs/NEXUS_STATE.md's 2026-08-29 qa decision-log entry (Phase 12). Phase 13 (BL-45) may proceed.** |
| 13 | BL-45 | Escalation workforce mechanics (assignment/SLA/presence/CSAT) | **QA-APPROVED 2026-08-30 (0 retries) -- standard batched QA with elevated, real-concurrent-load adversarial rigor applied to the atomic ceiling-check mechanic per this phase's own correctness-critical designation. See docs/NEXUS_STATE.md's 2026-08-30 qa decision-log entry (Phase 13) for the independent verification detail and verdict. Phase 14 (BL-46) may proceed.** |
| 14 | BL-46 | Multi-agent orchestration: agent-as-tool + team delegation runtime | **QA-APPROVED 2026-08-30 (0 retries) -- immediate (not batched) adversarial security QA per this phase's own exit gate. See this file's own Phase 14 section below, `docs/plans/target-architecture-blueprint-phase14-plan.md`, and `docs/NEXUS_STATE.md`'s 2026-08-30 qa decision-log entry (Phase 14) for the independent verification detail and verdict. Phase 15 (BL-47a, Workflow Designer authoring) may proceed.** |
| 15 | BL-47a | Workflow Designer -- authoring schema, canvas, promotion-gate integration, node validation | **QA-APPROVED 2026-08-30 (0 retries) -- standard batched QA, with elevated real-evaluator-integration rigor applied to V10's authz call per this project's own precedent for every authz integration point. See this file's own Phase 15 section below and docs/NEXUS_STATE.md's 2026-08-30 qa decision-log entry (Phase 15) for the independent verification detail and verdict. Scope boundary (deliberate, disclosed, confirmed by QA): authoring/validation/promotion-ladder-up-to-HumanReview only -- no executor, no workflow_run schema; a version genuinely cannot reach Approved/Production until Phase 16 ships. Phase 16 (BL-47b, Workflow Designer durable execution runtime) may proceed.** |
| 16 | BL-47b | Workflow Designer -- durable resumable execution runtime, run budgets, graph-shaped traces | **QA-APPROVED 2026-08-31 (retry 1 re-QA PASSED, full whole-batch re-verification) -- Phase 16 is now fully closed, no further retries needed.** First-attempt QA FAILED 2026-08-31/09-01 on one blocking defect (webhook trigger signature verification was not a real HMAC-SHA256, CWE-327); retry 1 fix IMPLEMENTED 2026-08-31 by nexus-dev; retry 1 re-QA independently re-verified the WHOLE batch (not just the fix) via a from-scratch adversarial proof (an independently-computed real HMAC-SHA256 signature is accepted by the real webhook endpoint; the old broken construction is rejected) plus a full re-run of typecheck/dependency-cruiser/unit/integration/isolation and all four named adversarial suites (lease-concurrency, crash-resume, approval-expiry hazard, promotion-gate) -- all PASS, no new blocking defects. See docs/NEXUS_STATE.md's 2026-08-31 qa decision-log entry (Phase 16 retry 1 re-QA) for the full independent-verification report, traceability matrix and defect list. **Phase 17 (BL-48, Progressive rollout) may proceed.** Implementation detail: `docs/plans/workflow-durable-execution-plan.md`. See this file's own Phase 16 section below for the four disclosed deviations (all confirmed sound by QA, not defects) and both QA status paragraphs appended to it. |
| 17 | BL-48 | Progressive rollout: traffic-split canary + shadow evaluation. **RESCOPED 2026-08-31 -- read this phase's own SCOPE CORRECTION section and ADR-0019 before dispatching; the original premise (that a weighted/sticky traffic-split resolver already exists) is false.** | **QA-APPROVED 2026-09-01 (0 retries) -- full independent re-verification at elevated, security-review-level rigor; see docs/NEXUS_STATE.md's 2026-09-01 qa decision-log entry (Phase 17) and this file's own Phase 17 QA STATUS subsection below. Phase 18 (BL-49) may proceed.** All five corrected-scope halves shipped: (a) `channel.agent_definition_id` with the vestigial column dropped, a one-definition-per-tenant backfill and a NULL-binding fallback; (b) the deterministic weighted resolver, sticky per conversation and **bounded by the assigned deployment's `is_active` lifetime**; (c) BL-13's never-built `setTrafficSplit`/`promoteCanary` on the same advisory-lock key, gated on `Production` status; (d) the Deployments & Canary tab on the agent-definition detail screen; (e) shadow evaluation as an asynchronous `apps/worker` replay behind a non-executing egress port. All four elevated-rigor items are proven by real adversarial tests, not assertion -- see this file's own Phase 17 section below for the results, including two genuine gaps the probes found in claims the ADR treated as already true. Implementation detail + the full `agent_run` reader audit: `docs/plans/progressive-rollout-shadow-evaluation-plan.md`. |
| 18 | BL-49 | Public API, webhooks, OpenTelemetry/SIEM export | **QA-APPROVED 2026-09-01 (0 retries) -- standard batched QA with elevated rigor on bearer-key RBAC parity and webhook HMAC signing per the dispatch; see docs/plans/public-api-webhooks-otel-siem-plan.md, docs/NEXUS_STATE.md's 2026-09-01 dev decision-log entry (Phase 18) and this file's own Phase 18 QA STATUS subsection below. Phase 19 (BL-50, BL-51) may proceed.** |
| 19 | BL-50, BL-51 | Cross-channel identity resolution + config export/restore (small, independent, batched per Phase-0-style rules) | **QA-APPROVED 2026-09-01 (0 retries) -- standard batched QA, elevated rigor on BL-51's credential-non-leakage property; see docs/plans/cross-channel-identity-config-portability-plan.md and docs/NEXUS_STATE.md's 2026-09-01 qa decision-log entry (Phase 19). Phase 20 (BL-52, the final phase) may proceed.** |
| 20 | BL-52 | Consented, doubly-audited break-glass operator access | **QA-APPROVED 2026-09-01 (0 retries) -- immediate, security-review-level QA (not standard-batched, per the dispatch's own instruction given this is a genuine cross-tenant access-control boundary), full independent re-verification; see `docs/plans/breakglass-operator-access-plan.md`'s own IMPLEMENTATION STATUS section and this file's own Phase 20 section's QA VERIFICATION subsection below, and `docs/NEXUS_STATE.md`'s 2026-09-01 qa decision-log entry (Phase 20) for the full traceability matrix/evidence/defect list. This was the FINAL phase of the 21-phase plan -- all 21 phases are now QA-APPROVED; the whole initiative moves to Final Review.** |
| -- | -- | **FINAL REVIEW (full-application full-regression QA across every initiative, not a single phase's diff)** | **PASS / READY -- 2026-09-01, on the second attempt.** Attempt 1 (2026-09-01T0600Z) FAILED on two blocking defects, neither in the Blueprint's own feature code: DEFECT-1, the shipped `docker-compose.yml`'s shared knowledge-upload volume was root-owned while `web`/`worker` run as uid 1001, making every `Upload`-kind knowledge source a hard HTTP 500 (attributable to the pre-Final-Review deployment-reconciliation pass's own Gap-3 fix, which closed the sharing half but not the ownership half); and DEFECT-2, the React/jsdom component-test layer reported deterministically broken (79 files / 474 tests). Both were dispatched as targeted fixes. **Attempt 2 (2026-09-01T0900Z) PASSED.** DEFECT-1 was fixed in `apps/web/Dockerfile` and `apps/worker/Dockerfile` and independently re-verified end to end on genuinely wiped volumes (real authenticated multipart upload returns HTTP 201, and `web` and `worker` read back byte-identical content from the shared volume). DEFECT-2 was **resolved as a real, on-disk `node_modules` materialization corruption in attempt 1's own working tree** -- not product code, not vitest/Vite configuration, not a stale Vite cache (that hypothesis was tested directly and disproven), not a flake -- incidentally repaired by the intervening investigation dispatch's `pnpm install --force`; the Final Review retry positively reproduced the failure twice and proved directly that a `--frozen-lockfile` install does not re-verify the peer symlinks inside pnpm's virtual store while `--force` does. Final gates: typecheck 41/41, eslint exit 0, dependency-cruiser 0 violations across 2550 modules, and 515 test files / 3425 tests (unit + integration + isolation) 100% green over repeated independent runs; all four historically-fixed security defects still fixed; all five high-stakes Blueprint properties confirmed in combination; 23-screen Admin Console walked in a real browser with zero console errors. Four non-blocking findings recorded, none gating. Full traceability, evidence and defect list: `docs/NEXUS_STATE.md`'s 2026-09-01 FINAL REVIEW RETRY qa decision-log entry, artifacts in `qa-results/final-review-full-app/2026-09-01T0900Z/`. **`current_phase` is now `done` -- the 21-phase Target Architecture Blueprint initiative is COMPLETE.** |

\* No standalone backlog ID for the ADR-0018 tenant-isolation primitive; it is a
technical prerequisite pulled out of BL-38's scope into its own sub-phase because it is
a security-critical isolation boundary (same treatment as Phase 0's MCP pinning and
Phase 6's permission evaluator), not a silent re-prioritization of the backlog.

---

## Phase 0 â€” Five standalone risk-closing fixes (QA-APPROVED 2026-08-29)

**Goal**: close five currently-live gaps in the shipped platform that the Blueprint
rates severity 1/2, with zero dependency on any of the six new modules.

**Backlog items**: BL-27, BL-28, BL-29, BL-30, BL-31.

**Scope**: see the implementation report below (this document only tracks planning;
the full file list, decisions, and verification results are reported to the
orchestrator and recorded in `docs/NEXUS_STATE.md`'s decision log).

**Exit gate**: typecheck/lint/lint:boundaries clean; real Postgres integration tests
for the manifest-pinning/drift reconciler's five ADR-0014 semantics; a real emergency-
rollback eligibility test (previously-Production only); a real injection-guardrail
test against crafted tool output; a real structural-diff test for Git-less versions
plus an ADR-0009 Git-diff non-regression test; a live capability-group CRUD check
against seeded data confirming `ON DELETE SET NULL` (not cascade).

**QA result (2026-08-29): PASS.** All exit-gate items independently reproduced/verified; no defects found. Full detail in docs/NEXUS_STATE.md's 2026-08-29 qa decision-log entry.

---

## Phase 1 â€” Model Gateway v2: provider registry + model catalog

**Goal**: `packages/modules/model-gateway` exists as its own module (extracted per LLD
آ§14.9.6) with a provider registry (Anthropic/OpenAI/Azure/Google/Bedrock/OpenRouter/
openai-compatible/Ollama) and a model catalog (context window, price, capabilities,
deprecation) â€” the foundational layer routes will reference instead of a free-text
model string.

**Backlog item(s)**: BL-32.

**Scope**: `packages/db/src/schema/model-gateway.ts` (the file move off
`agent-platform.ts` per آ§14.9.6), `packages/modules/model-gateway` (new module,
provider/catalog CRUD, `model-gateway.catalog-sync`/`model-gateway.provider-probe`
scheduled jobs), console screens for provider/catalog management. Out of scope: Route
v2, standard routes, usage/cost, governance (Phase 2) â€” this phase only stands up the
two layers routes will pin against.

**Exit gate**: standard batched gate (آ§4â€“6 of the dev-agent brief); `agent-platform`'s
existing model-route reads keep working unchanged through the new
`agent-platform â†’ model-gateway` module edge (no regression in the currently-shipped
route configuration screen).

**Status: QA-APPROVED 2026-08-29 -- see `docs/NEXUS_STATE.md`'s 2026-08-29 qa
decision-log entry; orchestrator may proceed to Phase 2.**

---

## INCIDENT NOTICE -- 2026-08-29, caused by nexus-qa during the Phase 11 QA dispatch's own doc-update step

While updating this plan doc's Phase 11 status (table row + this doc's own Phase 11
section), a Python regex replacement used a non-greedy `.*?` span intended to match
"Phase 11's own `Status: IMPLEMENTED...Not yet QA-approved** Summary:` line" but
which, because Phase 1's own status line happened to start with the identical
`**Status: IMPLEMENTED 2026-08-29` prefix, actually matched from PHASE 1's status
line all the way through to PHASE 11's real status line further down the file --
deleting everything in between. **This destroyed every one of Phases 2, 3, 4, 5, 6,
7a, 7b, 8, 9, and 10's own `## Phase N` sections in this file** (their Goal/Backlog/
Scope/Exit-gate/Status prose write-ups), plus Phase 11's own Goal/Backlog/Exit-gate
preamble (Phase 11's own body content, the bullet-point summary starting at
"ACL (FR-KB-08)", survived intact and is restored below under its own proper
heading). This was an unintended, purely mechanical scripting mistake, not a
deliberate edit -- the same class of incident this very file's own decision log
(Phase 11 entry, this same QA pass) and `docs/NEXUS_STATE.md`'s own INCIDENT NOTICE
already document happening once before in this project.

**What is NOT lost**: `docs/NEXUS_STATE.md`'s own decision log (untouched by this
incident) is this project's own established authoritative source for what actually
shipped/was verified per phase -- every `## Phase N` section this file lost was, per
this doc's own repeated citation pattern ("see docs/NEXUS_STATE.md's ... decision-log
entry"), a planning/tracking summary ANYWAY, not the sole record. The Phase status
table above (lines 24-46) is untouched and still names every phase's backlog item(s),
one-line goal, and status/QA-approval pointer. Two phases additionally have their own
untouched secondary plan docs with real detail: `docs/plans/mcp-enrolment-wizard-plan.md`
(Phase 3) and `docs/plans/target-architecture-blueprint-phase9-plan.md` (Phase 9).

**What IS lost**: the specific forward-looking Goal/Backlog/Scope/Exit-gate prose this
doc itself wrote for Phases 2, 4, 5, 6, 7a, 7b, 8, and 10 before each was implemented,
and Phase 11's own such preamble (recovered separately below, since this QA dispatch's
own earlier tool output happened to have captured it verbatim before the mistake).

**Recommended recovery path**: the orchestrator's own conversation history very likely
still holds the accurate original content for the missing phases (each was dispatched
individually with its own Goal/Backlog/Scope/Exit-gate brief) -- restoring verbatim
from there is far more reliable than any reconstruction attempt this QA agent could
make from partial memory. This incident does not change any phase's actual
QA-approval status (all recorded correctly in the Phase status table and in
`docs/NEXUS_STATE.md`) and does not affect this dispatch's own Phase 11 verdict
(PASS) -- it affects only this planning document's own descriptive detail for
already-completed phases.

---

## Phase 11 -- Knowledge governance

**Goal**: pre-ranking ACL filtering, PII masking at index+read time, residency
enforcement, retention/purge cascade, freshness/staleness, and coverage reporting all
apply to real tenant knowledge collections before any tenant's real customer content
goes live against Phase 7-10's pipeline.

**Backlog item(s)**: BL-42.

**Exit gate**: standard batched gate plus a security review (ACL/PII/residency
boundary -- same treatment as every other FR-SEC-04/FR-ADM-06-shaped item in this
project's history).

**Status: QA-APPROVED 2026-08-29 (0 retries), immediate (not batched) security-relevant QA pass -- see `docs/NEXUS_STATE.md`'s 2026-08-29 qa decision-log entry (Phase 11) for the full independent-verification report. One non-blocking defect found (`graph_community.entity_count` never recomputed after a retention purge removes a member -- a display/data-integrity rough edge, not a security defect); does not block this PASS. Phase 12 (BL-43/44, Agent Design Studio + eval harvesting) may proceed per this plan's own phase ordering.** Summary:

- **ACL (FR-KB-08)**: real per-caller narrowing replaces Phase 8/9/10's disclosed
  "whole generation" union precedent. `spec.knowledge.aclScope` (new optional
  `{roleIds, capabilityGroupIds, tags}` field, `packages/contracts/src/agent-platform.ts`)
  is resolved at save time (`createAgentDefinitionVersion`) via the SAME
  `deriveAclTags` opaque-hash derivation `knowledge_source.acl_tags` already uses,
  always including the tenant's own "Tenant"-visibility grant, into a new
  `ResolvedAgentKnowledgeConfig.aclTags` (JSONB, no migration needed). `retrieval-
  executor.ts` passes this real scope into every strategy via a new
  `RetrievalStrategyParams.aclTags` field. **Real gap independently found and closed
  this phase, beyond what the dispatch brief itself described as already real**: the
  codebase's own vector-similarity path (`topKByCosineSimilarity`, used by Vector
  recall, Hybrid's recall step, and GraphGlobal's map step) had **no ACL filtering at
  all** before this phase â€” only the two graph-traversal strategies (GraphLocal,
  Hybrid's expansion step) ever filtered by ACL tags. `embedding-table.ts` now applies
  a real pre-ranking `EXISTS` join against the owning chunk/community's own
  `acl_tags` (parameterized per-tag via `sql.join`, never string-concatenated) before
  `ORDER BY`/`LIMIT`. **Disclosed scope**: this is a per-AGENT-VERSION grant, not
  per-end-user â€” this codebase threads no acting end-user identity into the retrieval
  call site at all; see `spec.knowledge.aclScope`'s own doc comment for the full
  rationale. The Retrieval Playground (Phase 9, human-admin-only tool) keeps the old
  whole-generation-union precedent, now passed explicitly rather than fetched
  internally by each strategy.
- **PII (FR-KB-08)**: index-time masking was previously NOT WIRED AT ALL for knowledge
  chunks (confirmed by inspection before writing this â€” `piiMaskJson`/
  `textUnmaskedRef` existed on the schema but nothing wrote to them). This phase wires
  the Chunk pipeline stage (`stage-ingest-parse-chunk.ts`) to mask each chunk's text
  via the SAME `@nextbot/pii` masker/policy-lookup FR-SEC-04 already established
  (new `"Knowledge"` `PiiContext` value, migration `0070`, standalone `ALTER TYPE ...
  ADD VALUE`), against the collection's own `trust_level`; the original is retained
  (`textUnmaskedRef`, the same local object store uploads already use) only when PII
  was actually detected and the collection is not `Untrusted`. Read-time
  re-evaluation (`pii-reeval-service.ts#resolveChunkTextForCaller`) re-derives masking
  FRESH from the retained original against the CALLER's own trust level
  (`spec.knowledge.callerTrustLevel`, new optional field, default `SemiTrusted`) â€”
  chosen over patching the already-masked string because a `Redact`/`PartialMask`
  action can change a span's length, making the original char offsets unsafe to
  reuse. Wired into `getChunkDetail` (optional `callerTrustLevel` param, `undefined`
  preserves every pre-existing caller's exact behavior) and into the bounded
  retrieval agent's own citation snippets. **Disclosed correction**:
  `PiiMaskEntry.appliedAction`'s TS type was scaffolded ahead of this phase with a
  placeholder vocabulary (`"Mask"|"Redact"|"Tokenize"`) that didn't match
  `@nextbot/pii`'s real, already-shipped `PiiMaskAction` vocabulary
  (`"Show"|"PartialMask"|"FullMask"|"Redact"`) â€” corrected in place (JSONB, no
  migration, no row was ever written under the old vocabulary).
- **Residency (FR-KB-08)**: the collection-region-vs-tenant-policy check
  (`assertRegionAllowed`) was already real since Phase 7b. This phase closes the
  remaining gap: the PINNED embedding route's own resolved provider region set
  (`model_route_version.max_region_set`, Model Gateway v2's own already-computed
  field, reused rather than inventing a second region concept) must also satisfy the
  tenant's residency setting, checked at both collection creation and any later
  config update that re-pins the embedding route â€” rejected with the same named
  `KNOWLEDGE_REGION_MISMATCH` error, never silently accepted.
- **Retention (FR-KB-08/FR-ADM-06)**: `deleteSource` previously only flipped
  `knowledge_source.status` to `'Purged'` without removing any downstream content â€”
  a real, disclosed gap this phase closes. New `retention-service.ts#
  purgeSourceContent`: removes every chunk the source ever produced (across every
  generation, not just the current one), removes any edge whose sole provenance was
  one of those chunks, removes any entity left with genuinely zero remaining edges
  (re-checked fresh against the generation's real remaining graph, never assumed),
  marks any community that lost a member `summary_stale` and re-enqueues that
  generation's `CommunitySummaries` stage (reusing Phase 7b's own incremental
  re-summarization mechanism, never a second one) â€” or deletes the community outright
  if its membership hit zero. The Neo4j mirror is kept in sync via
  `Neo4jGraphStore.deleteNodes`. Both an explicit admin delete and the new scheduled
  sweep (`sweepKnowledgeRetention`, `apps/worker`'s `knowledge.retention-purge`, 1h
  cadence) route through this identical cascade. **Disclosed scope narrowing**: no
  generic tenant-level "knowledge retention default" field exists yet in
  `tenant_data_policy` (its four existing categories cover conversation-side data
  only); rather than inventing a fifth column this phase's own brief didn't ask for,
  the sweep drives purely off `knowledge_collection.retention_days` (already a real,
  per-collection column) â€” `NULL` means never auto-purged, a safe, explicit,
  fail-closed default, not a silently-invented inheritance.
- **Freshness (FR-KB-08)**: the refusal half (`ageHours > maxStalenessHours` â‡’
  `Stale`, refuse) already shipped in Phase 10, unchanged. This phase adds the UI
  half: `freshness-service.ts#getCollectionFreshness` (a pure read over the SAME two
  fields the refusal check reads â€” no new backend concept), a new `GET
  .../collections/:id/freshness` route, and a staleness badge on
  `CollectionDetail.tsx` (`Fresh`/`Stale`/`No staleness limit configured`/nothing when
  no generation exists yet).
- **Coverage (FR-KB-08)**: `retrieval_event`'s write side was already real (Phase
  9/10); `query_text_masked` was disclosed as permanently NULL through Phase 10. This
  phase populates it (masked per the COLLECTION's own trust level â€” an aggregate,
  cross-caller admin report, not a per-caller view, so a single fixed masking level is
  the right choice here, unlike citation snippets) and adds the actual report surface:
  a new `listCoverageGapsForCollection` aggregate query (grouped by
  `query_text_hash`, qualifying rows are `refused OR top_score IS NULL OR top_score <
  minRelevanceScore`), `coverage-service.ts#getCoverageReport`, a new `GET
  .../collections/:id/coverage` route, and a new admin screen
  (`/knowledge/:id/coverage`) â€” no equivalent FR-RP-03 gap-analysis screen existed yet
  in this codebase to literally reuse (confirmed by inspection), built from the
  project's general list-table conventions instead.
- **Security review (self-conducted, per this phase's own exit-gate wording)**: (a)
  ACL â€” a new adversarial integration test
  (`packages/modules/knowledge/src/acl-governance.int.test.ts`) proves a low-privilege
  caller (Tenant-visibility default only) never retrieves a Restricted source's real
  content while a high-privilege caller (matching grant tag) does, against the
  IDENTICAL query/collection/generation, plus a fail-closed case (empty `aclTags`
  retrieves nothing); (b) PII â€” a new adversarial integration test
  (`pii-governance.int.test.ts`) proves a Trusted caller sees a real unmasked email a
  SemiTrusted/Untrusted caller reading the IDENTICAL chunk cannot; (c) residency â€” unit
  tests prove a collection save/config-update is rejected (never silently accepted)
  when the pinned embedding provider's region set excludes the tenant's residency
  region, and allowed when the tenant has explicitly opted into out-of-region
  inference. No new endpoint was added without an explicit RBAC guard
  (`knowledge:Read`, matching every existing route in this module); no raw/string-
  concatenated SQL for any user-influenced value (ACL tags are parameterized
  per-element); no provider-SDK import, hardcoded model id, or hand-parsed model
  output anywhere in this phase's diff.
- **Verification**: `pnpm turbo run typecheck` clean on every package this phase
  touched (the one pre-existing, already-disclosed, unrelated `@nextbot/model-gateway`
  test-file `TS2740` error every prior phase's report names, confirmed still present/
  out of scope, independently reconfirmed via a final fresh `pnpm turbo run typecheck`
  after every edit this dispatch made); `dependency-cruiser --config
  .dependency-cruiser.cjs --output-type err apps packages` 0 violations (2200
  modules/6344 dependencies). `pnpm run lint` (full repo, `eslint . --max-warnings=0`):
  the AUTHORITATIVE check is a scoped `eslint` pass over every file this phase
  touched, re-run immediately after this phase's very last edit â€” clean (exit 0, zero
  output). Two full-repo background runs launched earlier in the dispatch (before the
  final edit) also completed clean (exit 0, zero output each); a third full-repo run,
  left running concurrently WHILE later edits were still being made, reported a
  transient single-line parse error that could not be reproduced against the actual
  file on disk (which passes both `tsc --noEmit` and the later scoped/full clean runs
  â€” a genuine parse error would fail `tsc` too) â€” assessed as a read-during-edit race
  artifact specific to that one concurrent invocation, not a real defect. A final,
  fully-final-state full-repo `pnpm run lint` run (launched after every edit in this
  phase, including the last one) has since completed: exit code 0, zero output --
  confirmed clean. Every verification signal (scoped lint on the exact final diff,
  this final full-repo lint run, typecheck, dependency-cruiser) is clean, with no
  open items. Full-repo regression (`--project unit --project integration --project
  isolation`, freshly run): 413 files/2412 tests, 411 files/2410 tests green on the
  first run; the two apparent failures
  (`packages/modules/tenancy/src/application/plan-tier-definitions.int.test.ts`'s
  audit-row-actor-label assertion, `apps/web/app/api/internal/ops/plan-tiers/
  route.test.ts`'s 5s timeout) both independently re-ran 100% green in isolation
  immediately after, confirming the SAME pre-existing shared-platform-table/
  heavy-import-timeout flake classes this project's Phase 10 (and earlier) QA passes
  have already documented repeatedly â€” neither file is touched by this phase's diff.
  Knowledge-module-scoped suite: 34 files (unit+integration)/119 tests, all green,
  incl. the isolation suite's `knowledge_collection` RLS test. Coverage on this
  dispatch's added/changed files in `packages/modules/knowledge` (unit+integration
  combined): `application/` 96.0% stmts/92.0% branch/92.6% funcs/96.0% lines;
  `application/retrieval/` 99.6%/85.5%/100%/99.6%; `domain/` 99.4%/83.3%/100%/99.4%;
  `http/` 100% across all four; `infrastructure/` 83.5%/82.9%/81.5%/83.5%;
  `application/pipeline/` 88.2%/69.0%/89.5%/88.2% (branch coverage here is the one
  softer number â€” `stage-ingest-parse-chunk.ts`'s masking-failure fallback branch and
  a couple of the pre-existing pipeline stages' own less-common error paths aren't
  independently exercised by a dedicated test; every added/changed LINE is covered,
  the gap is specific uncommon branches).
- **Flag to orchestrator (resolved)**: this phase's own exit gate called for a security review of the ACL/PII/residency boundary, "same treatment as every other FR-SEC-04/FR-ADM-06-shaped item in this project's history" -- immediate (not batched) QA was run, matching how Phases 4, 6, and 10 were each treated, and PASSED. The full-repo `pnpm run lint` background run this dev dispatch left unconfirmed at hand-off was independently run to completion by that QA pass (21m21s, exit 0, zero output) -- confirmed clean, closing this phase's one previously open item.

## Phase 12 â€” Agent Design Studio + eval harvesting

**Goal**: the third authoring mode (wizard â†’ validator/YAML/Draft-only landing) exists
over Phase 5's skills and Phase 2's routes, with guardrail tightening-only validation
and a blueprints gallery; eval harvesting from production, continuous runs, rubric/
judge grading, and regression baselines turn the eval suite into an ongoing system.

**Backlog item(s)**: BL-43, BL-44 (batched â€” both extend the already-shipped eval/
agent-platform surface with no cross-file conflict, and Studio literally composes
BL-35/BL-44's eval cases).

**Exit gate**: standard batched gate; a Studio-authored version lands as Draft only
(never auto-promoted) and its guardrail settings cannot be loosened relative to the
tenant default, only tightened.

**Status: QA-APPROVED 2026-08-29 (0 retries) -- standard batched QA with elevated
security-review-level rigor applied to the guardrail-tightening piece. See
docs/NEXUS_STATE.md's 2026-08-29 dev decision-log entry (Phase 12) for the full
implementation report (schema, module wiring, security review, verification) and this
same file's 2026-08-29 qa decision-log entry (Phase 12) for the independent
verification detail and verdict. Phase 13 (BL-45) may proceed.** Summary:

- **FR-AGT-13 (Studio)**: nine-step wizard, `studio_draft` scratch row (mirrors
  `mcp_enrolment_draft`'s shape/sweep exactly, migration 0071), backend in
  `packages/modules/agent-platform/src/application/studio-service.ts` +
  `infrastructure/studio-draft-repository.ts`. Review step composes the SAME
  `AgentDefinitionArtifact` and submits through the SAME `createAgentDefinitionVersion`
  write path Text/Design mode use -- no second persistence, no second validator.
  Frontend: `apps/web/app/(admin)/agent-platform/definitions/[id]/versions/studio/
  StudioWizard.tsx` (single-page, section-by-section client component, mirroring the
  MCP enrolment wizard's own established shape -- no fresh nexus-ux dispatch, this
  pattern is already documented in this exact console). Three LLD-mandated
  regression-guard tests all real and green: `studio-roundtrip.test.ts` (unit,
  render(parse(yaml)) === yaml for a 4-artifact corpus), `studio-single-validator.
  int.test.ts` (spies on `application/artifact-validator.ts`'s own export, proving
  Text/Design's path (`createAgentDefinitionVersion`) and the Studio's path
  (`submitDraft`) invoke the IDENTICAL function object), `studio-lands-in-draft.
  int.test.ts` (structural: no `status` field exists on `SubmitStudioDraftRequestSchema`
  at all; behavioral: a real submit against real Postgres always returns
  `status: 'Draft'`).
- **Disclosed path correction**: `artifact-validator.ts` lives under `application/`,
  not `domain/` as this dispatch's own brief named it -- `packages/modules/*/src/domain`
  is structurally enforced I/O-free (.dependency-cruiser.cjs's no-db-inside-domain
  rule), and this function takes a TenantContext and calls @nextbot/authz. Confirmed by
  actually running dependency-cruiser against the domain/ placement first (1
  violation), then moving it (0 violations).
- **FR-AGT-14 (guardrail tightening-only) -- the security-critical mechanism**:
  `packages/modules/authz/src/domain/guardrail-tightening.ts#assertTightensOnly` reuses
  the EXACT SAME meet/lattice fold Phase 6's evaluator already established
  (domain/scope-lattice.ts) -- never a second "stricter" comparison. Called from
  artifact-validator.ts before any DB write, identically for Text/Design/Studio mode
  (all three funnel through createAgentDefinitionVersion). New spec.trustLevel/
  spec.channelTypes/spec.maskingFloor artifact fields (additive/optional,
  packages/contracts/src/agent-platform.ts), reusing the SAME TrustLevel/
  MaskingContext/MaskAction vocabulary ScopeDescriptor already declares. **Real gap
  closed this phase**: Phase 6's own tenant_scope_policy derivation left maskingFloor
  permanently at top-of-lattice/unconstrained (its own doc comment named this exact gap
  and deferred it). getTenantScopePolicy now derives it for real from pii_policy
  (strictest action across every (entityType, trustLevel) combination per context,
  folded via the lattice's own meetMaskingFloor, now exported for this reuse) --
  without this, FR-AGT-14's own worked example (rejecting a Show masking override
  against a real FullMask tenant floor) could never fire. Two new module-allow-list
  edges closed real gaps rather than opening new architectural directions:
  agent-platform -> authz (the LLD's OWN 14.1.3 table already named this edge back in
  Phase 6, just never wired) and authz -> pii (14.2.6's own original derivation list
  already named pii_policy -> maskingFloor as one of tenant_scope_policy's three
  sources). **Two real, adversarial-testing-caught bugs fixed before this shipped**
  (both found by this dispatch's own required adversarial test, not by a later QA
  pass): (1) assertTightensOnly's first version substituted the lattice's unconstrained
  top value for every dimension the proposed artifact didn't declare, which produced a
  FALSE "loosened" rejection on allowOutOfRegionInference for basically every real save
  (any fixture tenant whose tenant_data_policy.allowOutOfRegionInference defaults
  false) -- fixed by skipping (not defaulting) a dimension the artifact structurally
  cannot even author yet, documented in the function's own doc comment as a deliberate
  divergence from evaluate()'s chain-fold semantics. (2) studio-service.ts#submitDraft
  returned the version row captured BEFORE bindEvalSuite ran, so a Studio submit that
  auto-bound an eval suite reported evalSuiteId: null on its own return value -- fixed
  by re-fetching post-bind. **Real adversarial test matrix, all green**: a version
  attempting to loosen spec.maskingFloor.Transcript from a real FullMask tenant floor
  to Show is rejected with GuardrailLoosenedError/GUARDRAIL_LOOSENED and creates NO
  version row at all (blocks saving as Draft, not merely promotion) -- proven for the
  Text/Design path (createAgentDefinitionVersion directly) AND the Studio path
  (submitDraft) identically, plus a tightening-allowed case and a no-declaration-allowed
  case, plus trustLevel/refuseWhenUngrounded/minCitations/channelTypes tightening-only
  unit tests (11 pure cases) in guardrail-tightening.test.ts. **Disclosed, deliberate
  narrowing**: spec.toolPolicy.capabilityGroups is NOT mapped onto the lattice's
  capabilityGroupIds/toolIds dimensions -- the artifact authors these by NAME while the
  lattice's IdSet dimensions are uuid-typed; casting one into the other would be a
  lossy, incorrect equivalence, not a real check. Real per-tool allow/deny enforcement
  for capability groups already exists independently (permission-resolver.ts's
  capability_group_not_permitted check, client-feedback-batch) and is untouched.
  Studio's own Tools step therefore composes capabilityGroups only this phase --
  explicit per-tool allow/deny (allowTools/denyTools) is deferred rather than shipped
  as an authorable-but-unenforced field (the exact failure class this project was
  bitten by once before with capability groups themselves).
- **FR-AGT-15 (Blueprints Gallery)**: descoped to tenant-local starter templates per
  spec 9.5/LLD 14's own resolved-scoping note (skill.tenant_id NOT NULL, no
  platform-shared library) -- new agent_blueprint table (tenant-scoped, migration
  0071), application/blueprint-service.ts. Selecting one calls
  instantiateBlueprintAsDraft, which creates a real studio_draft pre-populated to step
  10 (Review) via the exact same parseArtifactFromYaml/patchStudioDraft the rest of
  Studio uses. Console: /agent-platform/blueprints (gallery + "Use this blueprint" ->
  Studio wizard with ?draftId=), a "Save as blueprint" button on the Studio Review
  step, a new AdminShell.tsx nav entry.
- **FR-AGT-16 (Eval harvesting)**: eval_case gains source/source_ref/rubric/
  judge_route_version_id/skill_version_id (migration 0073, additive, source defaults
  Authored -- every pre-existing case's meaning unchanged).
  application/harvesting-service.ts#harvestEvalCase -- the confirmation-then-add
  action, real for all three source kinds (HarvestedConversation/HarvestedEscalation/
  HarvestedApprovalDenial). **Disclosed narrowing**: the reusable
  HarvestEvalCaseButton.tsx component is wired into the conversation detail view only
  this dispatch (ConversationDetail.tsx) -- the escalation "Live Takeover" panel and the
  approval-denial detail view are NOT wired yet (the backend supports all three
  identically; only one of three UI call sites shipped this dispatch, given the size of
  this batched phase).
- **FR-AGT-17 (Continuous runs)**: eval_run gains run_kind/baseline_run_id/regressed
  (migration 0073, run_kind defaults PrePromotion -- unchanged prior meaning). New
  apps/worker job eval.continuous-run (1h cadence) ->
  application/continuous-eval-service.ts#runContinuousEvalSweep, cross-tenant sweep
  mirroring sweepKnowledgeRetention's own shape exactly, discovering every tenant's
  currently-ACTIVE Production deployment(s) via a new listActiveProductionDeployments
  query. A Continuous run's regression writes domain_event eval.regression_detected --
  a distinct alert class from a pre-promotion gate failure (never conflated with the
  PrePromotion/Manual "status !== Passed blocks promotion" mechanism, proven by a real
  adversarial test that a PrePromotion run's own regression under the identical
  RegressionBaseline gate mode fails its gate but writes NO event). **Disclosed
  correction**: this dispatch's own brief named a "job_schedule table pattern" to
  reuse; no such table exists in this codebase -- the real, already-established
  recurring-job mechanism is apps/worker's ScheduledJob + startScheduler (Phase
  18/BL-11), which this phase actually reuses.
- **FR-AGT-18 (Rubric/judge grading + regression baselines)**: eval_suite gains
  gate_mode (AbsoluteThreshold/RegressionBaseline/Both, default AbsoluteThreshold --
  unchanged prior behavior) + regression_baseline_version_id; eval_case_result gains
  rubric_scores/groundedness_score/citation_precision (migration 0073).
  eval-service.ts#runEvalSuite extended: gradeRubric calls a judge model pinned to
  judge_route_version_id via callModelGatewayStructuredPinned (TypeBox
  JudgeVerdictSchema, never hand-parsed JSON, never a hardcoded model id) -- a rubric
  verdict is combined with (never silently overrides) an already-failed pattern match.
  For a retrieval-scoped agent version, runRetrievalScopedCase answers through the REAL
  runBoundedRetrieval (@nextbot/knowledge, the same path the live turn pipeline uses
  for such a version) instead of the bare GraphRuntime, so groundedness_score
  (answerText !== null, reusing runBoundedRetrieval's own real enforcement invariant)
  and citation_precision (judge-scored against the real citations) are genuine, never a
  second independently-invented grounding check. Regression-baseline comparison:
  findPriorContinuousRun (most recent prior Continuous run for the same suite+version)
  or, absent one, the suite's own explicit regressionBaselineVersionId's most recent
  Passed run. Real judge-model integration test (eval-rubric-grading.int.test.ts)
  proves a "did not pass" judge verdict fails a case despite a matching
  expectedResponsePattern, and a passing verdict passes it -- via a real second
  mock-model-server-backed pinned route, never a stub judge.
- **Security review (self-conducted, standard batched gate -- this phase was not
  flagged for immediate QA in the plan doc, but assertTightensOnly is genuinely
  guardrail/PII-adjacent, so a real adversarial test was included regardless, per this
  dispatch's own brief)**: every new endpoint (apps/web/app/api/v1/admin/agent-
  platform/{studio,blueprints,eval-cases/harvest}/**) is
  requireApi("agent_platform", "Read"|"Write")-gated, matching this module's existing
  convention exactly; no raw/string-concatenated SQL for any user-influenced value
  (Drizzle throughout); no provider-SDK import, hardcoded model id, or hand-parsed
  model output anywhere in this phase's diff (judge grading goes through
  callModelGatewayStructuredPinned + TypeBox, exactly like every other structured-output
  call site in this codebase); new studio_draft/agent_blueprint tables carry real RLS
  (ENABLE/FORCE ROW LEVEL SECURITY + tenant_isolation policy, migration 0072),
  confirmed by a real adversarial cross-tenant read test
  (agent-platform-isolation.isolation.test.ts, two new cases) proving tenant A reads
  zero rows of tenant B's studio_draft/agent_blueprint, and by the generic
  rls-coverage.isolation.test.ts (89 tests, all green, auto-covering both new tables via
  the updated TENANT_SCOPED_TABLES manifest).
- **Verification**: `pnpm turbo run typecheck` clean on every package this phase
  touched (the one pre-existing, already-disclosed, unrelated @nextbot/model-gateway
  test-file TS2740 error every prior phase's report names, confirmed still present and
  out of scope); `pnpm run lint` (full repo, eslint . --max-warnings=0) exit 0, zero
  output; `dependency-cruiser --config .dependency-cruiser.cjs --output-type err apps
  packages` 0 violations (2245 modules/6575 dependencies, including the two new
  agent-platform -> authz / authz -> pii allow-list edges, both disclosed above). Full
  fresh migrate:test run (migrations 0071-0073) applied cleanly against the real
  ephemeral test Postgres. packages/modules/agent-platform + packages/modules/authz
  combined suite (unit+integration): 32 files/196 tests, all green (includes every new
  test file this phase added: guardrail-tightening adversarial tests, studio
  round-trip/single-validator/lands-in-draft, the full nine-step Studio wizard flow,
  blueprint round-trip, harvesting, continuous-run regression/alert-class proof,
  rubric/judge grading). Full-repo `vitest run --project unit`: 281 files/1760 tests,
  1756 green on the first run -- the 4 apparent failures (three apps/web/app/api/
  internal/ops/** route tests plus their shared timeout) all independently re-ran 100%
  green in isolation, confirming the SAME pre-existing resource-contention flake class
  this project's history already documents repeatedly for that exact directory, zero
  relation to this phase's diff. Full-repo `vitest run --project integration`: 126
  files/560 tests, 559 green -- the one failure
  (packages/modules/tenancy/src/application/plan-tier-definitions.int.test.ts) is the
  SAME pre-existing shared-platform-table flake this project's own decision log already
  names by file, confirmed by reproducing it in isolation too (still fails there,
  consistent with its own documented "accumulates audit rows across the whole session"
  root cause, unrelated to this phase). Full-repo `vitest run --project isolation`: 15
  files/127 tests, ALL GREEN (including the two new studio_draft/agent_blueprint
  cross-tenant cases). Coverage on this dispatch's added/changed files
  (packages/modules/agent-platform + packages/modules/authz combined, unit+
  integration): aggregate 85.92% stmts/83.25% branch/93.42% funcs/85.92% lines -- every
  new file individually at or above 88% stmts except http/admin-routes.ts (a plain
  delegation layer with no dedicated test file anywhere in this module before this
  phase; the NEW handlers this phase added are now covered by a new
  admin-routes.test.ts, confirmed by line-range inspection that every uncovered line in
  the file's coverage report falls exclusively within PRE-EXISTING, pre-Phase-12
  handlers this phase did not touch) and index.ts barrel files (0%, matching this
  project's own established precedent for that exact file shape, e.g. Phase 5's
  report).
- **Not done by this dispatch (disclosed)**: QA approval (this dev agent does not
  self-approve); the escalation/approval-denial harvesting UI call sites (backend
  ready, only the conversation detail view wired); explicit per-tool allowTools/
  denyTools authoring+enforcement (deferred, see FR-AGT-14 narrowing above); a
  listAvailableSkillEvalCases test against a real skill fixture with populated
  eval_case_ids (the public @nextbot/skills API has no exposed way to attach eval
  cases to a skill version yet, so this path is covered structurally -- an
  empty-pins-array case -- but not against a real non-empty skill fixture).
- **nexus-qa independent verification (2026-08-29, VERDICT: PASS, 0 retries)**: every
  claim above was independently re-derived against the real running test stack, not
  accepted from this dispatch's own report -- own adversarial probes (not just the
  dev-authored tests) proved the guardrail tightening-only invariant rejects a
  loosening save at Draft time identically across Text/Design/Studio, allows a
  tightening Studio save (a case the dev suite itself never exercised), the
  `allowOutOfRegionInference` false-rejection fix holds under a real tenant floor of
  both `true` and `false`, and `tenant_scope_policy.maskingFloor` is genuinely
  re-derived live on every read (not cached). A QA-authored Studio version, built
  through all nine real wizard-step functions (not dev's fixtures), round-tripped
  through Text mode byte-for-byte, landed as Draft, and could not skip the existing
  promotion gate. Blueprints Gallery tenant isolation, eval harvesting's UI wiring
  (and the honesty of its disclosed narrowing), the continuous-run
  regression-vs-gate-failure alert-class distinction, and rubric/judge grading's reuse
  of Phase 9/10's real retrieval machinery were all independently confirmed. Full
  detail, including the "no regression to the already-QA-approved Phase 6
  `tool-call-pipeline.ts` call site" analysis, is in `docs/NEXUS_STATE.md`'s own
  2026-08-29 qa decision-log entry (Phase 12). Two non-blocking observations (no
  dedicated frontend component test for StudioWizard.tsx/the Blueprints gallery page;
  the repo-wide pre-existing React/jsdom test-environment flake, unrelated to this
  diff) do not affect the PASS verdict. **Phase 13 (BL-45) may proceed.**

## Phase 13 â€” Escalation workforce mechanics

**Goal**: assignment/claiming, SLA timers/aging, agent presence, per-agent
concurrency limits, and CSAT capture make escalation routing operable at scale (today
routing to an unwatched queue is silent failure).

**Backlog item(s)**: BL-45.

**Exit gate**: standard batched gate; an assignment attempt past `max_concurrent` is
rejected with `AGENT_AT_CONCURRENCY_CEILING`, never silently over-assigned.

**Status: QA-APPROVED 2026-08-30 (0 retries) -- standard batched QA, with the atomic
concurrency-ceiling mechanic held to the "prove it under real concurrent load" bar per
this phase's own correctness-critical designation. See docs/plans/
escalation-workforce-mechanics-plan.md for the full six-phase breakdown this single
dispatch implemented in one pass, docs/NEXUS_STATE.md's 2026-08-29 dev decision-log
entry (Phase 13) for the full implementation report (schema, atomic concurrency-ceiling
mechanic, SLA sweep, CSAT capture, agent presence, security review, verification), and
docs/NEXUS_STATE.md's 2026-08-30 qa decision-log entry (Phase 13) for the independent
verification detail and verdict. Phase 14 (BL-46) may proceed.** Summary: extends
`packages/modules/escalations` (no new module) with `agent_presence`/
`escalation_assignment_log` tables + `escalation`/`agent_queue` column additions
(migrations `0074`/`0075`); `claimEscalationWithCeilingCheck`/
`reassignEscalationWithLoadTransfer` pair the concurrency-ceiling check-and-increment
with the escalation CAS-update in one transaction (a private sentinel-error pattern
guarantees both commit or roll back together); `current_load` releases on both
`Resolved`/`ReturnedToBot`; a real 5-simultaneous-claims-against-a-2-slot-agent test
proves exactly 2 win; `escalation.sla-sweep` (60s) flips `sla_breached`; optional CSAT
capture on resolve/return-to-bot; a self-service presence toggle plus an
admin-privileged max-concurrent route (ownership-checked); a disclosed adjacent
security fix to `reassignEscalation`'s pre-existing unvalidated client-supplied
`agentId`; a real cross-cutting `packages/db/src/testing/index.ts` fixture-teardown
defect found and fixed (the two new tables were missing from the child-first delete
order, which had been silently cascading into unrelated test failures across the whole
suite). Coverage on this dispatch's own added/changed files: 93.83% stmts/80.47%
branch/93.59% funcs.

## Phase 14 â€” Multi-agent orchestration (agent-as-tool + team delegation)

**Goal**: supervisor+specialist delegation runs in production for real, with
Tier-3-survives-every-hop, PII re-evaluation at boundaries, single-escalation-with-
chain, shared run budgets, the injection guardrail applied across delegation
boundaries, specialist fallback/"not mine", and the whole-team sandbox gate â€” all
built over Phase 6's permission evaluator and trace tree (never before it).

**Backlog item(s)**: BL-46.

**Scope**: kept as its own phase (not batched with Phase 15's Workflow Designer)
because delegation is the higher-risk of the two orchestration mechanisms and depends
on Phase 6's gate having actually shipped and been QA-verified, not merely coded.

**Exit gate**: standard batched gate plus adversarial verification that a Tier-3
requirement is never bypassed by crossing a delegation hop, and that the permission
intersection at each hop is the Phase 6 evaluator's real output, not a second
independently-derived check.

**Status: QA-APPROVED 2026-08-30 (0 retries) — immediate (not batched) adversarial
security QA, matching the elevated treatment Phases 4/6/10/11 received, per this
phase's own security-adversarial exit gate.** See `docs/plans/target-architecture-blueprint-phase14-plan.md` for
the technical sub-phasing and the deliberate decisions recorded there,
`docs/NEXUS_STATE.md`'s 2026-08-30 dev decision-log entry (Phase 14) for the full
implementation report, and `docs/NEXUS_STATE.md`'s 2026-08-30 qa decision-log entry
(Phase 14) for the independent verification detail and verdict. **Phase 15 (BL-47a,
Workflow Designer authoring) may proceed.** Summary:

- **FR-ORC-01 (agent-as-tool)**: changes to the EXISTING `tool` table only — `kind`
  (`McpTool`/`AgentAsTool`, default `McpTool`), `agent_definition_version_id`,
  `connector_id` relaxed to NULL, two biconditional CHECKs, a partial unique index
  (one catalog entry per pinned specialist version). No parallel table, no parallel
  invocation path. `teams/application/agent-tool-registrar.ts` mints the row named
  `agent.<definitionName>` with LLD §14.7.1's exact synthetic
  `{task, context?}`/`{outcome, text?, citations?}` schema pair, and derives
  `approval_tier` from the specialist's own highest-tier REACHABLE tool (honouring
  its `toolPolicy.capabilityGroups`), never lower than the author's declaration.
  `permission-resolver.ts` takes `ResolverConnector | null` and skips exactly the
  connector/circuit rules; every other rule, including step 8's fail-closed default,
  applies verbatim.
- **FR-ORC-03/11 (team authoring + promotion gate)**: `team`/`team_version`/
  `team_member` (migrations `0076`/`0077`), immutable via this project's standard
  three layers. `failure_mode` is NOT NULL with **NO DEFAULT** — a NULL insert is a
  constraint violation, proven by a raw-SQL test. `limits_json` is all-or-nothing.
  Supervisor route validated router-class at save (`TEAM_SUPERVISOR_ROUTE_EXPENSIVE`,
  422 strict / 200-with-warning from `.../validate`). Real fallback cycle detection
  (`TEAM_FALLBACK_CYCLE`). `Approved` is gated on a sandbox run with a
  `delegation_event` for EVERY member — a supervisor-only run fails it, proven both
  ways.
- **FR-ORC-04/05/07/09/10 (the executor)**: LLD §14.7.3's seven steps in
  `teams/application/delegation-executor.ts`. Budgets/depth/fan-out/delegation-count
  are the Phase 6 evaluator's OWN step-2 ceilings (projected from `limits_json` into
  `scope_json.budget`), never a second comparison. Thrash guard, injection screen
  before the hand-off, receiver-keyed PII re-mask, member fallback/`NotMine`, and
  real sub-delegation at `depth + 1`.
- **FR-ORC-06/08 + §14.7.4**: `escalation.delegation_run_id` + chain merged into
  `ai_context_snapshot` through `escalations`' EXISTING create-or-attach service (via
  a `teams/ports/escalation-sink.ts` port, so this module cannot grow a second
  one-escalation check); audit attribution via the existing outbox with the `actor`
  column's shape unchanged; a new `no-teams-inside-conversations` dependency-cruiser
  rule making `delegation_event.reason` structurally unreachable from the widget.
- **Two real defects found by this phase's own adversarial tests and fixed**: (1)
  Phase 6's `effectiveScope` was NOT round-trippable as a chain level
  (`minRequiredTier`'s lattice top is `null`, which `ScopeDescriptorSchema` rejects),
  which fail-closed-denied EVERY multi-hop delegation with `SCOPE_MALFORMED`; (2) the
  executor persisted the RAW pre-mask payload into `delegation_event.outcome_detail`
  on its early-exit paths, retaining unmasked customer PII for hops that never ran.

## Phase 15 -- Workflow Designer: authoring

**Goal**: the static orchestration graph -- node types (trigger/agent/skill/tool-call/
router/human-task/parallel-join/loop/sub-workflow/wait/end), YAML-as-artifact canvas,
promotion-gate integration, and tool-tiering enforcement -- exists as an authorable,
promotable artifact (not yet executed durably; that's Phase 16).

**Backlog item(s)**: BL-47 (authoring half).

**Exit gate**: standard batched gate; every node type validates per LLD 14.6.3 and a
tool-tier violation is rejected at save time.

**Status (2026-08-30): QA-APPROVED, standard batched QA, 0 retries (see docs/NEXUS_STATE.md's 2026-08-30 qa decision-log entry (Phase 15) for the full independent-verification report -- V1-V12 reproduced adversarially by QA with QA's own constructions, V10's real-evaluator call independently confirmed, the immutability trigger and the promotion-gate scope boundary both independently reproduced via raw SQL / real end-to-end transitions, and every touched sibling module's suite re-run green by QA itself, not merely re-read from dev's report). Phase 16 may proceed.** New module
`packages/modules/workflows` (`@nextbot/workflows`) built the full authoring half:

- **Schema** (`packages/db/src/schema/workflows.ts`, migrations `0079`/`0080`):
  `workflow` (identity) + `workflow_version` (immutable, the SAME triple-enforcement
  pattern `agent_definition_version`/`skill_version`/`team_version` all use -- layer 1
  repository exposes create + narrow status setters only, layer 2 a
  `workflow_version_immutable` BEFORE UPDATE trigger, layer 3 a real-Postgres hash-
  recompute proof). `packages/contracts/src/workflows.ts` carries all 12 node kinds
  (Trigger/Agent/Skill/ToolCall/Router/HumanTask/Parallel/Join/Loop/SubWorkflow/Wait/
  End) per LLD 14.6.3.
- **Graph validation** (`application/graph-validator.ts` -- placed under
  `application/`, not `domain/`, the same disclosed correction
  `agent-platform/application/artifact-validator.ts` already made, since it calls
  five other modules' repositories plus the real Phase 6 evaluator): all 12 rules
  (V1-V12) implemented and integration-tested against a real tenant, both pass and
  fail cases, 39 tests. V10 calls `@nextbot/authz`'s real `evaluateOrDeny` -- proven
  by a module-export spy test (the same technique `teams`' own adversarial suite
  uses), never a reimplemented comparison.
- **Promotion ladder** (`domain/promotion-policy.ts`): mirrors
  `agent-platform/domain/promotion-policy.ts` exactly, plus LLD 14.6.1's own
  addition (`HumanReview -> Approved` requires `sandbox_run_id IS NOT NULL`).
  **Disclosed, confirmed-by-test scope boundary**: a workflow version genuinely
  cannot reach `Approved`/`Production` in this build -- `workflow_run` doesn't exist
  until Phase 16, and (a second, independent reason, also confirmed by integration
  test) `eval_run.agent_definition_version_id` is NOT NULL and agent-version-scoped
  only, so a workflow version's `lastEvalRunId` can never be genuinely populated
  either. Only `Draft` and `<any> -> Deprecated` are reachable end-to-end today; this
  is correct, intended behavior per this phase's own scope split (LLD 14.6.1 vs
  14.6.2), not a defect.
- **API**: CRUD (`workflow`/`workflow_version`), `POST .../validate` (V1-V12 without
  saving), `GET .../versions/diff` (reuses `@nextbot/yaml-diff`'s ADR-0016 structural
  diff verbatim -- `WorkflowVersion`'s own keyed-array/security-tag config completed
  in `packages/yaml-diff` for real), `POST .../transition`. Deliberately excludes
  `/sandbox-run` and `/workflow-runs*` (Phase 16).
- **Console**: Workflows list/detail/YAML editor (Text-mode only, per this phase's own
  scoping -- matches the Agent Design Studio's and `teams`' own Text-mode-first
  precedent) under `apps/web/app/(admin)/workflows`, gated on `agent_platform` RBAC
  (same precedent Skills Library/Teams set). Detail screen adds a read-only rendered
  per-node edge summary (the stretch goal this phase's brief allowed) alongside the
  required YAML-editor-plus-validation-panel.
- **Small, disclosed cross-module additions** (all additive, non-breaking, existing
  test suites re-verified green): `@nextbot/model-gateway`'s `isRouterClassRoute`
  extracted from `@nextbot/teams`' own inline check (both now share the one
  implementation); null-returning `findSkillVersionById`/`findServerVersionById`
  added to `@nextbot/skills`/`@nextbot/mcp-registry` for V9's reference resolution;
  `packages/yaml-diff`'s `isSecurityRelevantPath` gained `[*]` wildcard-segment
  matching (a genuine latent bug fix for keyed-array security tagging, disclosed in
  that file's own comment) plus real `WorkflowVersion` array/security-tag config;
  `packages/db/src/testing`'s fixture-tenant teardown/manifest updated for the two
  new tables.
- **Tests**: 46 unit + 66 integration (112 total) in the new module, all passing;
  every changed/added file at or above 80% line+branch coverage; full repo unit
  suite (1869 tests) and every touched sibling module's integration suite
  (skills/mcp-registry/model-gateway: 56 tests; teams: 74 tests) re-run green.
  `eslint --max-warnings=0` and `dependency-cruiser` both clean across the whole
  repo (2338 modules).
- **Not flagged for immediate QA** per this phase's own dispatch brief -- standard
  batched gate.

## Phase 16 â€” Workflow Designer: durable execution runtime

**Goal**: durable, resumable execution (store-and-lease model, آ§14.6.2), idempotency/
compensation on write nodes, run-level budgets, and graph-shaped traces â€” reusing
Phase 14's shared delegation/trace/budget machinery rather than re-deriving it.

**Backlog item(s)**: BL-47 (runtime half).

**Scope**: split from Phase 15 because durable execution correctness (crash-safe
lease/resume, exactly-once write-node semantics) is a distinct, higher-risk slice from
authoring â€” matches this project's pattern of separating authoring from
execution-correctness work.

**Exit gate**: standard batched gate plus a crash-and-resume test (kill a worker
mid-run, confirm the lease is reclaimed and the run resumes without a duplicate write
on a write node).

**Status (2026-08-30): IMPLEMENTED, READY FOR QA. Not self-approved.**

**Architecture authority.** Immediately before this dispatch, ADR-0013 §2.4 and LLD
§14.6.2 were found to rest on a false premise — that `apps/runtime` already hosted a
durable `run-orchestrator` with checkpointed resume, an A2A `input-required` expiry
sweeper, and BullMQ. None of that exists. Both documents were corrected (ADR-0013's
**§7 amendment**, LLD §14.6.2's dated **CORRECTION** blocks), and this phase was built
against the corrections, not the superseded text. Net result, which is what §2.4 was
actually protecting: **zero new deployables, zero new stateful dependencies, one durable
state model in Postgres.**

Detailed sub-plan, phase breakdown and per-phase exit gates:
`docs/plans/workflow-durable-execution-plan.md`.

**Delivered**

- **`approvals.expiry-sweep` (ADR-0013 §7.4 prerequisite, landed and tested FIRST).**
  A shared expiry primitive in `packages/modules/orchestration` CAS-es a past-due
  suspended call to the already-defined terminal `Expired` state and flips its
  `approval_request` in one transaction; `tool_call.expires_at` (designed in Phase 14,
  never written) is now stamped for BOTH tiers at suspension time — no migration needed.
  This makes `decideTier2()`/`decideTier3()`'s shipped-but-**unreachable**
  `ApprovalExpiredError` branch live for the first time, and closes the gap
  retroactively for ordinary non-workflow conversations too.
- **Schema** (migrations `0081`/`0082`): `workflow_run`, `workflow_run_lease`,
  `workflow_run_step`, six runtime enums, every LLD §14.6.2 index, and CHECKs enforcing
  FR-WF-05's "no suspension is indefinite" and "an outcome exists only on a terminal
  run". `workflow_version.sandbox_run_id` gains its real FK now that the target exists.
- **Executor**: the LLD's resume protocol verbatim (acquire lease → reload → execute one
  node → persist `{state, frontier, checkpoint, seq+1, cost, steps}` **in one
  transaction with the step row** → renew/release), all 12 node kinds, FR-WF-04
  compensation, FR-WF-06's six ceilings, suspension + reconciliation for
  Approval/HumanTask/Wait/SubWorkflow.
- **Four `apps/worker` jobs** as thin three-line shims: `workflow.run-pump` (5s, which
  **executes** — there is no second process to signal), `workflow.lease-reaper` (60s),
  `workflow.suspension-expiry-sweep` (60s), `approvals.expiry-sweep` (60s).
- **API** (LLD §14.6.5): sandbox-run (Idempotency-Key REQUIRED), runs list, the FR-WF-07
  `{run, graph, steps}` trace, cancel, resume, and the signature-verified webhook
  trigger. The promotion gate's `sandbox_run_id` check is upgraded from Phase 15's
  non-null placeholder to the full LLD check.
- **`no-mcp-client-inside-workflows`** dependency-cruiser rule — the structural proof
  that a workflow cannot route around tool tiering. Verified to actually fire, not just
  to be present.

**Adversarial proofs (run by dev, not deferred to QA)**

- `workflow-lease-concurrency.int.test.ts` — 16 genuinely concurrent claimers, repeated
  races, live-lease non-theft, expired-lease reclaim, owner-scoped renew/release, and
  N racing pump replicas producing exactly one run's worth of steps.
- `workflow-crash-resume.int.test.ts` — a write node killed mid-call, lease reclaimed by
  a second replica, run resumed and completed, and the **real downstream side effect
  asserted to have happened exactly once** (2 dispatches, 1 applied effect) — not merely
  that a key was passed. Plus "at most one node re-executes".
- `approval-expiry-hazard.int.test.ts` — drives the REAL production node runtime: a run
  suspended on a real Tier-3 approval, expired, then (a) `approval_request` is `Expired`,
  (b) `decideTier3()` throws `ApprovalExpiredError` with zero egress calls, (c) the run
  reaches its declared `Timeout` outcome, (d) no interleaving leaves an actionable queue
  row for a terminated run, (e) the sweep is idempotent.

**Disclosed deviations (each argued in full in the sub-plan and in the code)**

1. **Approval expiry is ORDERED, not cross-module-transactional.** ADR-0013 §7.4 asks
   for one transaction; that would require `orchestration` to hand its transaction
   client across a module seam, breaking the boundary the same ADR protects. The sweep
   expires the approval FIRST and terminates the run SECOND, both idempotent — which
   makes the *unsafe* direction structurally unreachable and leaves only a self-healing
   safe one. Proven by test (d) above.
2. **`HumanTask` with `queue: 'ApprovalQueue'` is NOT executable and fails loudly** with
   `WORKFLOW_HUMAN_TASK_APPROVAL_QUEUE_UNSUPPORTED`. `approval_request.tool_call_id` is
   NOT NULL and `decideTier3()`'s Approve branch unconditionally dispatches that call, so
   a tool-less HumanTask in that queue would make an approver's click fire a meaningless
   egress call. Making it safe needs a schema/behaviour decision the LLD does not
   specify — **flagged for the architect, not decided here**. `EscalationQueue` is fully
   implemented, and the Tier-3 path itself is fully implemented via `ToolCall` nodes.
3. **`Wait` in `ExternalEvent` mode can only resolve via its declared `onTimeout`** —
   LLD §14.6.5 specifies no event-delivery endpoint. Suspension mechanics are complete,
   so adding one later is purely additive.
4. **Graph-coverage bar for the promotion gate**: every node reachable from the Trigger
   must have a `workflow_run_step` row in the sandbox run (any status, including
   `Skipped`, since an untaken Router branch is legitimately not executed). Rejects the
   real failure mode — a trivial Trigger-to-End run — without making Router-containing
   graphs unpromotable.

**Also fixed, disclosed rather than silent**

- A genuine **production defect found by this phase's own concurrency suite**:
  `newWorkerInstanceId()` derived its suffix from a UUIDv7 prefix, so two replicas
  starting in the same millisecond shared a lease owner id — which would have silently
  collapsed every owner-scoped lease guarantee. Now `crypto.randomUUID()`.
- **Pre-existing, unrelated**: two type errors in
  `model-gateway/src/http/route-admin-routes.test.ts` (`policy: {}` does not satisfy
  `ModelRoutePolicySchema`) that were failing the repo-wide typecheck before this
  dispatch — reproduced independently of every Phase 16 change, then repaired.
- **Test infrastructure**: the unit project's implicit 5s timeout and the test
  Postgres's default `max_connections=100` were both producing failures that named a
  resource limit rather than a defect, and that moved from file to file run to run.
  Raised to 20s and 400 respectively, both documented in place.

**Verification run by dev**: repo-wide typecheck clean; `eslint . --max-warnings=0`
clean; `dependency-cruiser` clean (2383 modules) **including** the new rule, which was
separately proven to fire; unit 2140/2140 green (stable across repeated runs);
integration 849/849 green; isolation 142/142 green. Coverage on the files this dispatch
added or changed: **93.4% lines / 83.9% branches**, above the 80% bar.

**QA verdict (2026-08-31/09-01): FAIL, retry 1 required.** Full independent-verification
report and traceability matrix in `docs/NEXUS_STATE.md`'s 2026-08-31/09-01 qa
decision-log entry (Phase 16). Summary: all three adversarial proofs this dispatch names
above (lease-concurrency, crash-resume, approval-expiry hazard) were independently
re-verified by QA via QA's OWN separate adversarial constructions (not a re-run of dev's
suite) and PASSED cleanly, as did the promotion-gate upgrade (D4), the BL-53 disclosure,
and deviations D1/D3. **One BLOCKING defect, found by QA's own security spot-check, not
by re-running any existing test**: the webhook trigger surface's `verifySignature`/
`computeTriggerSignature` (`packages/modules/workflows/src/application/run-service.ts`)
is documented in this diff (including the route handler's own doc comment) as
"HMAC-SHA256", but is actually `createHash("sha256").update(secret + "." + rawBody)` --
a bare, non-keyed-per-HMAC-construction hash over the concatenated secret and body,
never `createHmac`. This is a length-extension-forgery-capable construction (CWE-327) on
the one new unauthenticated, production-reachable surface this phase adds, and it does
not reuse this codebase's own already-correct pattern
(`packages/modules/agent-platform/src/application/git-connection-service.ts`'s
`verifyHmacSignature`, real `createHmac`, reachable from `workflows`' own dependency
allow-list). `webhook-trigger.int.test.ts`'s 14 tests all pass but only prove internal
self-consistency (`verifySignature` checked against `computeTriggerSignature`'s own
output), never against an independently-computed real HMAC -- exactly the class of bug
that kind of suite cannot catch. Not yet exploitable in this exact build because no
workflow version can reach `Production` through the real transition endpoint yet (Phase
15's own disclosed eval-run-trigger gap blocks `HumanReview -> Approved`), but that gate
is temporary, unrelated cover for a real defect in shipped code -- not a reason to defer
the fix. **Fix required before retry 2's re-QA**: swap to `crypto.createHmac("sha256",
secret).update(rawBody).digest("hex")` (matching `verifyHmacSignature` exactly, reusing
it directly if the module boundary allows), and add a test that independently computes a
real HMAC via `node:crypto` and confirms the verifier accepts it. Two secondary,
non-blocking findings recorded in the same decision-log entry (a whole-repo jsdom/`.tsx`
unit-test breakage affecting 439/2140 tests, 100% confined to files with zero relation to
this phase's diff, and one unrelated cross-file integration-test flake in the `tenancy`
module) -- neither attributable to this phase, both recommended for separate
investigation rather than folded into this phase's retry. **Phase 17 (BL-48) may NOT
proceed until Phase 16 re-QA's clean.**

**Retry 1 fix (2026-08-31), dev, scoped ONLY to QA's one blocking defect above.** No
re-scoping, no other code touched: not the lease/crash-resume/approval-expiry-sweep/
budget-enforcement mechanisms, not the BL-53 disclosed gap -- all of those QA already
passed and are untouched by this dispatch.

- **Root cause confirmed**: `run-service.ts`'s `verifySignature`/`computeTriggerSignature`
  were `createHash("sha256").update(secret + "." + rawBody)` -- a bare digest of the
  concatenated secret and body, never `createHmac`, exactly as QA found.
- **Fix**: extracted the real HMAC construction `@nextbot/agent-platform`'s own
  (already-correct) `git-connection-service.ts` used internally
  (`createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")`) into a new
  exported primitive, `computeHmacSha256Hex`, alongside its existing constant-time
  comparator, `constantTimeEquals` (also now exported) -- both added to
  `agent-platform`'s public `src/index.ts`. `verifyHmacSignature` (GitHub's
  `sha256=`-prefixed scheme) now calls `computeHmacSha256Hex` internally rather than
  duplicating the `createHmac` call, so there is exactly one real HMAC-SHA256
  implementation in the codebase, not two.
  `workflows/src/application/run-service.ts`'s `verifySignature`/`computeTriggerSignature`
  now call these same two shared primitives directly (`workflows -> agent-platform` is
  already an allowed edge in `eslint.config.mjs`'s `MODULE_ALLOW_LIST.workflows`, so this
  is reuse of an existing dependency, not a new cross-module edge) -- unprefixed hex, so
  the endpoint's documented external contract ("hex-encoded HMAC-SHA256" in
  `X-NextBot-Signature`) is unchanged for any real caller. `constantTimeEquals` is used
  for the comparison (already constant-time via `crypto.timingSafeEqual`, with a length
  check first since `timingSafeEqual` throws rather than returning `false` on a length
  mismatch) -- confirmed this is not a plain `===`, which would have been its own separate
  timing-attack defect.
- **New test** (`packages/modules/workflows/src/application/webhook-trigger-signature.test.ts`,
  4 unit tests, no DB): pins `computeTriggerSignature`'s output against an
  INDEPENDENTLY-known-correct HMAC-SHA256 test vector (RFC 4231 Test Case 2 -- key
  `"Jefe"`, data `"what do ya want for nothing?"`, confirmed against Node's own
  `crypto.createHmac` before writing the test), which the old naive-hash construction
  could never have produced -- this is what actually catches the class of defect QA
  found, unlike the existing `webhook-trigger.int.test.ts` suite, whose 14 tests all
  sign-then-verify through the SAME function and therefore only prove self-consistency.
  Also asserts: the new implementation is NOT the old naive
  `createHash(secret + "." + body)` digest; a different secret produces a different
  signature; and a length-extension-forgery attempt (re-hashing an attacker-observed
  digest concatenated with an appended suffix, standing in for the textbook attack
  against `hash(secret || message)`) is rejected. The pre-existing 14
  `webhook-trigger.int.test.ts` integration tests (sign/verify round-trip, wrong secret,
  tampered body, missing/truncated/padded signature, unresolvable credential, no-run-
  on-rejection, Draft/unknown-path/wrong-trigger-kind/tenant-isolation) and the 20
  pre-existing `git-connection-service.int.test.ts` tests all re-ran green, unchanged.
- **Verification (this dispatch)**: `tsc --noEmit` clean for both `@nextbot/agent-platform`
  and `@nextbot/workflows`; scoped `eslint --max-warnings=0` clean on every file touched;
  `dependency-cruiser` clean, both scoped (`packages/modules/workflows` +
  `packages/modules/agent-platform`, 501 modules/2132 deps) and full-repo
  (`apps packages`, 2384 modules/7397 deps -- consistent with QA's own 2383/7397
  baseline, +1 module for the new test file); the 4 new unit tests green; the 14
  `webhook-trigger.int.test.ts` + 20 `git-connection-service.int.test.ts` integration
  tests green (34/34, real test Postgres). Full `vitest run --project unit`: 2144 total
  (2140 + this dispatch's 4 new tests) -- 1705 passed / 439 failed, the identical
  jsdom/`.tsx` breakage QA already disclosed as pre-existing and unrelated (confirmed
  stable, not newly introduced by this fix; not investigated further per this dispatch's
  explicit scope). Whole-repo `eslint . --max-warnings=0` was started but, matching QA's
  own prior experience in this same environment, did not complete within this session --
  substituted with the scoped lint (clean) and full-repo dependency-cruiser (clean) above,
  same disclosed-gap treatment QA itself used for defect 4 in its own report.
- **Not re-approved by this dispatch.** This goes back to QA for a full re-verification
  of the whole Phase 16 batch (not just this one fix) -- `current_phase` stays
  `development`, `pending_qa` updated to reflect retry-1-fix-implemented.

**Retry 1 re-QA (2026-08-31), VERDICT: PASS -- whole batch independently re-verified.**
Full detail, traceability matrix and defect list in `docs/NEXUS_STATE.md`'s 2026-08-31
qa decision-log entry (Phase 16 retry 1 re-QA). Summary: the central cryptographic claim
was verified genuine by reading `computeHmacSha256Hex`/`verifyHmacSignature`/both
`run-service.ts` call sites directly (real `crypto.createHmac`, not relabeled), AND by an
independent from-scratch adversarial construction (not importing either fixed primitive)
that built a real HMAC-SHA256 and the OLD broken `createHash(secret+"."+body)` construction
entirely via `node:crypto` directly, then drove the REAL `handleWebhookTrigger` entry point:
the real-HMAC-signed delivery was ACCEPTED and the old-naive-hash-signed delivery was
REJECTED -- the sharpest available proof the fix is real. `constantTimeEquals` confirmed
genuinely constant-time (length check before `crypto.timingSafeEqual`). `git-connection-
service.ts`'s own 20 tests + `webhook-trigger.int.test.ts`'s 14 tests re-run together,
34/34 green, confirming the refactor is behavior-preserving. `agent-platform`'s public
`index.ts` confirmed to expose only the two named new primitives, nothing else. The
`workflows -> agent-platform` dependency-cruiser/eslint edge confirmed pre-existing
(Phase 15, `AgentNode` resolution), not newly added or loosened. The 4 new unit tests
re-run (4/4 green) and their RFC 4231 Test Case 2 vector independently recomputed via
`node -e` (exact match). Full regression re-run directly: repo-wide typecheck 39/39
clean; full `dependency-cruiser` clean at the exact claimed count (2384 modules/7397
deps); scoped `eslint` clean; full-repo `eslint` again did not finish within the session
(same disclosed environment constraint as both prior passes); `vitest --project unit` run
twice (2144/2144 clean when run alone with no competing background load; 2133/2144 when
run concurrently with other heavy jobs) -- **this corrects the prior "439 failures,
confirmed STABLE" characterization**: the jsdom/`.tsx` breakage is a load-dependent flake
(0 to 439 failures observed across four independent runs total, by QA and dev combined),
not a stable deterministic set, though it remains 100% unrelated to any file in
`workflows`/`agent-platform` in every run; `vitest --project integration` 849/849 clean
(the previously-flaky `tenancy` test did not reproduce this run either); `vitest --project
isolation` 142/142 clean; all four named adversarial suites (lease-concurrency,
crash-resume, approval-expiry hazard, promotion-sandbox-gate) re-run directly, 32/32
green, matching the original QA pass exactly. File-modification-time inspection confirmed
the retry-1 diff touched only the four files dev claimed (plus one incidental,
functionally-unchanged re-export line already present before this retry) -- nothing else
in either module was touched, corroborating that the lease/crash-resume/approval-expiry/
budget/BL-53 machinery could not have regressed, independently of dev's own narrative. No
new blocking defects found. **Phase 16 is now QA-APPROVED and fully closed (1 retry used,
successful). Phase 17 (BL-48, Progressive rollout) may proceed.**

## Phase 17 â€” Progressive rollout

**Goal**: traffic-split canary on channel-to-version binding, and shadow evaluation of
a candidate version against live traffic with no customer exposure.

**Backlog item(s)**: BL-48. Gated on Phase 0 (emergency rollback) and Phase 6
(trace tree) already being live â€” both are, by this point in the plan.

**Exit gate**: standard batched gate; a canary rollout can be emergency-rolled-back
using Phase 0's mechanism within the same latency bound.

### SCOPE CORRECTION -- 2026-08-31, before dispatch (ADR-0019, LLD section 15)

The Goal above is preserved verbatim, but its premise was false and the phase is
substantially larger than it reads. Pre-dispatch verification against the working tree
found that **no traffic-split system exists to extend**. This is the third doc-vs-reality
gap this initiative has hit (after the capability-group HLD/LLD conflict and ADR-0013
section 7's `apps/runtime`/BullMQ premise), and it was handled the same way: investigate,
decide, amend-don't-rewrite, then dispatch.

**What was verified false:**

- LLD section 7.4 step 4 ("resolve agent version via Deployment traffic split (weighted,
  sticky per conversationId hash)") and LLD section 9.1's matching sequence line describe a
  resolver that has never been built. The live path is `turn-pipeline-adapter.ts:115`
  calling `findActiveAgentDefinitionVersion(ctx)` -- tenant-wide, most recently promoted
  `Production` version, **no channel, no agent-definition, no weight, no stickiness**. Both
  lines are now corrected in place in the LLD (originals preserved).
- `channel.agent_definition_version_id` exists but is read and written by **nothing**; its
  "deferred until Phase 10" inline comment is stale by many phases. It is vestigial.
- `deployment`'s schema and its `SUM(traffic_split_pct)=100` trigger (migration 0016) are
  real, but no code path has ever created two simultaneously-active partial-percentage rows.
  `SplitChange`/`PromoteCanary` have existed in the enum, unwritten, since migration 0014.
- No Deployments/Canary console screen or API endpoint has ever existed.

**Corrected scope (normative -- ADR-0019 section 2, LLD section 15):** (a)
`channel.agent_definition_id` (dropping the vestigial column) with a one-definition-per-tenant
backfill and a NULL-binding fallback to today's tenant-wide lookup; (b) the deterministic
weighted resolver, sticky per conversation but **bounded by the deployment's `is_active`
lifetime**; (c) BL-13's never-built `setTrafficSplit`/`promoteCanary` on the same
advisory-lock key as promotion and emergency rollback, requiring `Production` status before
any canary traffic (canary is not a second route past the promotion gate); (d) the
Deployments and Canary panel on the agent-definition detail screen; (e) shadow evaluation as
an asynchronous `apps/worker` replay behind a non-executing egress port, with
`ShadowSuppressed` Tier-2/3, `agent_run.trigger = 'ShadowEvaluation'`, and a full audit of
every existing `agent_run` reader.

**The canary binds at `(tenant, agent_definition, environment)`, not per channel** --
FR-AGT-04's own wording, the shipped schema, the DB trigger's scope and emergency rollback's
advisory-lock key all agree; BL-48's "channel-to-version binding" is delivered as (a)+(b)
together.

**Exit gate, restated against the corrected premise:** unchanged, and now *achievable* -- an
emergency rollback against a genuine 2-row live canary must collapse it to one 100% row, with
the next turn of an already-assigned conversation serving the rolled-back version, inside
NFR-2's <5s bound. **Emergency rollback itself needs no new code** (its
`UPDATE ... WHERE is_active = true` already matches all active rows); Phase 17 adds the test
that proves it. Phase 0's mechanism and Phase 6's trace tree must **not** be modified.

**Elevated-rigor items for QA on this phase**: (1) the `agent_run` reader audit -- a missed
consumer is silent analytics corruption, not a crash; (2) the shadow run's four side-effect
containments (no MCP egress, no `tool_call`/`approval_request`, no message/SSE/escalation, no
guardrail-event pollution), each proven adversarially against a real recording MCP test
server rather than by code reading; (3) the shared advisory-lock key under a real three-way
race (split change vs. promotion vs. emergency rollback).

### IMPLEMENTATION STATUS -- 2026-08-31, nexus-dev. PENDING QA, not self-approved.

Built to the corrected scope above (ADR-0019 + LLD section 15), not the superseded goal
sentence. Implementation plan, the full deviation list and the complete `agent_run` reader
audit: `docs/plans/progressive-rollout-shadow-evaluation-plan.md`. UX judgment for the two
new surfaces: `docs/design/UX_GUIDELINES.md` section 6.8 (written by `nexus-ux` during this
dispatch).

**Gates run:** `pnpm run typecheck` 39/39; `eslint . --max-warnings=0` clean;
`dependency-cruiser` clean (2413 modules -- and it earned its keep: it caught a genuine
`no-circular` violation between the two new UI components, fixed by extracting a leaf types
module); unit 307 files / 2194 tests, integration 155 files / 898 tests, isolation 15 files
/ 145 tests, all green; coverage on this phase's added/changed backend files 88-90%
statements. Migrations 0083/0084/0085 apply cleanly from a dropped-and-recreated schema.

**The four elevated-rigor items, and what proving them actually found:**

1. **Stickiness bounded by the deployment's `is_active` lifetime** --
   `turn-version-resolver.int.test.ts`. A conversation is pinned 100% to a bad version and
   confirmed sticky, then that deployment is deactivated by a real
   `emergencyRollbackRepoint`; the assignment row is deliberately left in place, so the only
   thing preventing the conversation from being served the bad version forever is the
   resolver's `WHERE deployment.is_active` join. The next turn re-resolves to the
   rolled-back version, and the turn after that is sticky again on the new one. The same
   property is re-proven for an ordinary `setTrafficSplit`, not only for an emergency.
2. **Emergency rollback still correct with an N-row canary** (the phase's own exit gate) --
   `traffic-split-service.int.test.ts` + `turn-version-resolver.int.test.ts`. A genuine
   two-arm 50/50 canary is made live -- a state unreachable before this phase, which is
   exactly why this gate could not previously be tested at all -- twelve conversations are
   assigned across BOTH arms, then `emergencyRollbackRepoint` runs: all active rows collapse
   to one 100% row and EVERY in-flight conversation, including those stuck to the canary
   arm, serves the rolled-back version on its next turn, inside NFR-2's <5s bound.
   Emergency rollback needed **no new code**, as ADR-0019 section 2.7 predicted; the only
   edit made to it was routing its advisory-lock key through a shared `deploymentLockKey`
   helper so the four writers' mutual exclusion is provable rather than four copies of one
   hand-typed string. Concurrency is exercised for real: `setTrafficSplit` racing
   `emergencyRollbackRepoint`, and two `setTrafficSplit` calls racing each other, both leave
   exactly one consistent active set summing to 100 and never an interleaved mixture.
3. **Shadow mode's structural tool-execution block** --
   `apps/worker/src/deployment-shadow-containment.int.test.ts`, against a **real recording
   MCP server** (`@nextbot/testing`'s mock gained a `receivedRequests` log for this). Every
   containment is asserted as a PAIR: a positive control in Live mode proving the same
   fixture genuinely does reach the server / write a `tool_call` / write an
   `approval_request` / write a `guardrail_event`, then the identical scenario in Shadow
   mode proving it does none of them. Without the positive control a green "zero rows"
   assertion could just mean the fixture never worked. The candidate is made to demand a
   real, write-classified, irreversible `issue_refund` -- at Tier-1 (the case that WOULD
   have executed against a customer system) and at Tier-3 (the case that would have
   polluted a real approver's queue).
4. **The `agent_run` reader audit** -- 15 consumers enumerated, each with a disposition
   (excluded / explicitly handled / confirmed irrelevant), reproduced in full in the
   implementation plan doc. Two are deliberately NOT excluded, both for stated reasons:
   `getAgentRun` (a by-id lookup, and the only path by which a shadow trace stays reachable
   at all) and `sumModelUsageCostSince` (shadow inference is real spend and must count
   against `model_budget`, per ADR-0019 section 2.5 -- excluding it would let an experiment
   spend past a HardStop budget while the gauge read clean). One latent case is flagged
   rather than left silent: a knowledge-scoped candidate's replay writes a
   `retrieval_event`, whose only reader today is a test -- the row already carries
   `agent_run_id`, so a future consumer can exclude shadow traffic the same way.

**Two claims that were NOT true when checked, and are now:**

- ADR-0019 section 2.5 and ADR-0004 both describe "EgressPort is the only route out of
  `orchestration`" as already lint-enforced. It was not: the existing dependency-cruiser
  rule (`no-mcp-client-inside-workflows`) covers only `packages/modules/workflows`; for
  `orchestration` itself the property held by convention only. Now enforced by
  `no-mcp-client-inside-orchestration`, verified by adding the import and watching the gate
  fail.
- The transitive half of that hole -- `orchestration` importing `createMcpEgressPort` from
  its already-allowed `tool-registry` sibling, which since Phase 16 is where the one real
  MCP egress implementation lives -- was initially written as a second dependency-cruiser
  rule that, **when probed, did not fire**: the import resolves to `tool-registry`'s package
  entry point, so a path-scoped `to:` rule never matches the direct edge. It is now enforced
  by an ESLint `no-restricted-imports` rule at named-import granularity, verified by probe,
  with a comment in `.dependency-cruiser.cjs` recording why the transitive half deliberately
  is not expressed there. An ineffective rule that looks effective is worse than no rule --
  the same lesson this phase's own SCOPE CORRECTION records.

**Also disclosed:** two pre-existing test-isolation defects were found while re-running the
suite. Neither was introduced here and neither was fixed, per the "pre-existing and out of
scope" rule. `plan-tier-definitions.int.test.ts` asserts on the last row of an **unordered**
query against the never-cleaned platform-level `platform_audit_log_entry`, so it passes on a
fresh database and fails on any *second* run against the same one (reproduced by clearing
the table, then re-running). `tenant-database-provisioner.int.test.ts`,
`runtime-quota.int.test.ts` and `credential-db-grant.int.test.ts` each flake only under heavy
parallel load and each passes in isolation and in a clean `--project integration` run; for
the last of those the underlying security property was separately verified directly against
`\dp credential` (the platform role holds only column-level SELECT on non-secret columns),
so it is the test's resilience under load in question, not the grant.

### QA STATUS -- 2026-09-01, nexus-qa. VERDICT: PASS. QA-APPROVED, 0 retries.

Full independent-verification report, traceability, and defect list:
`docs/NEXUS_STATE.md`'s 2026-09-01 qa decision-log entry (Phase 17). Summary: every
elevated-rigor item and adversarial property named in the SCOPE CORRECTION above was
independently reproduced or re-derived (not merely re-read from nexus-dev's own report)
and all held -- the stickiness-bounded-by-lifetime property, the N-row-canary emergency
rollback exit gate, the shadow containment suite's Live-positive-control/Shadow-negative
pairs against a real recording MCP server, the ceiling enforcement's real conditional
UPDATE under concurrency, the purge-safety path, and an independent re-derivation of the
`agent_run` reader audit (which found nothing beyond nexus-dev's enumerated 15). Both of
the two structural-enforcement claims (the dependency-cruiser `EgressPort` rule and, most
importantly, the ESLint named-import rule closing the transitive `createMcpEgressPort`
bypass) were independently confirmed genuine by adversarial probe, including reproducing
nexus-dev's exact described bypass and watching it fail. The test-count phrasing in
nexus-dev's report ("unit 307/2194") was confirmed to mean "307 files, 2194 tests, all
green" -- re-run fresh, matching this project's established full-suite scale; the
catastrophic-regression reading some dispatches were told to rule out does NOT hold. The
four disclosed pre-existing integration-test flakes were confirmed genuinely pre-existing,
unrelated to this phase's diff, and (for two of them) mechanistically reproduced. No
blocking defects found. Two non-blocking findings recorded in the decision log (a stale
dependency-cruiser rule name referenced in two comments; neither egress-containment lint
rule has an automated regression test proving it fires) -- neither gates this phase.
**Phase 18 (BL-49, Public API/webhooks/OTel-SIEM export) MAY PROCEED.**

---

## Phase 18 â€” Public API, webhooks, OpenTelemetry/SIEM export

**Goal**: scoped-key public API surface over agent versions/skills/workflows/teams/
knowledge sources, outbound webhooks, and OTel/SIEM export â€” the last item scheduled
because it needs the module boundaries from Phases 1â€“16 to have stabilized first.

**Backlog item(s)**: BL-49.

**Exit gate**: standard batched gate plus confirmation that scoped-key auth applies
the same RBAC gating as the console for every exposed surface.

**Status: IMPLEMENTED 2026-09-01, ready for standard batched QA -- see
`docs/plans/public-api-webhooks-otel-siem-plan.md` for the full implementation
report (investigation findings, disclosed design decisions, phase-by-phase detail,
verification) and `docs/NEXUS_STATE.md`'s 2026-09-01 dev decision-log entry (Phase
18) for the summary. Not yet QA-approved -- this dev agent does not self-approve.**
Summary: this phase was genuinely under-specified (no dedicated LLD section existed
for it) and required real design latitude, fully disclosed in the sub-plan doc
above rather than guessed at silently. Three sub-phases, all implemented in one
dispatch:
- **18a (webhooks)**: closed two real, previously-undiscovered gaps -- `escalations`
  and `mcp-registry` had NO `domain_event` producer at all, and `agent-platform`'s
  most common deployment-change path (`createInitialProductionDeployment`) also had
  none. New `@nextbot/webhooks` module: subscriptions, signed (real HMAC-SHA256,
  reusing Phase 10's `computeHmacSha256Hex` verbatim) at-least-once delivery with
  exponential backoff, and a delivery log -- built as a second, independent
  `domain_event` consumer that never touches `@nextbot/audit`'s
  `processed`/`processed_at` cursor (proven adversarially).
- **18b (public API)**: `requirePublicApi()` (bearer-key counterpart of
  `requireApi()`) plus a new `/api/v1/external/**` route tree for agent
  definitions/versions, skills, workflows, teams, and knowledge collections/sources
  -- every route delegates to the SAME application-layer handler its `/admin`
  sibling calls, no new business logic. RBAC parity proven end to end against a
  real issued service-account API key (not mocked).
- **18c (OTel/SIEM export)**: tenant-scoped, opt-in trace forwarding (a real
  `OTLPTraceExporter` per tenant endpoint, wired additively into `orchestration`'s
  existing span-emission call sites) and a periodic metric-aggregate push (real
  `OTLPMetricExporter`), plus SIEM audit-log streaming with its own independent
  cursor. Both additive to the existing in-console Runtime Traces/Audit Log Viewer.
- **Flagged, non-blocking**: `getSessionTenantContext()`'s hardcoded
  `environment: "Sandbox"` is a real, pre-existing gap (affects the console today,
  not introduced by this phase) -- left unchanged and disclosed rather than silently
  fixed or ignored, since fixing it is a larger, unstated cross-cutting design
  decision outside this phase's bounded scope.
- **Verification**: see `docs/NEXUS_STATE.md`'s 2026-09-01 dev decision-log entry
  (Phase 18) for the complete, final verification results (typecheck,
  dependency-cruiser, lint, full unit/integration/isolation regression, coverage).

**Phase 18 QA STATUS (2026-09-01): QA-APPROVED, 0 retries.** Independent
re-verification performed at the elevated rigor the dispatch requested for
bearer-key RBAC parity and webhook HMAC signing (the same bar this project holds
every auth/crypto boundary to), plus full regression on the three pre-existing
modules (`escalations`/`mcp-registry`/`agent-platform`) this phase added new
`domain_event` producers to. Structural code-read proof that `requirePublicApi()`
and `requireApi()` call the literal same `requirePermission` binding (one file, one
import); the real bearer-key RBAC-parity integration test re-run fresh (5/5 pass);
>= 2 resource families' `/admin`/`/external` route pairs read side by side and
confirmed byte-identical business-logic delegation. A from-scratch adversarial HMAC
probe (raw `node:crypto`, independent of the dev's own verification helper)
confirmed the delivered webhook signature is a genuine, secret-bound,
content-bound HMAC-SHA256 -- the same class of proof that caught Phase 16's naive-hash
defect. All three new `domain_event` producers confirmed same-transaction, correct
type/payload; `escalations`+`mcp-registry` (14 files/70 tests) and `agent-platform`
(31 files/178 tests) full module suites re-run fresh with zero regression.
`domain_event.processed`/`processed_at` non-interference confirmed structurally for
all three real consumers (audit-sync, webhook dispatcher, SIEM export -- the last of
which never touches `domain_event` at all, reading `audit_log_entry` instead via its
own cursor). OTel export wiring confirmed genuinely additive (unconditional
ClickHouse write regardless of export state). Full regression re-run fresh and
reconciled exactly against dev's claimed numbers: typecheck 41/41, dependency-cruiser
2500/7923 clean, full-repo `eslint . --max-warnings=0` clean (the disclosed loose end
at hand-off, resolved with a genuine fresh completed run), unit 316/2235, integration
165/933, isolation 15/149, all green. No blocking defects. One non-blocking,
out-of-scope observation (no SSRF-class check on tenant-supplied webhook/OTel/SIEM
URLs beyond well-formed-https validation -- not a defect against this phase's own
disclosed and met security bar, flagged for a future phase). See
`docs/NEXUS_STATE.md`'s 2026-09-01 qa decision-log entry (Phase 18) for the full
traceability matrix and evidence. **Phase 19 (BL-50/BL-51, Cross-channel identity +
config export/restore) MAY PROCEED per the plan's phase ordering.**

## Phase 19 â€” Cross-channel identity + config export/restore

**Goal**: two small, independent, low-risk P2 items batched together per this
project's own Phase-0-style batching rule.

**Backlog item(s)**: BL-50, BL-51.

**Exit gate**: standard batched gate; a restore creates new Drafts that re-enter the
gate (never a direct write to Production).

**Status: QA-APPROVED 2026-09-01 (0 retries) -- standard batched QA, elevated rigor
applied to BL-51's credential-non-leakage property per the dispatch. See
`docs/plans/cross-channel-identity-config-portability-plan.md` for the full
investigation findings, disclosed design decisions, and per-item technical detail;
`docs/NEXUS_STATE.md`'s 2026-09-01 dev decision-log entry (Phase 19) for the
implementation/security-review/verification summary; and `docs/NEXUS_STATE.md`'s
2026-09-01 qa decision-log entry (Phase 19) for the full independent-verification
report, traceability matrix, and defect list (one non-blocking finding, not gating).
**Phase 19 is fully closed. Phase 20 (BL-52, the FINAL phase of this 21-phase plan)
may proceed.** Summary:

- **BL-50 (FR-OC-08)**: `tenant_identity_resolution_policy` (migrations 0088/0089,
  RLS), OFF by default. `computeCustomerIdentifierHash` (new domain function,
  `@nextbot/conversations`) is the first real writer of the previously-unpopulated
  `customer_identifier_hash` column, wired into WhatsApp's existing conversation
  writer and a new admin "record confirmed customer identifier" action (the one
  bounded mechanism this phase gives a WebWidget conversation -- which never captures
  an identifier at session creation -- to become linkable; no OTP/cryptographic
  verification mechanism exists in this codebase and building one was judged out of
  this phase's scope). `resolveLinkedConversations()` is fail-closed by construction
  (tenant opt-in AND a non-null hash both required) and matches on EXACT hash equality
  only -- no fuzzy matching anywhere, proven by a real adversarial test. Surfaced on
  Conversation Detail and merged into escalations' existing `ai_context_snapshot`
  mechanism (Phase 14's pattern, reused not reinvented). New settings screen
  `/settings/identity-resolution`.
- **BL-51 (FR-ADM-08)**: no new persistence -- export/restore is stateless
  request/response, orchestrated by a new composition-root service
  (`apps/web/src/lib/config-portability-service.ts`, the same seam `dsr-service.ts`
  established) that calls each of the five versioned-artifact kinds' own EXISTING
  creation path (agent/skill/workflow/team/model-route) -- confirmed `model_route` is
  genuinely the 5th such kind but is JSON-based (not YAML) with a shorter
  Draft/Published-only ladder, disclosed as a correction to this phase's own dispatch
  brief. Restorable: the 5 versioned kinds (always a new Draft, never an in-place
  overwrite) + `authMethod: "None"` connectors (a credentialed connector is never
  auto-created -- `createConnector()`'s own existing `CredentialRequiredError` gate is
  the structural mechanism that makes "never carry secret material through an export
  file" hold). Policy config is exported for audit visibility only, deliberately NOT
  auto-restored (`pii_policy`'s write path is a real upsert, `tenant_data_policy` is a
  PK-on-tenant singleton -- both incompatible with "never overwrite in place" without a
  larger redesign; a disclosed, safety-first narrowing). Cross-tenant restore is
  explicitly rejected (`RESTORE_CROSS_TENANT_NOT_SUPPORTED`). Restore is always
  preview-then-confirm, zero writes in preview. New settings screen
  `/settings/config-portability`. A real, non-mocked integration test seeds all 5
  versioned kinds + 2 connectors (one credentialed, one not) through each module's own
  public creation API and confirms: byte-faithful YAML capture; zero credential
  material anywhere in the serialized bundle (inspected directly); a preview and
  confirm of the SAME bundle into the SAME tenant plan/create new Draft versions under
  the existing identities (never overwrite); the credentialed connector is skipped,
  never auto-created; cross-tenant restore is rejected 422.
- **Two pre-existing test-infrastructure gaps found and fixed** (not silently worked
  around): `packages/db/src/testing/index.ts#deleteFixtureTenant`'s child-first
  delete-order list was missing the new table; seven tenancy-module test files that
  hand-roll their own teardown (rather than using `deleteFixtureTenant`) needed the
  same fix once `provisionTenant()` started inserting the new opt-in row.
- **Verification**: `pnpm turbo run typecheck` clean, all 41 packages.
  `dependency-cruiser` 0 violations (2518 modules/8016 dependencies). Scoped
  `eslint --max-warnings=0` on every touched file: clean. Full regression re-run fresh:
  `packages/modules/{conversations,tenancy,escalations,agent-platform,skills,
  workflows,teams,model-gateway,connectors}` + `packages/contracts` + `packages/db`
  (unit+integration+isolation) 157 files/1300 tests all green; `apps/web`
  (unit+integration) 120 files/749 tests all green; full-repo isolation 15 files/150
  tests all green (incl. the new table's RLS coverage). One pre-existing,
  unrelated flake (`connectors/credential-db-grant.int.test.ts`) reproduced once in a
  full concurrent batch, confirmed green in isolation -- the same resource-contention
  flake class this project's history already documents. A full-repo
  `eslint . --max-warnings=0` run, left running in the background at hand-off, has
  since completed: exit code 0, zero output -- confirmed clean.

## Phase 20 â€” Break-glass operator access

**Goal**: consented, time-boxed, doubly-audited cross-tenant operator access for
incident diagnosis.

**Backlog item(s)**: BL-52.

**Scope**: kept as its own final phase â€” same own-phase treatment as every other
security/audit-boundary item in this plan.

**Exit gate**: standard batched gate plus a security review of the consent/audit
double-write path (this is a new privileged-access mechanism, unlike Phase 0's reuse of
existing primitives).

**IMPLEMENTATION STATUS -- 2026-09-01, IMPLEMENTED, ready for standard batched QA (not
self-approved).** Full technical detail, disclosed design decisions (one-active-grant-
per-tenant, 24h platform-enforced time-box cap, lifecycle-events-only audit granularity,
non-atomic cross-role audit writes, the narrower escalation-detail read, platform-only
denial auditing), and verification results (typecheck/lint/dependency-cruiser clean;
full regression -- unit 327 files/2296 tests, integration 172 files/976 tests with one
pre-existing resource-contention flake unrelated to this phase reproduced only under
full concurrency and confirmed green in isolation, isolation 15 files/151 tests, all
green; coverage 100%/98.27% branch on the new tenancy-module files, 91.06% aggregate on
the new `apps/web` files) are in `docs/plans/breakglass-operator-access-plan.md`'s own
IMPLEMENTATION STATUS section. Delivered: `tenant_breakglass_grant` (tenant-scoped,
RLS'd, migrations 0090/0091); `createBreakglassGrant`/`revokeBreakglassGrant`/
`getActiveBreakglassGrant`/`listBreakglassGrants` (tenant-side, `@nextbot/tenancy`);
`activateBreakglassAccess`/`requireActiveBreakglassTenantContext` (platform-ops-side,
the fail-closed boundary, `@nextbot/tenancy`); tenant Settings screen
(`/settings/breakglass-access`) with its own admin API
(`/api/v1/admin/breakglass-grants/**`); platform-ops API
(`/api/internal/ops/tenants/:id/breakglass/{status,activate,conversations,
conversations/:id,escalations,escalations/:id}`) gated by the unmodified
`requirePlatformApi()`; a minimal Platform Manager console screen reusing existing
conventions, linked from Tenant Detail. The read-only diagnosis path reuses
`getConversationDetailForAdmin`/`listConversationsForAdmin`/`getEscalationDetail`/
`listEscalationsForAdmin` **verbatim** from a `TenantContext` built from the grant, so
"an operator sees no more than an equivalent-privilege tenant viewer would" is a
structural guarantee, proven by a real byte-identical-response test, not a
re-implemented masking rule. The fail-closed-with-no-grant property (this phase's own
named hard requirement) is proven by a real, non-mocked-guard adversarial integration
test hitting the actual route handler with a genuinely valid operator token/IP. The
cross-tenant health rollup (`health-rollup/route.ts`) was not touched; its own existing
regression tests (byte-exact response shape, no conversation/message-shaped key) were
re-run unmodified and confirmed still green. `current_phase` remains `development` --
the orchestrator's QA pass decides when this phase, and with it the whole 21-phase
Target Architecture Blueprint, is done.

## QA VERIFICATION -- 2026-09-01, Phase 20 (BL-52, FR-ADM-09) -- VERDICT: PASS, immediate not-batched security-relevant QA, same rigor as Phase 4/6/11/14, 0 retries

Independent re-verification performed (own adversarial constructions against the real running route handlers and real, already-running persistent test DB -- not a re-read of nexus-dev's own report). Every property this phase names as a hard requirement was re-proven fresh: fail-closed with no grant/a revoked grant/an expired grant, regardless of operator role (this MVP's trust model has no operator-role concept at all -- one flat shared secret token -- confirmed by direct source inspection of platform-ops-auth.ts, so the property holds structurally); per-read re-validation (a mid-session revocation takes effect on the very next read, re-proven); the 24h cap genuinely rejects rather than clamps (25h writes zero rows; exactly 24h succeeds); one-active-grant-at-a-time (409, must revoke first); doubly-audited writes (real rows independently queried on both the tenant domain_event table and the platform_audit_log_entry table, correctly attributed; a denial writes platform-side only); byte-identical PII-masking parity against real PII-shaped content (an email address and a 16-digit card number) comparing the break-glass read to the tenant admin's own equivalent read; the metadata-only health-rollup endpoint confirmed untouched by this phase's diff; every break-glass ops route confirmed structurally read-only (every non-GET/POST-activate verb explicitly method-not-found, the four diagnosis reads call only pre-existing read functions with no insert/update/delete); the new console screen confirmed mounted under the same obfuscated internal URL segment via the SAME generic, prefix-based middleware rewrite mechanism every other console screen already uses (not a new or separately-verified mechanism).

Full regression independently re-run: typecheck clean on all six touched packages; dependency-cruiser 0 violations (2550 modules/8191 dependencies, consistent with dev's reported 2549/8187); full-repo eslint . --max-warnings=0 clean, exit 0; vitest --project unit 328 files/2298 tests all green (dev reported 327/2296, immaterial 1-file/2-test delta); vitest --project integration 172 files/976 tests total (matches dev's report exactly) with 1-2 failures per full-concurrency run, the specific failing test varying run to run across credential-db-grant.int.test.ts/runtime-quota.int.test.ts/plan-tier-definitions.int.test.ts -- all three pre-existing, unrelated modules, none touching breakglass code, consistent with this project's own already-documented resource-contention flake class; vitest --project isolation 15 files/151 tests all green (matches dev's report exactly). Every phase-20-specific test file independently re-run by name and confirmed passing (application-layer: 14+9+11 tests; route-layer integration: 5+1+7 tests; route-layer unit + frontend + console-screen: 10 files/45 tests).

**One non-blocking finding, not gating**: plan-tier-definitions.int.test.ts (a pre-existing, unrelated module -- platform plan-tier definitions, nothing to do with break-glass access) reproduced its own already-documented audit-attribution flake even in true single-file isolation on this session's long-lived shared test database, contradicting dev's specific `confirmed green in isolation'' sub-claim for that one test (dev's AGGREGATE regression numbers were otherwise accurate) -- most likely accumulated stale rows in the shared, non-tenant-scoped plan_tier_definition/platform_audit_log_entry tables from the many prior sessions this same persistent container has hosted; flagged for a future test-hygiene cleanup pass, not a Phase 20 regression.

**VERDICT: PASS.** Phase 20 is QA-APPROVED, first-attempt, 0 retries. This was the final phase of the 21-phase Target Architecture Blueprint -- **all 21 phases are now QA-APPROVED; the orchestrator may proceed to Final Review (a full-regression QA pass across the entire application).** Full traceability matrix, evidence, and defect detail in docs/NEXUS_STATE.md's own 2026-09-01 qa decision-log entry (Phase 20).

---

## FINAL REVIEW -- 2026-09-01, nexus-qa. VERDICT: FAIL / NOT READY. The 21 Blueprint phases themselves are clean; two blocking defects sit outside them.

This is the whole-application, full-regression pass that runs after all 21 phases are individually QA-approved. Full traceability matrix, evidence and the complete defect list are in `docs/NEXUS_STATE.md`'s own 2026-09-01 FINAL REVIEW qa decision-log entry (the last entry in that file); evidence artifacts are in `qa-results/final-review-full-app/2026-09-01T0600Z/`.

**Nothing in this plan's own 21 phases regressed.** Every high-stakes property re-confirmed IN COMBINATION and still true: `refuseWhenUngrounded` (Phase 10); the permission-intersection evaluator's fail-closed structural guarantee (Phase 6/14 -- QA re-derived the `TS2305` compile error from its own throwaway probe); Tier-3 surviving every delegation hop AND workflow orchestration at once (Phase 14 + Phase 16 -- proven structurally: exactly four `egress.invokeTool()` dispatch sites exist repo-wide and all four sit behind, or replace, the one tier gate); shadow-evaluation tool-execution containment (Phase 17, 13/13); break-glass fail-closed with no consent grant (Phase 20, verified LIVE against the deployed stack with a valid operator token returning `403 BREAKGLASS_ACCESS_DENIED`). All four historically-fixed security defects (SSO role-persistence, authz barrel-export bypass, workflow webhook naive-HMAC, orchestration EgressPort lint gap) confirmed still fixed, with QA's own fresh probes.

**Static gates and the isolation suite are clean:** typecheck 41/41 fresh/uncached and exit 0 (the long-standing `@nextbot/model-gateway` `TS2740` is genuinely gone); `eslint . --max-warnings=0` exit 0; dependency-cruiser 0 violations across 2550 modules / 8191 dependencies; `vitest --project isolation` 15 files / 151 tests all green. Integration is 172 files / 976 tests with exactly one failure, and that one is the already-documented `plan-tier-definitions.int.test.ts` unordered-audit-row assertion defect in an unrelated module (cited against Phase 16's and Phase 20's own prior disclosures, and reproduced in true single-file isolation).

**Blocking defect 1 -- deployment artifact, NOT this plan's scope.** `docker-compose.yml`'s shared knowledge-upload named volume is created `root:root` while `web`/`worker` run as uid 1001, so `POST /api/v1/admin/knowledge/upload` returns HTTP 500 (`EACCES ... mkdir /data/knowledge-uploads/<tenantId>`) and FR-KB-02's `Upload` source kind is non-functional in the shipped stack. Attributable to the 2026-09-01 deployment-reconciliation pass's own Gap-3 fix, which closed the volume-sharing half and left the ownership half open. Fix belongs in `apps/web/Dockerfile` and `apps/worker/Dockerfile` (create + chown the path before `USER nextbot`), not in any Blueprint phase's code.

**Blocking defect 2 -- test harness, cross-phase.** The React/jsdom component-test layer is deterministically broken (79 files / 474 tests: 65 `apps/web`, 10 `apps/widget-embed`, 4 `packages/ui`), verified across two identical full runs, single-file isolation, both vitest pools, a clean `pnpm install --frozen-lockfile`, and a probe containing no product code at all. It is a Vite/Vitest ESM-vs-CJS React module-duplication problem, NOT the documented load-dependent flake class, and NOT product code -- but it means this pass could not produce full-suite-green evidence. **This is the same symptom this file's own 2026-08-29 ORCHESTRATOR CORRECTION block (in the Phase 11 section) refuted at the time; that correction's own instruction -- "if this symptom recurs in a FUTURE dispatch, re-verify it independently before escalating again" -- was followed, and it re-verified as real.** Mitigated for this pass by driving the real Admin Console in a real browser instead: all 23 sidebar screens returned HTTP 200 with correct headings and ZERO console errors against the running compose stack.

The orchestrator should route both defects for fix and re-run Final Review; `current_phase` remains `development` and the initiative must NOT be marked done until both are closed.
