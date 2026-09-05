# Workflow Designer — durable execution runtime (Phase 16 / BL-47b) — dispatch sub-plan

**Parent plan:** `docs/plans/target-architecture-blueprint-plan.md` § "Phase 16 — Workflow
Designer: durable execution runtime". This file is the *implementation* breakdown for that
one parent phase; the parent plan's Phase 16 section and status-table row remain the
authoritative status record.

**Authority for placement:** ADR-0013 **§7** (amendment, 2026-08-30) and LLD §14.6.2's
dated **CORRECTION (2026-08-30)** block. The superseded §2.4 / struck LLD text
(`apps/runtime` hosts a `run-orchestrator`, BullMQ delayed jobs, an A2A
`input-required` sweeper) describes machinery that has never existed and is **not** built
against.

**Authority for schema/logic:** LLD §14.6.2 (tables, `WorkflowCheckpointSchema`, resume
protocol), §14.6.3 (node schemas — already shipped in Phase 15), §14.6.4 (tier survival),
§14.6.5 (API surface). Unchanged by the amendment.

---

## Architecture decisions this dispatch makes (and why)

1. **`apps/runtime` stays an empty Phase-0 scaffold.** Zero new deployables. All executor
   logic lives in `packages/modules/workflows`; `apps/worker` gains four *thin* invocation
   shims in the same three-line style as `escalation-sla-sweep.ts`.
2. **No queue library.** The reconciling sweep is the only path and is authoritative
   (ADR-0013 §7.2 constraint 1). Plain `setInterval` via the existing
   `apps/worker/src/scheduler.ts` `ScheduledJob` contract.
3. **`workflow_run_lease` is load-bearing.** `INSERT … ON CONFLICT (run_id) DO UPDATE …
   WHERE workflow_run_lease.expires_at < now()` is the exactly-one-advancer primitive,
   proven under genuinely concurrent claimers (not asserted).
4. **`workflows` may not import `packages/mcp-client`.** New `dependency-cruiser` rule
   `no-mcp-client-inside-workflows`, same shape as
   `no-neo4j-driver-outside-graph-store` / `no-raw-authz-evaluate-outside-authz`. This is
   the structural proof that a workflow cannot route around tool tiering (LLD §14.6.4).
5. **`approvals.expiry-sweep` lands first** (ADR-0013 §7.4), before the workflow
   suspension path is built on top of it.

## Disclosed deviations / narrowings (each argued, none silent)

- **D1 — Approval expiry is ordered, not cross-module-transactional.** ADR-0013 §7.4 says
  the run row and the approval row should transition "in one transaction". A single
  transaction spanning `orchestration`'s `tool_call`/`approval_request` writes and
  `workflows`' `workflow_run` write would require `orchestration` to hand its
  `TenantScopedClient` across a module seam — which breaks the very boundary the ADR
  protects. Instead the sweep **expires the approval first, then terminates the run**, and
  both halves are idempotent. That ordering makes the *unsafe* direction (queue shows an
  actionable request for an already-terminated run) structurally impossible, and leaves
  only the *safe* direction (approval Expired, run still `Suspended`) reachable — which
  self-heals on the very next 60 s tick, and in which `decideTier3()` already throws
  `ApprovalExpiredError`. Proven by test in Phase 16e, in both orders.
- **D2 — `HumanTask` with `queue='ApprovalQueue'` is not executable this phase.**
  `approval_request.tool_call_id` is `NOT NULL` and `decideTier3()`'s Approve branch
  unconditionally dispatches that `tool_call` to `EgressPort`. A `HumanTaskNode` carries no
  `toolId`, so wiring one into the Approval Queue would create a queue row whose approval
  click dispatches a meaningless/empty egress call — exactly the class of hazard this phase
  exists to close. Making it safe needs either an `approval_request` kind discriminant or a
  decision-only branch in `decideTier3()`; the LLD is silent on both, so per the "stop and
  flag" rule this is **flagged, not decided**. The executor fails such a node loudly with
  `WORKFLOW_HUMAN_TASK_APPROVAL_QUEUE_UNSUPPORTED` routed through the node's `onError`.
  `HumanTask` with `queue='EscalationQueue'` is fully implemented, and `suspension_kind =
  'Approval'` arising from a **ToolCall** node (which *does* have a real tool) is fully
  implemented — that is the path ADR-0013 §7.4's actual hazard describes.
- **D3 — `Wait` in `ExternalEvent` mode can only resolve via its declared `onTimeout`.**
  LLD §14.6.5's endpoint list contains no event-delivery surface (`/workflows/triggers/{path}`
  *starts* runs; it does not deliver events into a suspended one). Disclosed rather than
  inventing an endpoint the LLD does not specify.
- **D4 — Graph-coverage bar for the promotion gate.** "Exercised the whole graph" is
  enforced as: **every node reachable from the Trigger in the sandbox run's own authored
  graph has at least one `workflow_run_step` row in that run** (any status, including
  `Skipped` — a Router branch not taken is legitimately skipped and is recorded as such).
  Nodes unreachable from the Trigger cannot exist (V3 forbids them at save time).

---

## Phases

### 16a — `approvals.expiry-sweep` (the ADR-0013 §7.4 prerequisite)

**Goal:** a past-due Tier-2/Tier-3 suspended call reaches the already-defined terminal
`Expired` state, making `decideTier2()`/`decideTier3()`'s shipped-but-dead
`ApprovalExpiredError` branch reachable for the first time.

**Backlog item(s):** BL-47b (prerequisite carved out by ADR-0013 §7.4).

**Scope:** `packages/modules/orchestration` (`application/approval-expiry-service.ts`,
`infrastructure/tool-call-repository.ts`, `application/approval-service.ts`),
`apps/worker/src/approvals-expiry-sweep.ts` + registration. **Out of scope:** tier
semantics, the Approval Queue UI, any `workflow_*` table.

**Deliverables:** `TIER2_TIMEOUT_MS`/`TIER3_TIMEOUT_MS` exported; `tool_call.expires_at`
stamped at suspension time for **both** tiers (no migration — the column already exists and
is nullable); `claimToolCallExpiry()` (one `withTenant` transaction: CAS →
`tool_call_event` → `approval_request.status='Expired'`); `expireSuspendedToolCall()`;
`sweepExpiredApprovals()` cross-tenant sweep in `escalation.sla-sweep`'s shape.

**Exit gate:** typecheck; unit tests for the primitive's CAS semantics; integration tests
proving (a) a past-due Tier-3 sweeps to `Expired`, (b) a past-due Tier-2 sweeps identically,
(c) a subsequent `decideTier3()`/`decideTier2()` throws `ApprovalExpiredError`, (d) the
sweep is idempotent and never touches a decided/terminal call.

### 16b — durable-execution schema + contracts

**Goal:** `workflow_run` / `workflow_run_lease` / `workflow_run_step` exist with every LLD
§14.6.2 column, index, CHECK and RLS policy, plus the TypeBox contract surface.

**Scope:** `packages/db/migrations/0081_workflow_runs.sql` + `0082_workflow_runs_rls.sql`,
`packages/db/src/schema/workflows.ts`, `tenant-scoped-tables.ts`, `testing/index.ts`
teardown, `packages/contracts/src/workflow-runs.ts`. **Out of scope:** any executor logic.

**Deliverables:** the three tables; `workflow_version.sandbox_run_id` gains its real FK now
that the target exists (a tightening on an all-NULL column — non-destructive);
`WorkflowCheckpointSchema` verbatim from LLD §14.6.2; run/step DTOs; domain errors.

**Exit gate:** typecheck; `workflow-runs-schema.int.test.ts` asserting every column/CHECK
round-trips and every constraint actually fires; the isolation suite's RLS coverage check
stays green with the three new tables registered.

### 16c — the executor

**Goal:** a run advances one node per frontier entry per pass, checkpointing before every
node, under an exclusive lease, with run-level budgets enforced.

**Scope:** `packages/modules/workflows` — `domain/checkpoint.ts`, `domain/run-budget.ts`,
`domain/run-fsm.ts`, `domain/expression.ts`, `infrastructure/workflow-run-repository.ts`,
`infrastructure/workflow-run-lease-repository.ts`, `ports/node-runtime.ts`,
`infrastructure/orchestration-node-runtime.ts`, `application/node-executors.ts`,
`application/run-executor.ts`, `application/run-pump.ts`; the four `apps/worker` shims;
the new dependency-cruiser rule.

**Deliverables:** all 12 node kinds executable (subject to D2/D3); compensation stack
push + `Compensating` unwind; suspension + reconciliation for Approval / HumanTask
(Escalation) / Wait / SubWorkflow; `workflow.run-pump` (5 s), `workflow.lease-reaper`
(60 s), `workflow.suspension-expiry-sweep` (60 s).

**Exit gate:** typecheck; unit coverage of every pure domain function; integration coverage
of lease claim/renew/release/reclaim, budget termination at `BudgetExceeded`, suspension
+ expiry for each kind, and the Tier-3 suspension path.

### 16d — API surface + promotion-gate tightening

**Goal:** LLD §14.6.5's remaining endpoints, and Phase 15's `sandbox_run_id IS NOT NULL`
check upgraded to the full LLD check now that it is meaningful.

**Scope:** `packages/modules/workflows/src/application/run-service.ts`,
`webhook-trigger-service.ts`, `http/run-routes.ts`, `domain/promotion-policy.ts`,
`apps/web/app/api/v1/admin/workflow-runs/**`, `.../sandbox-run/route.ts`,
`apps/web/app/api/v1/workflows/triggers/[path]/route.ts`.

**Deliverables:** sandbox-run (Idempotency-Key REQUIRED), list/get(+steps+graph)/cancel/
resume, signature-verified webhook trigger; promotion gate now requires
`sandboxRun.workflowVersionId = version.id AND sandboxRun.state='Succeeded'` **and** D4's
graph-coverage bar.

**Exit gate:** typecheck; route-handler tests; integration test driving a version all the
way `Draft → … → Approved` through a real sandbox run, and proving each of the three new
sub-checks blocks independently.

### 16e — adversarial proofs (not deferred to QA)

**Goal:** prove the two correctness-critical properties and the security-relevant one
directly, with real infrastructure.

**Deliverables:**
- `workflow-lease-concurrency.int.test.ts` — N genuinely concurrent claimers race one
  `Pending` run; exactly one wins, losers no-op; reclaim after TTL; re-execution idempotent.
- `workflow-crash-resume.int.test.ts` — a write-classified `ToolCall` node; the lease holder
  is killed mid-step (lease abandoned with the pre-node checkpoint already committed); a
  second worker instance reclaims after TTL, resumes, completes; **the downstream side
  effect is asserted to have happened exactly once** by counting real invocations against
  the tool's own idempotency key, not by asserting a key was passed.
- `approval-expiry-hazard.int.test.ts` — a workflow run suspended on a real Tier-3
  approval; the approval expires; assert (a) `approval_request.status='Expired'`, (b)
  `decideTier3()` now throws `ApprovalExpiredError` (the previously-dead branch is live),
  (c) the run reaches its declared expiry outcome, (d) no interleaving leaves an actionable
  queue row for a terminated run.

**Exit gate:** all three green; then the whole-repo gate — `eslint . --max-warnings=0`,
`depcruise` clean including the new rule, full unit + integration + isolation suites,
coverage ≥ 80 % on files this dispatch touched.

---

## Status

| Phase | Status |
|---|---|
| 16a — `approvals.expiry-sweep` | DONE |
| 16b — schema + contracts | DONE |
| 16c — executor | DONE |
| 16d — API + promotion gate | DONE |
| 16e — adversarial proofs | DONE |

Overall: **implementation complete, READY FOR QA** (not self-approved).
</content>
</invoke>
