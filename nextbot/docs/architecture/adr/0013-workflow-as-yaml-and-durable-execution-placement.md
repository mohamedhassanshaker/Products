# ADR-0013 — Workflow-as-YAML through the existing promotion gate, and where durable workflow execution runs

**Status:** Accepted · 2026-08-28 · **§2.4 corrected by the §7 amendment (2026-08-30) — read §7
before implementing anything in §2.4.**
**Context refs:** FR-WF-01 … FR-WF-07, FR-AGT-01, FR-AGT-03, FR-MCP-05, FR-ORC-02, FR-A2A-04/06,
NFR-1, NFR-2, NFR-3, spec §6.1a (Module D), §9.5 invariants 2/3/6, Blueprint §9.1–9.3,
HLD §15.10, ADR-0002, ADR-0005, ADR-0012
**Decision owner:** Architecture phase (second wave, Blueprint Modules A–F)

## 1. Context

Module D adds a static orchestration graph: eleven typed node kinds (Trigger, Agent, Skill, Tool
call, Router, Human task, Parallel/Join, Loop, Sub-workflow, Wait, End), authored on a visual
canvas, executed durably, and traced as a path over the authored graph.

Two questions had to be answered, and they are independent:

1. **What is the artifact?** A canvas naturally tempts a graph-shaped persistence model (nodes and
   edges as rows, positions and all). The Blueprint is explicit that this is the wrong answer:
   "the graph is YAML; the canvas is a renderer, so workflows inherit immutability, diffability and
   the promotion gate for free" (§9.3). The user's decision (spec §9.5 item 2) additionally keeps
   workflows and teams as **two separate artifacts** with separate governance.

2. **Where does it run?** FR-WF-05 requires durable, resumable execution: a run suspended on a Human
   task may sit for hours or days and must survive a restart, with a defined expiry behavior. That
   is a materially different runtime shape from the existing synchronous turn pipeline — which is
   why this ADR exists rather than being a line in the HLD.

## 2. Decision

### 2.1 The artifact is one validated YAML document. The canvas is a renderer.

A `workflow_version` **is** its YAML. Everything else is derived:

- `graph_json` (spec §6.1a) is a **projection** of the YAML, regenerated on read/save, never an
  independent source of truth. It is excluded from the version hash. A version whose `graph_json`
  cannot be regenerated from its YAML is a defect.
- **Canvas layout (node positions, collapsed groups, colors) is stored separately** from the
  artifact, so dragging a box on the canvas does not create a new version, and two versions that
  differ only in layout diff as identical. This is the concrete mechanism that keeps "the YAML is
  the artifact" true under a visual editor, which is the exact failure mode the Blueprint names for
  the Studio (§14.1 "the Studio outpaces the schema") and which applies equally here.
- **One validator.** The same TypeBox artifact schema and the same `validateArtifact()` entry point
  serve the canvas, the YAML text editor, the import path, and the public API (FR-API-01). No
  surface may express something the schema cannot, and no surface may bypass validation.

Validation is fail-closed and at save time, not at run time: a Loop node without a maximum-iteration
cap fails to save; a graph with any path that cannot reach an End node fails to save (FR-WF-01);
a write-classified Tool-call node without both an idempotency-key strategy and a compensating
action fails to save (FR-WF-04, "this workflow is a distributed transaction with no rollback path").

### 2.2 The promotion gate is the existing one, generalized — not a parallel one

The three-part gate already governing agent versions (a passing eval run, a human reviewer who is
not the author, at least one completed sandbox run) is extracted into **one shared, artifact-kind
parameterized promotion domain service** and applied unchanged to workflow versions, team versions,
skill versions, model route versions, and agent versions. There is no lighter-weight workflow
equivalent and no second path to Production (FR-WF-02, spec §9.5 invariant 3).

Two workflow-specific bindings of the generic gate:

- the eval run is against the **whole graph**, not per node;
- the sandbox run is a completed run of the **whole graph**, not of nodes in isolation — and it uses
  the existing single widget artifact (spec §9.5 invariant 6), not a mock console.

Restore/export (FR-ADM-08) creates Drafts that re-enter this gate; it is not a bypass.

### 2.3 Node execution is the Tool Execution Kernel (ADR-0012), not a second executor

Agent, Skill, Tool-call, and Sub-workflow nodes all dispatch through the single kernel, so they
inherit permission intersection, tier resolution, guardrails, idempotency, output-side guardrails,
tracing, and cost attribution. FR-WF-03 ("tool tiering survives orchestration") is therefore not new
enforcement in the workflow engine — the engine has no way to call a tool that skips it. A Human
task node routes into the **existing** Approval Queue or Escalation Queue; there is no third queue
(FR-WF-01).

Each node's effective scope is the workflow's scope intersected with the node's declared scope
intersected with the invoked artifact's own scope — the same evaluator, same envelope.

### 2.4 Durable execution: **no new service.** It is a module in the existing Data Plane, with timers in the existing worker.

> ⚠️ **CORRECTED BY §7 (2026-08-30).** The conclusion of this section — *no new service, no new
> stateful dependency, reuse Postgres-backed durable state, timers in `apps/worker`* — still
> stands and is unchanged. The **factual premise below is false**: `apps/runtime` is an empty
> scaffold, there is no `run-orchestrator`, no A2A `input-required` sweeper, no approval-expiry
> sweeper, and no BullMQ anywhere in this workspace. The original text is preserved verbatim
> below as the historical record. **§7 is normative for placement; this section is not.**

This is the load-bearing operational decision of this ADR, so it is stated flatly:

**A workflow run is a durable run.** The Data Plane (`apps/runtime`) already owns exactly the
runtime shape FR-WF-05 describes and has since Phase 2: a durable state machine in Postgres with an
optimistic-concurrency version column, suspension states that release the worker entirely
(`awaiting_approval` holds a row, not a pod, for up to three days), idempotent resume on any pod,
and an expiry sweeper in `apps/worker` for the A2A `input-required` timeout — which FR-WF-05 itself
names as the pattern to follow.

So:

| Concern | Where it runs | Reuses |
|---|---|---|
| Workflow graph execution, step dispatch, checkpointing | `apps/runtime` — new `workflows` module beside `run-orchestrator` | ADR-0005's durable run state machine, optimistic concurrency, idempotent resume |
| Suspension on Human task / Wait | Postgres `workflow_run.checkpoint_json` + `workflow_run_step` | The existing suspend/resume mechanics; no worker held |
| Timer wake-ups and expiry | `apps/worker` sweepers (BullMQ delayed jobs + a reconciling sweep) | The existing A2A `input-required` timeout sweeper pattern |
| Run-level budgets (steps, cost, wall-clock, loop iterations) | The executor in `apps/runtime` | The delegation envelope's run-budget counters (ADR-0012 §2.4) |
| Traces | Existing Runtime Trace, rendered as a path over the authored graph | FR-RP-08's viewer — no separate workflow trace viewer (FR-WF-07) |

**No fifth plane, no new deployable, and no workflow-orchestration engine dependency.** Nothing in
the four-plane boundary changes — which preserves HLD §13's claim that every post-Phase-1 item is a
module inside an existing plane. The one new deployable in the second wave is `nextbot-ingest`
(HLD §15.3), and it exists for the knowledge pipeline's resource profile, not for workflows.

The timer path deserves one explicit note, because it is the only genuinely new mechanic: a delayed
BullMQ job is the fast path for a Wait/Human-task expiry, and a periodic reconciling sweep over
suspended `workflow_run` rows is the correctness path. The sweep is authoritative; the delayed job
is an optimization. A lost delayed job therefore delays a wake-up, it does not lose a run — the same
webhook-primary/polling-fallback shape already used for Git PR status (ADR-0009) and A2A timeouts.

Every suspension type declares an expiry behavior; an unanswered Wait past its timeout transitions
the run to a **declared** failure/timeout outcome (FR-WF-05). A run never remains suspended
indefinitely, and End nodes are explicit — there is no implicit fallthrough (FR-WF-01).

## 3. Alternatives considered

**Adopt a dedicated durable-execution engine (Temporal, Restate, or equivalent).** Rejected. It is
the textbook answer and it is genuinely good technology, but here it means operating a new stateful
cluster per regional cell (ADR-0002's multi-container escape hatch requires a documented requirement
the existing topology cannot satisfy — and the existing topology *does* satisfy this one), a second
durable-state model living beside the one ADR-0005 already built and tested, a second place run
state can be inconsistent with Postgres, and a second scaling/backup/residency surface per cell.
The concrete requirement it would buy — "checkpointed, resumable after a restart, with defined
expiry" — is already met by the run orchestrator that suspends Tier-3 approvals for three days
today. Reconsider only if workflows later need cross-cell or multi-day-scale fan-out semantics that
the Postgres state machine genuinely cannot express; that would be a new ADR, not a quiet migration.

**A separate `nextbot-workflow` deployable running the same code.** Rejected: the scaling driver
(active steps) is the same driver as `nextbot-runtime`'s (active turns), workflow steps *are* runs
of agents and tools, and splitting them would put the kernel of ADR-0012 in two images — the exact
"second executor" outcome that ADR forbids. The §4 multi-container escape hatch is not satisfied:
there is no independent scaling, cadence, or resource-profile requirement here.

**Graph-shaped persistence (nodes/edges as rows) with YAML as an export.** Rejected: it makes the
canvas the source of truth, which loses structural diff (ADR-0016), makes the promotion gate operate
on a shape it does not understand, breaks round-trip equality with the text editor, and reopens the
"no surface may express something the schema cannot" invariant. The reverse — YAML as truth,
`graph_json` as projection — costs one regeneration function and keeps every governance property.

**A workflow-specific promotion gate ("workflows are simpler, a sandbox run is enough").** Rejected
by spec §9.5 invariant 3 and by risk: a workflow can invoke Tier-3 tools across many nodes, which
makes it *more* dangerous than a single agent version, not less.

**Merging workflows and teams into one artifact.** Rejected by explicit user decision (spec §9.5
item 2): static reviewable orchestration and dynamic delegation have genuinely different governance
stories, and merging them would force one permission/promotion model to serve both.

## 4. Consequences

**Positive.** Workflows inherit immutability, structural diff, the promotion gate, tool tiering,
approvals, tracing, and cost attribution without a line of new governance code. Operations gains no
new stateful component. The canvas can be rewritten or replaced without touching the artifact.

**Negative / accepted costs.**

- Complex graphs are awkward to express in YAML by hand. Accepted: the canvas is the primary
  authoring surface; the YAML is the artifact and the review surface. This is the same trade already
  accepted for agent definitions (FR-AGT-03).
- Building durable execution on the run state machine means workflow features are constrained by
  what that state machine can express. That constraint is deliberate — it is what keeps one durable
  model rather than two — but it means an unbounded/unstructured workflow feature request must be
  refused or must change ADR-0005, not be smuggled in as a workflow-only mechanism.
- Long-lived suspended runs accumulate rows. Retention/expiry policy for `workflow_run` and
  `workflow_run_step` must be defined with the existing retention sweeper (FR-ADM-06), not left to
  grow.
- Sub-workflow nodes make recursion possible. Bounded by the depth cap in the delegation envelope's
  run budget (ADR-0012 §2.4), enforced by the executor, validated at save time where statically
  determinable.

## 5. Consequences for the LLD

- Workflow artifact TypeBox schema (all eleven node kinds) and `validateArtifact('workflow', …)`.
- `workflow`, `workflow_version`, `workflow_run`, `workflow_run_step` schema (§6.1a shapes),
  including the checkpoint shape and the layout-hints table kept outside the version hash.
- The generalized promotion domain service and the artifact-kind binding table.
- The workflow executor's state machine, its resume contract, and the delayed-job + reconciling-sweep
  timer design.
- Node-kind → kernel dispatch mapping, and the per-node scope declaration format.
- The graph-shaped trace query for FR-WF-07 (path over the authored graph, existing viewer).

## 6. Verification

1. **Round-trip test:** canvas → YAML → canvas produces an identical graph; layout changes alone
   produce no new version and diff as empty.
2. **Gate test:** a workflow version cannot reach Production without a passing whole-graph eval, a
   reviewer ≠ author, and a completed whole-graph sandbox run — asserted through the same shared
   promotion service used by agent versions.
3. **Tiering test:** a Tier-3 tool in a Tool-call node, an Agent node, and a Skill node all stop at
   the Approval Queue (shares the ADR-0012 §6 matrix).
4. **Durability test:** suspend a run on a Human task, restart the whole `apps/runtime` fleet, resume
   on a different pod, and assert exactly-once step execution via the idempotency claim.
5. **Expiry test:** a Wait node past its timeout transitions to its declared outcome; with the
   delayed job deliberately dropped, the reconciling sweep still fires it.
6. **Budget test:** step, cost, wall-clock, and loop-iteration ceilings each terminate the run at a
   declared failure outcome, logged distinctly from a node-level failure (FR-WF-06).
7. **Validation tests:** uncapped Loop, unreachable End, and write node missing
   idempotency/compensation each fail at save with the specific named error.

## 7. Amendment (2026-08-30) — §2.4's premise was factually wrong; the executor is hosted by `apps/worker`, and the approval-expiry sweeper is a Phase 16 prerequisite

**Status:** Accepted · 2026-08-30
**Trigger:** pre-dispatch verification of Phase 16 (BL-47b, Workflow Designer durable execution
runtime) against the actual repository, by the orchestrating session and a follow-up
architecture-correction dispatch. Phases 0–15 are QA-approved; nothing here touches Phase 15's
shipped authoring half.
**Scope:** §2.4 only (its premise paragraph and its consequence table), plus the corresponding
statements in LLD §14.6.2, §14 preamble ("Boundary with the HLD dispatch") and §16 item 2.
**Everything else in this ADR — §2.1, §2.2, §2.3, §3, §4, §5, §6 — is unchanged and still
correct.**

### 7.1 What §2.4 claimed, and what is actually in the repository

§2.4 justified "no new service, just add a `workflows` module beside the existing durable
machinery" by asserting that machinery already existed. It does not. Verified directly against
the working tree on 2026-08-30:

| §2.4's claim | Actual state |
|---|---|
| "The Data Plane (`apps/runtime`) already owns exactly the runtime shape FR-WF-05 describes … since Phase 2" | `apps/runtime/src/index.ts` is `// Reserved scaffolding as of Phase 0 — no behavior yet. export {};`. Its own `README.md` says "Reserved app scaffold (Phase 0, LLD §2.1) — populated in the dev phase that first needs it." It has **never** been populated. |
| "a `workflows` module beside `run-orchestrator`" | The string `run-orchestrator` occurs **only** in documentation (this ADR, ADR-0003, HLD, LLD). Zero occurrences in any source file under `apps/` or `packages/`. |
| "suspension states that release the worker entirely (`awaiting_approval` holds a row, not a pod, for up to three days)" | Half true, and not where §2.4 says. The durable suspension that *does* exist is the `tool_call` FSM in `packages/modules/orchestration` (`approval-service.ts`, CAS `claimToolCallTransition`, `AwaitingHumanApproval`/`AwaitingCustomerConfirmation`, server-issued idempotency key, `approval_request.expires_at`), driven synchronously from `apps/gateway`'s App Router routes. ADR-0005's guarantees hold for *that* FSM. |
| "idempotent resume on any pod" | There is no checkpointed resume in any live path. `approval-service.ts`'s own `executeAndComplete()` doc comment discloses that every Tier-2/3 resume takes the "degraded-equivalent" path (execute + post a fresh message), because no stateful session exists to resume. `agent_run.checkpoint`/`resume_token`/`paused_tool_call_id` columns exist, and `suspendAgentRunForApproval()` exists and is unit-tested, but **nothing in any live code path calls it** — those columns are NULL in production. `agent_run` also has no optimistic-concurrency version column. |
| "an expiry sweeper in `apps/worker` for the A2A `input-required` timeout — which FR-WF-05 itself names as the pattern to follow" | No such job exists. There is no A2A subsystem in this codebase at all. `apps/worker`'s real job registry (`apps/worker/src/index.ts`) is 15 jobs: git-sweep, conversation-idle, audit-sync, mcp-health-check, two retention purges, mcp-manifest-reconcile, two model-gateway jobs, graph-provisioning-reconcile, three knowledge jobs, eval-continuous-run, escalation-sla-sweep. None is an approval or `input-required` expiry sweep. |
| "a delayed BullMQ job is the fast path … the same shape already used for Git PR status and A2A timeouts" | **BullMQ is not a dependency of this workspace.** `apps/worker/src/scheduler.ts` is a plain `setInterval` scheduler whose own doc comment states: "not a new queue dependency (BullMQ/Agenda/etc.): no such library exists anywhere in this workspace yet." The only real precedent named here that exists is Git PR polling (ADR-0009), which is a plain periodic sweep. |
| implied: `apps/runtime` is a deployable that could host a lease-holder | `apps/runtime` has **no Dockerfile**, no `compose.yaml` service, no k8s Deployment, and no CI build-matrix entry. `docs/deployment/DEPLOYMENT.md` is explicit: four images exist (`nextbot-web`, `nextbot-gateway`, `nextbot-worker`, `nextbot-widget-embed`) and "`apps/runtime` … no Dockerfile/manifest was produced … since there is no behavior yet to containerize." |

The **intent** of §2.4 survives all of this intact: do not stand up a second stateful executor
(Temporal/Restate), keep one durable-state model in Postgres, keep the four-plane boundary, add
no new deployable. §3's rejections of a dedicated durable-execution engine and of a separate
`nextbot-workflow` image are unaffected — if anything they are strengthened, since the codebase
has even less appetite for a new stateful component than §2.4 assumed. What fails is only the
mechanism: **Phase 16 cannot reuse machinery that was never built.**

### 7.2 Decision: the executor is a module in `packages/modules/workflows`, hosted by `apps/worker`

Replacing §2.4's consequence table. `apps/runtime` **stays an empty reserved scaffold**; Phase 16
does not populate it.

| Concern | Where it runs (corrected) | What it actually reuses (verified to exist) |
|---|---|---|
| Workflow graph execution, step dispatch, checkpointing | `packages/modules/workflows` — the execution half added beside Phase 15's authoring half (`domain/`, `application/`, `infrastructure/`), **hosted in-process by `apps/worker`** | `@nextbot/db`'s `withTenant()` + RLS; the `knowledge_ingestion_job` durable work-table pattern (below) |
| Claiming and advancing a run | `apps/worker` job `workflow.run-pump` (5s), via the existing `ScheduledJob` contract in `apps/worker/src/scheduler.ts` | `knowledge.ingestion-pump` → `pumpIngestionJobs()` → `claimDueJobs()`: `SELECT … FOR UPDATE SKIP LOCKED`, lease owner + `lease_expires_at`, attempt counter, per-tenant concurrency cap. **This is the real durable-executor precedent in this codebase, and it is QA-approved (Phase 7b).** |
| Reclaiming a crashed executor's run | `apps/worker` job `workflow.lease-reaper` (60s) | `knowledge.lease-reaper` → `reclaimExpiredLeases()`: expired lease → back to claimable. Same idiom, verbatim. |
| Suspension on Human task / Wait | Postgres `workflow_run.checkpoint_json` + `checkpoint_seq` + `workflow_run_step` (LLD §14.6.2, unchanged) | The `tool_call` FSM's CAS-claim-with-expected-state discipline (`claimToolCallTransition`), which is real and battle-tested |
| Timer wake-ups and expiry | `apps/worker` job `workflow.suspension-expiry-sweep` (60s), **plus** the shared approval-expiry sweeper §7.4 requires | `escalation.sla-sweep` (`sweepEscalationSla()`, Phase 13) — a real, shipped, due-date sweep over a tenant-scoped table. This, not the fictional A2A sweeper, is the pattern to copy. |
| Run-level budgets | The executor module | ADR-0012 §2.4's run-budget counters |
| Node execution (Agent / Skill / Tool call / Sub-workflow) | Unchanged — the ADR-0012 Tool Execution Kernel | §2.3 is unaffected by this amendment |
| Traces | Unchanged — existing Runtime Trace viewer | §2.4's last row is unaffected |

**Why `apps/worker` and not `apps/runtime` (the option §2.4 believed it was choosing).**
Populating `apps/runtime` is not "reusing an existing plane"; given the true state above it means
creating a fifth deployable from nothing: a new Dockerfile, a new `compose.yaml` service, a new
k8s Deployment, a new CI build-matrix + Trivy/SBOM entry, and — because §2.4's design has
`apps/worker` *signal* `apps/runtime` — a new inter-process wake-up channel that also does not
exist (there is no BullMQ and no internal RPC transport built). That is precisely the outcome
ADR-0002's multi-container escape hatch requires a documented requirement for, and there is no
such requirement: workflow steps have no independent scaling driver, no independent deploy
cadence, and no distinct resource profile. `apps/worker` is already a built, deployed,
health-checked image running fifteen tenant-scoped jobs, two of which (`knowledge.ingestion-pump`,
`eval.continuous-run`) already perform exactly this class of work — long-running, resumable,
Model-Gateway-calling. **Net new deployables for Phase 16: zero.** That is the property §2.4 was
actually protecting.

**Why a module in `packages/modules/workflows` rather than logic inside `apps/worker/src/`.**
`apps/worker`'s existing files are uniformly thin invocation shims (`escalation-sla-sweep.ts` is
three lines around `sweepEscalationSla()`); every module in this repo keeps its domain and
application logic in `packages/modules/*` so it is testable without the worker process and
relocatable without a rewrite. Phase 16 follows that convention exactly: `apps/worker` gains three
more thin shims (`workflow-run-pump.ts`, `workflow-lease-reaper.ts`,
`workflow-suspension-expiry-sweep.ts`) registered in `startWorker()`; all real logic lives in
`packages/modules/workflows`. This also preserves the property LLD §14.6.2 already stated and
should keep stating: **no executor state lives in a process**, so the host is a deployment fact,
not a schema fact. If a future requirement ever justifies a dedicated executor image, moving the
host is a packaging change, not a redesign — and it would need its own ADR, per §3.

**Three constraints Phase 16 must respect, carried over unchanged:**

1. **No new queue dependency.** There is no BullMQ. §2.4's "delayed BullMQ job is the fast path,
   the reconciling sweep is the correctness path" collapses to just the correctness path: the
   periodic sweep is the *only* path, and it is authoritative. Nothing is lost but wake-up
   latency, bounded by the pump's 5s tick and the expiry sweep's 60s tick — both well inside
   FR-WF-05's semantics, which are about hours and days. Adding a queue library is a §5.4
   dependency-maturity decision Phase 16 must not make unilaterally.
2. **Egress discipline (ADR-0004) is unchanged.** Tool calls dispatched by the executor go
   through the same ADR-0012 kernel and the same `EgressPort` the approval path uses — the
   executor never opens an MCP connection itself. Model calls go through the Model Gateway, as
   `knowledge`'s pipeline and `eval.continuous-run` already do from this same process.
3. **Multi-replica safety.** `apps/worker`'s scheduler has no distributed lock (by design — its
   jobs are idempotent). The workflow executor is the first job in this process for which
   redundant concurrent execution would **not** be harmless, so `workflow_run_lease`
   (LLD §14.6.2) is load-bearing rather than optional: `owner` is the worker instance id, and
   the `INSERT … ON CONFLICT … WHERE expires_at < now()` claim is what makes exactly-one-advancer
   true across replicas. This must be tested against genuinely concurrent claimers, not asserted.

### 7.3 `apps/runtime` and `run-orchestrator` — status corrected, not quietly redefined

`apps/runtime` remains a reserved, empty scaffold with no behavior, no image, and no deployment
artifact. `run-orchestrator` has never existed and is not being created. Every other reference to
`apps/runtime` as a *running* thing elsewhere in the architecture docs (notably LLD §7.4 "Turn
execution (`apps/runtime`)", and the ADR-0003/ADR-0004 narrative) describes intended, unbuilt
architecture: the live turn pipeline is in `apps/gateway`'s App Router
(`app/api/v1/widget/messages/route.ts`, `src/lib/turn-pipeline-adapter.ts`,
`src/lib/whatsapp-inbound.ts`). Correcting that wider doc-vs-reality gap is **out of scope for
this amendment** and is logged for the orchestrator as separate doc debt; it does not block
Phase 16, which after this amendment depends on nothing in `apps/runtime`.

### 7.4 The Tier-2/Tier-3 approval-expiry sweeper is a **prerequisite deliverable inside Phase 16**, not a separate backlog item

`approval-service.ts` has disclosed since it was written that no expiry sweeper exists:

> "Tier-2's 900s timeout (LLD §6.4 default) has no expiry-sweeper this phase … Tier-3's timeout
> below is still recorded on `approval_request.expires_at` even though nothing sweeps it yet, so
> the Approval Queue UI can at least display 'expires in' without lying."

That gap is **not** severable from Phase 16, because §2.3 of this ADR requires a Human-task node
to route into the *existing* Approval Queue ("there is no third queue"). Concretely, a workflow
run suspended on a Human task carries `suspension_ref = 'approval_request:<uuid>'`. If
`workflow.suspension-expiry-sweep` expires the run but nothing expires the underlying
`approval_request`, the result is an incoherent and genuinely unsafe state: an approver sees a
live, actionable Tier-3 request in the queue for a run that has already terminated with a declared
Timeout outcome — and `decideTier3()` would happily CAS `AwaitingHumanApproval → Executing` and
dispatch a real Tier-3 write tool on behalf of a dead run. Two independent expiry mechanisms would
also give two clocks that can disagree about the same suspension. **One mechanism, used by both,
is the only correct outcome.**

Decision, explicitly, so `nexus-dev` does not have to guess:

- **In scope for Phase 16, landed and tested *before* the workflow suspension path is built on
  top of it:** a single `approvals.expiry-sweep` job in `apps/worker` (60s, `escalation-sla-sweep`
  shape), backed by an expiry primitive in `packages/modules/orchestration` that transitions a
  past-due suspended call to the already-existing terminal `Expired` state — CAS from
  `AwaitingHumanApproval`/`AwaitingCustomerConfirmation` only, appending a `tool_call_event` and a
  domain event, and setting `approval_request.status = 'Expired'` in the same transaction.
- **Tier-2 needs its deadline persisted.** `tool_call.expires_at` already exists in the schema and
  is nullable; `createSuspendedToolCall()` currently never writes it. Phase 16 stamps it for both
  tiers at suspension time (Tier-2: LLD §6.4's 900s default; Tier-3: the existing
  `TIER3_TIMEOUT_MS`, kept consistent with `approval_request.expires_at`). **No migration is
  required** — this is a designed-but-unwritten column, which is itself evidence this was always
  intended scope rather than new scope.
- **The read side already exists.** `decideTier2()`/`decideTier3()` already check
  `existing.status === 'Expired'` and throw `ApprovalExpiredError`. Today that branch is
  unreachable because nothing ever produces the state. This work makes shipped, already-tested
  code reachable; it does not invent semantics.
- **`workflow.suspension-expiry-sweep` delegates to that same primitive** for
  `suspension_kind = 'HumanTask'`, transitioning the `approval_request`/`tool_call` and the
  `workflow_run` together in one transaction, so the two can never disagree. Wait-node and
  Sub-workflow suspensions have no approval row and use the run-only path.
- **Retroactive by construction:** because the sweep operates on `expires_at` over all suspended
  calls, it closes the original Tier-2/Tier-3 gap for ordinary (non-workflow) conversations at the
  same time, with no separate code path. That is the cleanest outcome and the reason this is not
  being deferred to its own backlog item.
- **Not in scope:** changing tier semantics, changing the Approval Queue UI beyond whatever an
  `Expired` row already renders as, or retro-expiring rows that predate the change (the sweep will
  simply act on them on its first tick, which is correct — they are genuinely past due).

### 7.5 Consequences of this amendment

**Positive.** Phase 16 is now buildable against machinery that demonstrably exists and is
QA-approved (`knowledge_ingestion_job`'s claim/lease/reclaim trio, `escalation.sla-sweep`'s
due-date sweep, the `tool_call` CAS FSM). Still zero new deployables and zero new stateful
dependencies — §2.4's actual goal. A four-year-old class of latent bug (an approval that can be
acted on after its own deadline) is closed as a side effect.

**Negative / accepted.**

- `apps/worker` becomes the process that hosts genuinely correctness-critical concurrent work,
  where previously every job was idempotent-and-therefore-race-tolerant. This is why §7.2
  constraint 3 makes `workflow_run_lease` mandatory and its concurrency testing explicit.
- Wake-up latency is now bounded by a polling tick (5s pump / 60s expiry) with no
  delayed-job fast path. Accepted: FR-WF-05's semantics are hours-to-days.
- Phase 16 carries a prerequisite it did not originally plan for (§7.4). Accepted: it is small
  (one job, one primitive, one column write, no migration), it unblocks correctness rather than
  adding features, and deferring it would ship a known-unsafe interaction between the workflow
  executor and the Approval Queue.
- The wider `apps/runtime` doc-vs-reality gap (§7.3) remains open as tracked doc debt.

### 7.6 Verification (replaces §6 item 4's `apps/runtime` wording, adds two)

4′. **Durability test:** suspend a run on a Human task, restart the whole `apps/worker` fleet,
resume on a different worker replica, and assert exactly-once step execution via the idempotency
claim and `workflow_run_lease`.

8. **Concurrent-claim test:** N genuinely concurrent worker replicas pump the same `Pending` run;
exactly one acquires the lease and advances it; the losers no-op. Kill the lease holder mid-step
and assert `workflow.lease-reaper` makes the run claimable again after the TTL and that the
re-executed node is idempotent.

9. **Approval-expiry test (§7.4):** (a) a Tier-3 `approval_request` past `expires_at` is swept to
`Expired` and a subsequent `decideTier3()` throws `ApprovalExpiredError`; (b) a Tier-2 call past
its 900s deadline is swept identically; (c) a workflow run suspended on a Human task past its
deadline transitions the run to its declared `suspension_expiry_outcome` **and** its
`approval_request`/`tool_call` to `Expired` in the same transaction, with no window in which the
queue shows an actionable request for a terminated run.

### 7.7 Documents changed by this amendment

- This file: header status note, the §2.4 correction banner, and this §7.
- `docs/architecture/LLD.md` §14.6.2 — the "Where the lease-holder runs" block and the
  "Suspension and expiry" paragraph, marked as a dated correction, not silently rewritten. The
  `workflow_run` / `workflow_run_lease` / `workflow_run_step` tables, `WorkflowCheckpointSchema`,
  the resume protocol, and §14.6.4 are **unchanged** — only the host and the timer mechanism
  changed.
- Not changed: Phase 15's shipped authoring schema (`workflow`, `workflow_version`, the graph
  validator, the promotion policy), which is correct and final regardless of where the executor
  lives.
