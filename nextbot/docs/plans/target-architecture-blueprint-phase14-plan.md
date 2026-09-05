# Target Architecture Blueprint — Phase 14 sub-plan (BL-46, multi-agent orchestration)

Companion to `docs/plans/target-architecture-blueprint-plan.md`'s own Phase 14
section (which stays the authoritative status/exit-gate record). This file only adds
the *technical* sub-phasing within that one backlog item, in the order a single
dispatch implements it. Same pattern as
`docs/plans/target-architecture-blueprint-phase9-plan.md`.

Scope source of truth: `docs/PRODUCT_SPECIFICATION.md`'s FR-ORC-01/03–11 and
`docs/architecture/LLD.md` §14.7.1–§14.7.5. Nothing here adds scope beyond those.

**Ordering constraint already satisfied**: Phase 6 (BL-37) shipped and is QA-approved
— `@nextbot/authz`'s `evaluateOrDeny` + the `delegation_event` trace tree are live.
This phase writes real rows into that already-proven schema and calls that already-
proven evaluator; it never re-derives either.

---

## Sub-phase 14.1 — Schema: agent-as-tool on the EXISTING `tool` table + Module E tables

**Goal**: `team`/`team_version`/`team_member` exist with the project's standard
immutability/RLS/monotonic-version conventions, and `tool` can represent an
`AgentAsTool` without any parallel table.

**Backlog item**: BL-46 (FR-ORC-01, FR-ORC-03).

**Scope**
- `packages/db/src/schema/tool-registry.ts`: `tool.kind` (`ToolKind` enum, default
  `'McpTool'`), `tool.agent_definition_version_id` (nullable FK), `tool.connector_id`
  relaxed NOT NULL → NULL. Two CHECKs pin the two kinds' shapes exactly.
- `packages/db/src/schema/teams.ts` (**extend**, never a second file):
  `team_status`/`team_version_status`/`team_failure_mode`/`team_member_fallback_action`
  enums; `team`, `team_version`, `team_member`; real FKs added to the three
  previously-disclosed FK-less `delegation_event` columns.
- Migrations `0076` (DDL + immutability trigger + FKs) and `0077` (RLS).
- `packages/db/src/tenant-scoped-tables.ts` + `packages/db/src/testing/index.ts`
  fixture teardown order (Phase 13 proved omitting this breaks unrelated suites).
- `packages/contracts/src/teams.ts`: team/team-version/team-member API shapes,
  `TeamLimits`, `TeamArtifact`, and the phase's named domain errors.

**Out of scope**: partitioning `delegation_event` (see "Deferrals" below).

**Exit gate**: `pnpm --filter @nextbot/db run migrate:test` applies cleanly from
scratch; the generic `rls-coverage.isolation.test.ts` auto-covers the three new
tables; a real `team_version_immutable` trigger test; a real
`(kind='McpTool') = (connector_id IS NOT NULL)` CHECK test.

## Sub-phase 14.2 — Agent-as-tool registrar + connector-optional resolver

**Goal**: adding a member to a team version mints a real `tool` row named
`agent.<definitionName>` with a synthetic `tool_schema_version`, and the EXISTING
resolver/simulate-preview/Approval Queue path works against it unchanged apart from
skipping the connector/circuit rules it structurally cannot apply.

**Backlog item**: BL-46 (FR-ORC-01).

**Scope**: `packages/modules/teams/src/application/agent-tool-registrar.ts` (new);
`tool-registry`'s `permission-resolver.ts` (`ResolverConnector | null`),
`permission-service.ts`, `tool-repository.ts`, `catalog-service.ts` — all changed only
to tolerate a null connector, never forked.

**Exit gate**: a real integration test proving `resolveToolPermission` on an
`AgentAsTool` row returns the identical result an equivalent connector-backed tool
would for Tool-scoped rules, and fails closed (`no_matching_rule`) with no rule; the
default `approval_tier` is never lower than the specialist's own highest-tier
reachable tool.

## Sub-phase 14.3 — Team authoring: versions, validation, promotion gate

**Goal**: a `team_version` is authorable as YAML, validated (supervisor route class,
required `failureMode`, complete `limits`, fallback-cycle rejection), diffable,
and promotable only through the same ladder agent versions use — with the
whole-topology sandbox gate (FR-ORC-11) enforced before `Approved`.

**Backlog item**: BL-46 (FR-ORC-03, FR-ORC-11).

**Scope**: `teams/domain/team-artifact.ts`, `teams/domain/fallback-cycle.ts`,
`teams/application/team-service.ts`, `teams/application/team-version-service.ts`,
`teams/infrastructure/team-*-repository.ts`.

**Exit gate**: a team version with no `failureMode` is a **constraint** violation
(not a defaulted insert); a partial `limits` object is rejected; a frontier-class
supervisor route produces `TEAM_SUPERVISOR_ROUTE_EXPENSIVE`; a fallback cycle
produces `TEAM_FALLBACK_CYCLE`; `Approved` is refused unless the referenced sandbox
run has a `delegation_event` row for EVERY member.

## Sub-phase 14.4 — The delegation executor

**Goal**: LLD §14.7.3's seven steps, implemented literally, writing real
`delegation_event` rows.

**Backlog item**: BL-46 (FR-ORC-04/05/07/09/10).

**Scope**: `teams/application/delegation-executor.ts`,
`teams/application/team-run-service.ts` (supervisor loop + sandbox run),
`teams/domain/thrash-detector.ts`, `teams/ports/escalation-sink.ts`,
`teams/ports/specialist-runner.ts`,
`teams/infrastructure/turn-pipeline-specialist-runner.ts`.

**Exit gate**: real-Postgres integration tests for multi-hop, thrash-halt, fallback,
NotMine re-route, and every budget/depth/fan-out/delegation-count ceiling — each
ceiling proven to come from `evaluateOrDeny`'s own deny reason, not a second check.

## Sub-phase 14.5 — Chain propagation: approvals, escalations, audit, internal-only routing

**Goal**: FR-ORC-04/06/08 and §14.7.4's structural guarantee.

**Scope**: `approval_request.risk_summary.delegationChain` (threaded from the live
chain through an additive optional `delegationContext` on `runTierEngine`/
`createSuspendedToolCall`/`runTurnPipeline`); `escalation.delegation_run_id`
(column already reserved by Phase 13) + `ai_context_snapshot.delegationChain`;
`domain_event` payloads carrying `actorLabel: "agent:<label>"` +
`detail.delegationChain` + `correlationId` (audit's existing outbox mapper picks
these up with **no** change to the `actor` column shape); a new
`no-teams-inside-conversations` dependency-cruiser rule.

**Exit gate**: `delegation-not-customer-visible.test.ts` (message rows byte-identical
to the single-agent equivalent); a real audit-query non-regression test; a
deliberately-introduced `conversations → teams` import produces a real
dependency-cruiser failure.

## Sub-phase 14.6 — API surface + admin UI + DelegationTree wiring

**Goal**: LLD §14.7.5's eight new endpoints, a Text-mode-YAML team editor mirroring
the agent-definition-version editor, and Phase 6's already-built
`DelegationTree.tsx` rendering REAL delegation runs in the takeover panel and
Runtime Traces.

**Out of scope (explicit)**: a Studio-equivalent visual team designer.

## Sub-phase 14.7 — Adversarial security verification + full gate

The six checks this phase's dispatch brief names, each as a real committed test, plus
typecheck / `eslint . --max-warnings=0` / dependency-cruiser / full regression /
coverage.

---

## Status

**All seven sub-phases IMPLEMENTED 2026-08-30 in a single dispatch. NOT QA-approved
(this dev agent does not self-approve). Flagged for IMMEDIATE (not batched) QA**, per
this phase's own exit gate, matching the elevated treatment Phases 4/6/10/11 received.

The full implementation report — every FR's mechanism, the six adversarial checks, the
two real defects the adversarial tests caught and fixed, the disclosed decisions, and
the verification figures — is in `docs/NEXUS_STATE.md`'s 2026-08-30 **dev** decision-log
entry (Phase 14), with a condensed summary in
`docs/plans/target-architecture-blueprint-plan.md`'s own Phase 14 section.

Deviations from the sub-phasing above, all deliberate and all disclosed in that report:

- **14.2** additionally seeds a Tool-scoped `Allow` permission rule when an
  `AgentAsTool` row is created. Not in the LLD's text, but without it a brand-new team
  could never delegate at all (the resolver's fail-closed default would refuse every
  hop, and an agent-as-tool has no connector/backend-type scope for a broader rule to
  match). It is not a tiering bypass — an `Allow` resolves to the tool's own derived
  `approval_tier`.
- **14.4** hoists FR-ORC-05's re-mask (LLD's step 4) to the top of the hop, ahead of
  steps 1–3. Strictly safer, and it closes a real defect: the early-exit paths wrote
  the RAW payload into the trace for hops that never ran.
- **14.4** also adds a `delegation_outcome` value, `AwaitingApproval` (migration
  `0078`, additive) — none of Phase 6's eight outcomes could honestly describe a hop
  that suspended into the Approval Queue.
- **14.5** verifies FR-ORC-08's consuming half inside `@nextbot/audit`'s own suite
  rather than `teams`', because `audit` is deliberately not a permitted import target
  for any module (LLD §2.3).

---

## Deliberate decisions recorded here rather than left implicit

1. **Budget/depth/fan-out/delegation-count enforcement is the Phase 6 evaluator, not a
   second mechanism.** `team_version.limits_json` is projected onto
   `team_version.scope_json.budget` at save time, so `evaluateOrDeny`'s own step-2
   ceilings (`DELEGATION_DEPTH_EXCEEDED`, `FAN_OUT_EXCEEDED`,
   `DELEGATION_COUNT_EXCEEDED`, `COST_BUDGET_EXCEEDED`,
   `WALL_CLOCK_BUDGET_EXCEEDED`) ARE the run-level enforcement FR-ORC-07 asks for.
   The executor's only job is to feed it the real `consumed` accumulator and route the
   resulting `Deny` to `failureMode`.
2. **Thrash similarity is a real cosine, over a term-frequency vector rather than a
   learned embedding.** LLD §14.7.3 step 2 says "cosine(payload embedding)". Calling an
   embedding model on every delegation hop would add a paid, failure-prone network call
   to the hot path (and a `teams → model-gateway` embedding dependency) for what is a
   loop-detection heuristic. The similarity function is a genuine cosine over
   normalised token-frequency vectors; `thrashWindow.similarityThreshold` keeps exactly
   its documented meaning. Disclosed, not silently substituted.
3. **`delegation_event` stays unpartitioned.** Phase 6 deferred monthly partitioning
   "until Phase 14's executor makes this table's volume real". It is now real but
   small: this phase's only production writer is a delegation hop, bounded by
   `maxDelegations` per run (single-digit), and no live channel→team binding ships in
   this phase's specified API surface — so per-tenant volume is far below
   `domain_event`'s, which is itself still unpartitioned by this project's own
   established precedent. Deferred again, deliberately and explicitly, with the same
   "addable without an application-code change" property Phase 6 recorded.
4. **`teams/ports/escalation-sink.ts` is a real port, not a direct module edge.**
   `orchestration` already establishes this exact precedent (it signals an escalation
   to the composition root rather than importing `@nextbot/escalations`). The sink is
   implemented in the composition root against `escalations`' EXISTING
   create-or-attach service, so FR-ORC-06's one-active-escalation-per-conversation
   guarantee remains that module's partial unique index, never a second check.
