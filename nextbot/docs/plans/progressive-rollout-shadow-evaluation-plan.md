# Progressive rollout — traffic-split canary + shadow evaluation (Phase 17, BL-48/BL-13)

**Status:** **all phases A–F IMPLEMENTED, READY FOR QA (nexus-dev, 2026-08-31).** Not
QA-approved — `nexus-qa` decides that, not this agent.
**Authority:** ADR-0019 (primary), LLD §15 (field-level), `docs/BACKLOG.md` BL-48 (rescoped) /
BL-13 (status block), `docs/plans/target-architecture-blueprint-plan.md` Phase 17 + its
`SCOPE CORRECTION` section, `docs/design/UX_GUIDELINES.md` §6.8 (written by `nexus-ux`
during this dispatch, for the two new UI surfaces).

This is the implementation plan for the single backlog item BL-48 (which absorbs BL-13's
never-built core). It is deliberately one plan doc for one backlog item, sliced into
technical phases per nexus-dev's ordering rule: data/domain model → core logic +
persistence → API surface → frontend → tests → docs.

## Premise (do not build against the superseded wording)

The plan doc's original Phase 17 goal sentence assumed a weighted/sticky traffic-split
resolver already existed. It does not. Verified against the working tree:

- `apps/gateway/src/lib/turn-pipeline-adapter.ts:115` calls
  `findActiveAgentDefinitionVersion(ctx)` — tenant-wide, no channel, no agent definition,
  no weight, no stickiness.
- `channel.agent_definition_version_id` has **zero** references outside the Drizzle
  declaration (re-confirmed by grep across `packages/modules/channels`, `apps/**`,
  `packages/**`).
- `deployment` + the `SUM(traffic_split_pct)=100` trigger (migration `0016`) are real, but
  `createInitialProductionDeployment` / `emergencyRollbackRepoint` are the only writers and
  both produce exactly one active 100% row.
- No `/deployments` API route or console screen exists. `SplitChange` / `PromoteCanary` have
  been unwritten enum values since migration `0014`.

## Phases

### Phase A — Schema, enums, migrations, manifests  ·  **DONE**

**Goal:** every table/column/enum ADR-0019 needs exists, with RLS, backfill, and teardown
wiring, and the vestigial channel column is gone.

**Backlog item(s):** BL-48 (a).

**Scope:**
- `packages/db/migrations/0083_run_trigger_shadow_evaluation.sql` — `ALTER TYPE run_trigger
  ADD VALUE 'ShadowEvaluation'` **alone in its own file** (Postgres forbids using a
  freshly-added label in the transaction that added it — the same constraint `0078`/`0070`/
  `0049` already record).
- `packages/db/migrations/0084_progressive_rollout.sql` — drop
  `channel.agent_definition_version_id`; add `channel.agent_definition_id uuid NULL
  REFERENCES agent_definition(id)`; one-definition-per-tenant backfill; create
  `deployment_traffic_assignment`, `shadow_evaluation`, `shadow_run` (+ their enums).
- `packages/db/migrations/0085_progressive_rollout_rls.sql` — standard single-clause
  tenant-isolation policies.
- `packages/db/src/schema/channels.ts`, `.../agent-platform.ts` (new tables live with
  `deployment`, the module that owns them).
- `packages/db/src/tenant-scoped-tables.ts`, `packages/db/src/testing/index.ts` teardown.

**Out of scope:** any change to `deployment` / `deployment_history` / migration `0016`'s
trigger (all three are reused unchanged).

**Exit gate:** typecheck; `rls-coverage.isolation.test.ts` green for the three new tables;
migrations apply cleanly against the test stack; `deleteFixtureTenant` leaves no FK debris.

---

### Phase B — The traffic-split resolver + sticky assignment (agent-platform)  ·  **DONE**

**Goal:** `resolveTurnAgentVersion(ctx, {conversationId, agentDefinitionId, environment})`
returns the version that serves this turn, deterministically weighted and sticky, with
stickiness bounded by the assigned deployment's own `is_active` lifetime.

**Backlog item(s):** BL-48 (b).

**Scope:**
- `packages/modules/agent-platform/src/domain/traffic-bucket.ts` — the pure
  `sha256(conversationId + ':' + agentDefinitionId) mod 10000` bucket + cumulative walk
  (pure, I/O-free, so it lives in `domain/` per LLD §2.2 and is directly unit-testable).
- `packages/modules/agent-platform/src/infrastructure/traffic-assignment-repository.ts`.
- `packages/modules/agent-platform/src/application/turn-version-resolver.ts`.
- `findActiveAgentDefinitionVersion` **renamed**
  `findActiveAgentDefinitionVersionTenantWideFallback`, disclosure comment updated, kept as
  the NULL-binding fallback (a deprecated alias export is retained so no existing caller,
  fixture or test regresses).

**Out of scope:** any Redis routing cache (ADR-0019 §2.3 defers it explicitly — a 5s TTL is
in direct tension with NFR-2's 5s rollback bound).

**Exit gate:** unit test of the bucket walk; integration tests for stickiness, the
**stickiness-bounded-by-lifetime** adversarial case, deterministic reproducibility, and a
≥10 000-conversation-id 90/10 distribution band.

---

### Phase C — Multi-row-active deployment writers (BL-13's never-built piece)  ·  **DONE**

**Goal:** `setTrafficSplit` / `promoteCanary` — the first code paths that can leave more
than one simultaneously-active `deployment` row for the same triple — on the **same**
advisory-lock key promotion and emergency rollback already use.

**Backlog item(s):** BL-48 (c) / BL-13.

**Scope:**
- `packages/modules/agent-platform/src/domain/traffic-split-policy.ts` — pure allocation
  validation (non-empty, each 1..100, sum exactly 100, no duplicate version).
- `setTrafficSplit` / `promoteCanary` in the **existing**
  `infrastructure/deployment-repository.ts` (not a parallel file).
- `application/traffic-split-service.ts` — the `Production`-status precondition
  (ADR-0019 §2.4: canary is never a second route past the promotion gate) and
  belongs-to-this-definition check.
- New contracts errors: `TRAFFIC_SPLIT_MUST_SUM_TO_100`, `VERSION_NOT_PRODUCTION`,
  `VERSION_NOT_IN_DEFINITION`, `DEPLOYMENT_REASON_REQUIRED`.

**Out of scope:** any new rollback code. `emergencyRollbackRepoint`'s
`UPDATE … WHERE is_active = true` already collapses N rows; this phase adds the **test**
that proves it, per ADR-0019 §2.7.

**Exit gate:** split-invariant test (90/10 writes two rows; 90/20 rejected by domain
validation *and* by the `0016` trigger with validation bypassed); a real concurrent
`setTrafficSplit` vs `emergencyRollbackRepoint` race test mirroring
`createInitialProductionDeployment`'s own documented concurrency test; the
**emergency-rollback-collapses-an-N-row-canary** adversarial test.

---

### Phase D — Composition-root wiring (channel → agent definition → version)  ·  **DONE**

**Goal:** the live turn actually uses the resolver, at both entry points, with the legacy
tenant-wide fallback preserved byte-for-byte for a NULL binding.

**Backlog item(s):** BL-48 (a)+(b).

**Scope:**
- `apps/gateway/src/lib/turn-pipeline-adapter.ts` — `generateAiReply` converted to a single
  options object (LLD §15.6 leaves this as implementation judgment; the parameter list is
  now 6 wide), taking `channelId` and `liveMessageId`.
- `SendWidgetMessageDeps.generateAiReply` + `sendWidgetMessage` (already holds
  `session.channelId` and the just-inserted customer message id).
- `apps/gateway/src/lib/whatsapp-inbound.ts` (already holds both).
- `@nextbot/channels`: `findAgentDefinitionBindingForChannel` read + the
  `PATCH /channels/{id}` binding writer.

**Out of scope:** per-channel *behavioral* divergence of the same agent (ADR-0019 §2.1
rejects it; no FR asks for it).

**Exit gate:** the existing widget/WhatsApp integration suites pass **unmodified** (ADR-0019
§6 item 10's fallback-preservation proof); a new integration test proving a bound channel
routes through the split.

---

### Phase E — Shadow evaluation: containment first, then the pump  ·  **DONE**

**Goal:** a candidate version is replayed against real live traffic asynchronously, through
the **real** turn pipeline, with four structurally-contained side-effect classes.

**Backlog item(s):** BL-48 (e).

**Scope (in this order — containment lands before anything can execute):**
1. `TurnPipelineInput.executionMode: "Live" | "Shadow"` (optional, defaults `"Live"`; every
   existing caller byte-identically unaffected).
2. `runTierEngine` gains `{ kind: "ShadowSuppressed", resolution, wouldHaveTier }` for
   Tier-2/3 in shadow mode — **no** `tool_call` row, **no** `approval_request`. Deliberately
   distinct from the existing `PolicyDenied{reason:"no_conversation_context"}` shortcut.
3. `recordGuardrailEvent` suppressed in shadow mode; the outcome is returned as data.
4. `createShadowEgressPort()` — same `EgressPort` interface, validates the invocation
   against the tool's real input schema, performs **no** network I/O, returns a synthetic
   `ShadowNotExecuted` result. Structural because `EgressPort` is the only route out of
   `orchestration` (ADR-0004, dependency-cruiser-enforced).
5. `shadow_evaluation` / `shadow_run` repositories + service in `agent-platform`
   (claim/lease/reclaim mirroring `knowledge_ingestion_job`'s `claimDueJobs` /
   `reclaimExpiredLeases` verbatim), with `sample_pct` / `max_runs` / `max_cost_usd`
   enforced for real.
6. `apps/worker/src/deployment-shadow-run-pump.ts` + `deployment-shadow-lease-reaper.ts`,
   registered at 5s / 60s.
7. Enqueue at the composition root, in the same best-effort `try/catch` idiom
   `triggerEscalation` / `recordSandboxTest` already use.
8. The `agent_run` reader audit (see the dedicated section below).

**Out of scope:** synchronous dual-run (ADR-0019 §2.5 rejects it); a read-only *tool*
classification (§3 rejects it — one misclassified tool is a real write against a real
customer system); copying transcripts into a new table (§2.5 item 2 — a new PII sink).

**Exit gate:** the three shadow-containment adversarial suites (no egress, no
`tool_call`/`approval_request`, no `message`/SSE/`escalation`/`guardrail_event`), the
purge-safety `Skipped(SourceGone)` test, and the ceiling-enforcement tests.

---

### Phase F — API contracts + Deployments & Canary UI  ·  **DONE**

**Goal:** an admin can see the current split, change it, promote a canary to 100%, read the
rollout history, see per-version live metrics, and start/stop/read a shadow evaluation —
all on the **existing** agent-definition detail screen.

**Backlog item(s):** BL-48 (d).

**Scope:** LLD §15.7's endpoints under `apps/web/app/api/v1/admin/agent-platform/…`
(`agent_platform` RBAC at `Write`, the same level promotion already requires — no new
privilege ladder), a `DeploymentsPanel.tsx` + `ShadowEvaluationCard.tsx` on
`DefinitionDetail.tsx`, and an "Answered by" selector on the channel detail screen.

**Out of scope:** a separate top-level Deployment Manager console area (ADR-0019 §2.7
explicitly scopes it out); metric-triggered auto-promotion.

**Exit gate:** route tests + component tests; `eslint . --max-warnings=0`;
dependency-cruiser clean; full regression suite; ≥80% coverage on changed files.

---

## The `agent_run` reader audit (ADR-0019's named highest-risk item) — COMPLETE

ADR-0019 §4 names this the single highest-risk item in the phase, because a missed consumer
is **silent analytics corruption, not a crash** — it produces no error and no red test.

Method: ripgrep for `schema.agentRun` across `apps/**` + `packages/**` (excluding `dist/`
and test files) for every direct query against the table; then every caller of the reader
functions those queries back (`getAgentRun`, `listAgentRunsForVersion`,
`listVersionRunMetrics`); then every holder of an `agentRunId` foreign key, checked for
whether it aggregates. `packages/modules/reporting` is an empty scaffold with no source
files at all.

| # | Reader | Disposition | Why |
|---|---|---|---|
| 1 | `agent-run-repository.ts` → `listAgentRunsForVersion` (backs `GET /versions/{id}/runs` → the **Runtime Traces** screen) | **EXCLUDED** via `excludeShadowRuns()` | A shadow run listed here is indistinguishable from a real customer turn — same status, cost, trace id. |
| 2 | `agent-run-repository.ts` → `listVersionRunMetrics` (**new this phase**; the Deployments & Canary panel's runs / error rate / p50 / p95 / cost, FR-AGT-09/10) | **EXCLUDED** via `excludeShadowRuns()` | This is the figure a human uses to decide whether to give a canary 100% of real customers. ADR-0019 §6 item 9 requires it byte-identical with an experiment running and disabled — asserted in `deployment-shadow-containment.int.test.ts`. |
| 3 | `agent-run-repository.ts` → `getAgentRun` (by id) | **NOT filtered — deliberately, and load-bearing** | Exactly two callers. (a) The conversation Trace Viewer, whose ids come from `message.agentRunId`; a shadow run can never appear there because the worker never inserts a `message`, so filtering would be dead code that merely looked prudent. (b) The shadow report following `shadow_run.shadow_agent_run_id` — the ONE deliberate path by which a shadow trace stays reachable. Documented at the function. |
| 4 | `model-gateway/route-repository.ts` → `sumModelUsageCostSince` (`model_usage_event ⋈ agent_run ⋈ agent_definition_version`; backs `enforceModelBudget`) | **EXPLICITLY HANDLED — deliberately INCLUDES shadow** | ADR-0019 §2.5: shadow inference is real spend, "charged and attributed normally … against `model_budget`". Excluding it would let an experiment spend past a `HardStop` budget while the gauge read clean. The only reader whose correct answer is "include"; documented at the function. |
| 5 | `apps/web/.../conversations/[id]/trace/route.ts` (Trace Viewer) | **Confirmed irrelevant** | Run ids come exclusively from `message.agentRunId`; a shadow run writes no `message` (structurally — the pump cannot import `insertMessage`). |
| 6 | `conversations/admin-conversation-query.ts` | **Confirmed irrelevant** | Reads `message.agent_run_id` only; its `agent_run` mention is a doc comment. |
| 7 | `agent-platform/continuous-eval-service.ts` (`eval.continuous-run`, FR-AGT-17) | **Confirmed irrelevant — behavior REVIEWED and doc-noted** | Reads `deployment`, not `agent_run`, and writes `EvalCase`-trigger runs. Phase 17 *does* change what it sees: `listActiveProductionDeployments` can now return several rows, so it schedules a continuous eval per canary arm — the correct reading of FR-AGT-17, now documented at the function. |
| 8 | `agent-platform/eval-service.ts` | **Confirmed irrelevant** | A writer (`startAgentRun` with `trigger: 'EvalCase'`); no aggregate read. |
| 9 | `orchestration/tool-call-repository.ts` → `countToolCallsForAgentRun` (**new this phase**) | **Confirmed irrelevant by construction** | A shadow run writes zero `tool_call` rows, so the count is always 0 for one. Used as the *live* side of the comparison and as the containment tests' zero-rows assertion. |
| 10 | `teams/delegation-tree-service.ts`, `teams/http/admin-routes.ts` | **Confirmed irrelevant** | By-run-id tree over `delegation_event`. A shadow turn never enters `@nextbot/teams` (the pump has no such edge, and the pipeline only signals `delegationRequest` when `input.delegation` is set, which a shadow replay never sets). |
| 11 | `workflows/*` (`workflow_run.agent_run_id`) | **Confirmed irrelevant** | A shadow replay never creates a `workflow_run`; the pump has no `@nextbot/workflows` edge. |
| 12 | `approvals` / `approval_request` queue readers | **Confirmed irrelevant by construction** | `ShadowSuppressed` never reaches `createSuspendedToolCall`. Asserted with a positive control. |
| 13 | `@nextbot/db/clickhouse` → `queryAgentRunSpans` | **Confirmed irrelevant** | By-run-id span lookup with exactly the two callers of #3; inherits its reasoning. |
| 14 | `knowledge/retrieval-event-repository.ts` → `listRetrievalEventsForConversation` | **Confirmed no live reader — FLAGGED for the future one** | A shadow replay of a *knowledge-scoped* candidate genuinely would write a `retrieval_event` against the real conversation. This function has **no production caller today** (only an integration test), so nothing is corrupted now. The row already carries `agent_run_id`, so a future consumer can exclude shadow traffic through the same `agent_run.trigger` join. Recorded rather than left silent. |
| 15 | `packages/modules/reporting` | **Confirmed irrelevant** | Empty scaffold; no source files. |

Also handled, though not an `agent_run` reader and not required by the ADR: `domain_event`
rows emitted by a shadow turn. Suppressing them would put a blind spot in an append-only
audit trail, so instead every shadow-turn outbox event is tagged (`shadowEvaluation: true`,
`actorLabel: "shadow-evaluation"`) by `turn-pipeline.ts`'s `emitTurnEvent` — keeping
`audit_log_entry` honest *and* trivially filterable, rather than silently inflating an
FR-AI-05 fallback-rate figure with traffic no customer saw.

## Verification evidence (what was actually run)

- **Migrations:** all 85 apply cleanly from an empty schema (`DROP SCHEMA public CASCADE` →
  full re-migrate), backfill included.
- **Typecheck:** `pnpm run typecheck` — 39/39 packages.
- **Lint:** `eslint . --max-warnings=0` — clean.
- **dependency-cruiser:** clean (2413 modules, 7581 dependencies cruised). Worth recording
  that it earned its keep here: the first version of the two new UI components had
  `ShadowEvaluationCard` importing a type back out of `DeploymentsPanel`, which renders it —
  a genuine `no-circular` violation, fixed by extracting `deployments-types.ts`.
- **Tests (final run, all three projects separately):** unit 307 files / 2194 tests;
  integration 155 files / 898 tests; isolation 15 files / 145 tests — all green.
- **Adversarial gate probes:** each forbidden import was temporarily added and the gate
  confirmed to fail, then reverted. Probe B initially did **not** fire — see D3 below.

## Known pre-existing flakes (NOT introduced by this phase)

1. `packages/modules/tenancy/src/application/plan-tier-definitions.int.test.ts` — "applies a
   partial patch, writes exactly one audit row…" asserts on
   `thisEditRows[thisEditRows.length - 1]` over a query with **no `ORDER BY`**, against
   `platform_audit_log_entry` — a platform-level table `deleteFixtureTenant` never cleans.
   It passes on a fresh database and fails once a second run has accumulated more `Growth`
   rows. Reproduced by clearing the table (passes) then re-running (fails). Phase 17 touches
   no tenancy, plan-tier or platform-audit code. Surfaced, not fixed, per the
   "pre-existing and out of scope" rule.
2. Three files flake only under heavy parallel load, and each passes both in isolation and
   in a clean `--project integration` run:
   `packages/graph-store/src/provisioning/tenant-database-provisioner.int.test.ts` and
   `packages/modules/tenancy/src/application/runtime-quota.int.test.ts` (observed under the
   combined `unit + integration + v8 coverage` run — Neo4j / Redis contention), and
   `packages/modules/connectors/src/infrastructure/credential-db-grant.int.test.ts` (observed
   once, not reproducible on an immediate re-run of the same suite; it opens raw `pg.Client`
   connections outside the pooled path). None is touched by this phase. The `credential`
   grants themselves were separately verified correct by inspecting `\dp credential`
   directly: the platform role holds only column-level SELECT on the non-secret columns,
   with no table-wide grant — i.e. the property the test exists to protect is genuinely
   intact, and only the test's own resilience under load is in question.

## Deviations

Recorded here as they are made, with the reason, per nexus-dev's operating rules.

- **D1 (Phase D).** `generateAiReply`'s positional parameter list is converted to a single
  options object. LLD §15.6 explicitly leaves this as implementation judgment; with
  `channelId` and `liveMessageId` added it would otherwise be six positional parameters,
  two of them optional strings that are trivially transposable at a call site.
- **D2 (Phase E).** The shadow pump body lives in `apps/worker` (the composition root)
  rather than inside a module, because the replay crosses `agent-platform` (the work
  table), `conversations` (the transcript read) and `orchestration` (the pipeline), and
  §14.1's allow-list gives no single module all three edges. This is the same reason
  `turn-pipeline-adapter.ts` lives in `apps/gateway`. The "no customer exposure" property
  is made structural rather than conventional by an ESLint `no-restricted-imports` block
  scoped to the shadow pump's files (see `eslint.config.mjs`), which forbids
  `@nextbot/escalations`, `@nextbot/mcp-client`'s networking exports, `createMcpEgressPort`,
  and the `insertMessage` / `publishConversationEvent` named imports outright. Verified by
  probe: all five fire.
- **D3 (Phase E) — a rule that looked right and was not.** ADR-0019 §2.5 states that
  `EgressPort` being the only route out of `orchestration` is "enforced by the existing
  dependency-cruiser rule". Pre-dispatch verification found that the existing rule
  (`no-mcp-client-inside-workflows`) covers only `packages/modules/workflows` — for
  `orchestration` itself the property was true by convention, not by construction. Two rules
  were added, and **probing them found a second problem**: the first attempt at the
  transitive half (`orchestration → tool-registry/src/application/mcp-egress`) never fires,
  because the import resolves to `tool-registry`'s package entry point, so a path-scoped
  `to:` rule cannot match the direct edge (and a `reachable: true` rule would flag every
  legitimate `tool-registry` import). It is therefore enforced by an ESLint
  `no-restricted-imports` rule on `packages/modules/orchestration/**` at named-import
  granularity instead, and `.dependency-cruiser.cjs` carries a comment explaining why the
  transitive half deliberately is not expressed there. Both now verified by probe.
- **D4 (Phase F) — route paths.** LLD §15.7 sketches
  `/api/v1/admin/agent-definitions/{id}/…`; the implementation uses this codebase's existing
  `/api/v1/admin/agent-platform/definitions/{id}/…` family, which the console, every other
  definition-scoped route and the emergency-rollback endpoint this panel sits beside all
  already use. Introducing a second definition-scoped URL family for one feature would be
  the worse deviation.
- **D5 (Phase E) — two comparison columns beyond LLD §15.2's field list.**
  `shadow_run.live_reply_payload_hash` and `.live_tool_call_count`. LLD gives
  `reply_payload_hash` the stated purpose "hash for cheap divergence counting"; a single
  hash cannot count divergence without the other side. Both are captured once by the pump at
  replay time (it re-reads the conversation anyway) and neither stores customer text, so
  ADR-0019 §2.5's "no new PII sink" property is preserved.
- **D6 (Phase F) — `ShadowEvaluationStatus.Completed` is unreachable in this build**
  (`nexus-ux` flagged this as an open question in UX_GUIDELINES §6.8 note 4). The repository
  only ever writes `Stopped` (admin action) and `AutoStopped` (ceiling breached); `Completed`
  is reserved for a future "ran to a planned end" path. The UI therefore styles it
  identically to `Stopped` rather than designing a distinction nothing produces — the same
  call §6.7 already makes for `PausedForApproval`.
- **D7 (Phase B) — the legacy fallback is renamed, not aliased.**
  `findActiveAgentDefinitionVersion` became
  `findActiveAgentDefinitionVersionTenantWideFallback` with no deprecated alias (the plan's
  Phase B entry anticipated one). It had exactly one production caller
  (`turn-pipeline-adapter.ts`), which this phase rewrote anyway, so an alias would have
  preserved nothing except the misleading old name — which is precisely what ADR-0019 §3
  objects to about it.
