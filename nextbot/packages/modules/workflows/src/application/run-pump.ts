import { listActiveTenantContexts } from "@nextbot/tenancy";
import type { TenantContext } from "@nextbot/db";
import type { WorkflowCheckpoint } from "@nextbot/contracts";
import { parseCheckpoint, setResumeMarker } from "../domain/checkpoint.js";
import { toJsonValue } from "../domain/expression.js";
import {
  findLatestStepForNode,
  finalizeStep,
  listExpiredSuspendedRuns,
  listSuspendedRuns,
  listTerminalChildRuns,
  resumeSuspendedRun,
  scanClaimableRuns,
  type WorkflowRunRow,
} from "../infrastructure/workflow-run-repository.js";
import { reclaimExpiredRunLeases } from "../infrastructure/workflow-run-lease-repository.js";
import { executeRun, newWorkerInstanceId, resumeParentOnChildTerminal, seedFrontier, terminateRunWithOutcome } from "./run-executor.js";
import { getWorkflowVersion } from "../infrastructure/workflow-repository.js";
import { persistNodeAdvance } from "../infrastructure/workflow-run-repository.js";
import type { WorkflowNodeRuntime } from "../ports/node-runtime.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, LLD §14.6.2's corrected job table,
 * ADR-0013 §7.2) — the bodies of the three `apps/worker` jobs that drive the workflow
 * executor.
 *
 * **These are cross-tenant sweeps that loop `listActiveTenantContexts()` themselves**,
 * exactly like `escalation.sla-sweep` (`sweepEscalationSla()`, Phase 13) and
 * `knowledge.ingestion-pump` (`pumpIngestionJobs()`, Phase 7b) — the two real,
 * QA-approved precedents in this codebase. `apps/worker` gets thin three-line shims
 * around them; no orchestration logic lives in the app.
 *
 * **There is no delayed-job fast path, and none is needed.** ADR-0013 §7.2 constraint 1:
 * no queue library exists in this workspace, so "the periodic sweep is the *only* path,
 * and it is authoritative. Nothing is lost but wake-up latency, bounded by the pump's 5s
 * tick and the expiry sweep's 60s tick — both well inside FR-WF-05's semantics, which
 * are about hours and days." The superseded LLD text's BullMQ-delayed-job optimization
 * is deliberately not built and not referenced.
 */

export interface WorkflowPumpDeps {
  /** A FACTORY, not a single runtime: every adapter is tenant-scoped (it closes over a
   *  `TenantContext` so `withTenant`'s RLS holds for every read and write it makes), and
   *  these sweeps iterate every active tenant. Handing the pump one pre-built runtime
   *  would silently execute tenant B's runs against tenant A's context — the exact
   *  cross-tenant leak RLS exists to prevent. */
  runtimeFor: (ctx: TenantContext) => WorkflowNodeRuntime;
  /** Overridable so a test can drive two distinct "worker replicas" in one process. */
  owner?: string;
  /** Runs claimed per tenant per tick. Bounded so one busy tenant cannot starve the
   *  rest — the same fairness reasoning as `knowledge.ingestion-pump`'s
   *  `maxConcurrentPerTenant`. */
  maxRunsPerTenant?: number;
  /** Restricts the pass to specific tenants. Absent (the scheduled job's own usage) means
   *  every active tenant.
   *
   *  Two real uses: targeted operational reprocessing of one tenant after an incident,
   *  and test isolation — a cross-tenant sweep would otherwise claim and advance runs
   *  belonging to a concurrently-running suite, using THAT suite's node runtime, which is
   *  both non-deterministic and genuinely wrong. */
  tenantIds?: string[];
}

/** Narrows a cross-tenant sweep to an explicit tenant set. See `WorkflowPumpDeps.tenantIds`
 *  for why this exists; `undefined` keeps the scheduled job's every-active-tenant
 *  behaviour, which is what `apps/worker`'s shims pass. */
function scopeTenants(tenants: TenantContext[], tenantIds: string[] | undefined): TenantContext[] {
  if (!tenantIds) return tenants;
  const wanted = new Set(tenantIds);
  return tenants.filter((t) => wanted.has(t.tenantId));
}

export interface WorkflowPumpResult {
  tenantsChecked: number;
  /** Suspended runs whose condition had resolved and which were returned to `Running`. */
  reconciled: number;
  claimed: number;
  nodesExecuted: number;
}

/**
 * `workflow.run-pump` (5s) — **this job executes**.
 *
 * ADR-0013 §7's correction is explicit that this is not a discovery-and-signal path:
 * "It claims and advances runs itself; it is not a discovery-and-signal path, because
 * there is no second process to signal." Each tick does two things per tenant:
 *
 *  1. **Reconcile suspensions.** With no queue, this scan IS the wake-up path and is
 *     authoritative. A suspended run whose approval was decided, whose escalation was
 *     closed, whose timer elapsed, or whose child run finished is returned to `Running`
 *     with the resolved result parked as the waiting node's resume marker.
 *  2. **Claim and advance.** `FOR UPDATE SKIP LOCKED` to scan, then the
 *     `workflow_run_lease` claim to actually own the run across the many transactions
 *     one pass spans.
 *
 * Reconciliation runs FIRST so a run whose condition resolved between ticks is advanced
 * in the same tick it is woken, rather than waiting a further 5s.
 */
export async function pumpWorkflowRuns(deps: WorkflowPumpDeps): Promise<WorkflowPumpResult> {
  const owner = deps.owner ?? newWorkerInstanceId();
  const maxRunsPerTenant = deps.maxRunsPerTenant ?? 10;
  const tenants = scopeTenants(await listActiveTenantContexts(), deps.tenantIds);
  let reconciled = 0;
  let claimed = 0;
  let nodesExecuted = 0;

  for (const ctx of tenants) {
    // One tenant's failure must never abort the tick for every other tenant — the same
    // per-tenant isolation convention every other `apps/worker` sweep follows.
    try {
      const runtime = deps.runtimeFor(ctx);
      reconciled += await reconcileSuspendedRuns(ctx, runtime);

      const candidates = await scanClaimableRuns(ctx, maxRunsPerTenant);
      for (const candidate of candidates) {
        const run = await ensureFrontierSeeded(ctx, candidate);
        const result = await executeRun(ctx, { runtime, owner }, run);
        if (result.claimed) claimed += 1;
        nodesExecuted += result.nodesExecuted;
      }
    } catch (err) {
      console.error(`NextBot worker: workflow run pump failed for tenant "${ctx.tenantId}"`, err);
    }
  }

  return { tenantsChecked: tenants.length, reconciled, claimed, nodesExecuted };
}

/**
 * Seeds a brand-new run's frontier with its `Trigger` node.
 *
 * Done here, on first claim, rather than at creation time: run creation stays a pure
 * insert (so the sandbox-run and webhook endpoints do not each need to load and parse a
 * graph), and the graph is loaded exactly once by the executor that is about to use it.
 * A run whose frontier is already seeded passes through untouched.
 */
async function ensureFrontierSeeded(ctx: TenantContext, run: WorkflowRunRow): Promise<WorkflowRunRow> {
  const checkpoint = parseCheckpoint(run.checkpointJson);
  if (checkpoint.frontier.length > 0) return run;

  const version = await getWorkflowVersion(ctx, run.workflowVersionId);
  const seeded = seedFrontier(version.graphJson, checkpoint);
  if (seeded.frontier.length === 0) return run;

  // Written through the same optimistic-concurrency persist every other advance uses,
  // with no step row: seeding is a position change, not an executed node, and inventing
  // a step row for it would put a node in the FR-WF-07 trace that never ran.
  return persistNodeAdvance(
    ctx,
    run.id,
    run.checkpointSeq,
    { state: run.state === "Pending" ? "Pending" : run.state, checkpoint: seeded, costUsd: run.costUsd, stepsExecuted: run.stepsExecuted },
    null,
  );
}

// ---------------------------------------------------------------------------
// Suspension reconciliation — the authoritative wake-up path
// ---------------------------------------------------------------------------

/**
 * Checks every `Suspended` run's condition and wakes the ones that have resolved.
 *
 * Each suspension kind's condition is read from the SYSTEM THAT OWNS IT — `tool_call`
 * via `orchestration`, `escalation` via `escalations`, the child `workflow_run` via this
 * module — never from a second copy this module maintains. That is what keeps a
 * workflow's view of an approval and the Approval Queue's own view from ever diverging.
 *
 * @returns how many runs were woken this pass.
 */
export async function reconcileSuspendedRuns(ctx: TenantContext, runtime: WorkflowNodeRuntime): Promise<number> {
  const suspended = await listSuspendedRuns(ctx);
  let woken = 0;

  for (const run of suspended) {
    try {
      const resolution = await resolveSuspension(ctx, runtime, run);
      if (!resolution) continue;

      const checkpoint = parseCheckpoint(run.checkpointJson);
      const entry = checkpoint.frontier[0];
      if (!entry) continue;

      const next = setResumeMarker(checkpoint, entry.nodeId, entry.iteration, toJsonValue(resolution.result));
      const { resumed } = await resumeSuspendedRun(ctx, run.id, next);
      if (!resumed) continue;
      woken += 1;

      // The step row written when the node suspended is still `Suspended`; close it out
      // with the real outcome so the FR-WF-07 trace shows what the human/timer/child
      // actually decided rather than leaving a permanently-pending step.
      const step = await findLatestStepForNode(ctx, run.id, entry.nodeId);
      if (step && step.status === "Suspended") await finalizeStep(ctx, step.id, "Succeeded", { output: resolution.result });
    } catch (err) {
      console.error(`NextBot worker: workflow suspension reconciliation failed for run "${run.id}"`, err);
    }
  }

  return woken;
}

/**
 * Resolves the `tool_call.id` behind an `Approval` suspension.
 *
 * `suspension_ref` carries `approval_request:<uuid>` — the APPROVAL REQUEST's id, exactly
 * as LLD §14.6.2/§14.6.4 specify, because that is the identifier an operator reading the
 * run row would look up in the Approval Queue. But the `tool_call` is the row that
 * actually holds the FSM (and is the row `orchestration`'s shared expiry primitive
 * operates on, and the only row a Tier-2 suspension has at all).
 *
 * Rather than overload `suspension_ref` with a second meaning, the tool-call id is read
 * from the step the node already wrote when it suspended — `workflow_run_step.
 * tool_call_id`, which is written in the SAME transaction as the suspension itself and
 * is indexed (`workflow_run_step_tenant_tool_call_idx`). So the two identifiers each stay
 * in the column that means what it says.
 */
async function approvalToolCallId(ctx: TenantContext, run: WorkflowRunRow): Promise<string | null> {
  const nodeId = parseCheckpoint(run.checkpointJson).frontier[0]?.nodeId ?? run.currentNodeIds[0];
  if (!nodeId) return null;
  const step = await findLatestStepForNode(ctx, run.id, nodeId);
  return step?.toolCallId ?? null;
}

/** The resolved result for a suspension, or `null` when it is still genuinely waiting. */
async function resolveSuspension(ctx: TenantContext, runtime: WorkflowNodeRuntime, run: WorkflowRunRow): Promise<{ result: Record<string, unknown> } | null> {
  const ref = run.suspensionRef ?? "";

  if (run.suspensionKind === "Approval") {
    if (!ref.startsWith("approval_request:")) return null;
    const toolCallId = await approvalToolCallId(ctx, run);
    if (!toolCallId) return null;
    const call = await runtime.tools.readToolCallOutcome(toolCallId);
    if (!call) return null;
    // Still with the human. `MoreInfoRequested` self-loops back to
    // `AwaitingHumanApproval` (LLD §6.5), so it is correctly still "waiting" here.
    if (call.status === "AwaitingHumanApproval" || call.status === "AwaitingCustomerConfirmation" || call.status === "Executing") return null;
    return { result: { status: call.status, output: call.output ?? null, errorMessage: call.errorMessage } };
  }

  if (run.suspensionKind === "HumanTask") {
    const escalationId = ref.startsWith("escalation:") ? ref.slice("escalation:".length) : null;
    if (!escalationId) return null;
    const status = await runtime.escalations.readEscalationStatus(escalationId);
    if (!status || status === "Waiting" || status === "InProgress") return null;
    return { result: { status, escalationId } };
  }

  if (run.suspensionKind === "Wait") {
    // A timer resolves when its instant passes. An `event:` ref has no delivery surface
    // in LLD §14.6.5's endpoint list (disclosed in `executeWait`'s own doc), so it never
    // resolves early and correctly reaches its declared `onTimeout` via the expiry sweep.
    if (!ref.startsWith("timer:")) return null;
    const fireAt = new Date(ref.slice("timer:".length));
    if (Number.isNaN(fireAt.getTime()) || fireAt.getTime() > Date.now()) return null;
    return { result: { waited: true, firedAt: new Date().toISOString() } };
  }

  if (run.suspensionKind === "SubWorkflow") {
    const childId = ref.startsWith("workflow_run:") ? ref.slice("workflow_run:".length) : null;
    if (!childId) return null;
    const children = await listTerminalChildRuns(ctx, run.id);
    const child = children.find((c) => c.id === childId);
    if (!child) return null;
    return { result: { runId: child.id, state: child.state, outcome: child.outcome, variables: parseCheckpoint(child.checkpointJson).variables } };
  }

  return null;
}

// ---------------------------------------------------------------------------
// workflow.lease-reaper
// ---------------------------------------------------------------------------

export interface WorkflowLeaseReaperResult {
  tenantsChecked: number;
  reclaimed: number;
}

/**
 * `workflow.lease-reaper` (60s) — modelled verbatim on `knowledge.lease-reaper` /
 * `reclaimExpiredLeases()`.
 *
 * **Not the mechanism that makes reclaim correct.** `acquireRunLease`'s own
 * `ON CONFLICT … WHERE expires_at < now()` already lets a new claimer take over an
 * expired lease with no reaper having run, which is what keeps crash recovery working
 * even if this job is stopped. The reaper exists so an abandoned lease does not linger
 * as a row an operator would read as "someone is working on this", and so the table does
 * not accumulate dead rows for runs that finished under a different owner.
 */
export async function reapWorkflowRunLeases(tenantIds?: string[]): Promise<WorkflowLeaseReaperResult> {
  const tenants = scopeTenants(await listActiveTenantContexts(), tenantIds);
  let reclaimed = 0;
  for (const ctx of tenants) {
    try {
      reclaimed += await reclaimExpiredRunLeases(ctx);
    } catch (err) {
      console.error(`NextBot worker: workflow lease reaper failed for tenant "${ctx.tenantId}"`, err);
    }
  }
  return { tenantsChecked: tenants.length, reclaimed };
}

// ---------------------------------------------------------------------------
// workflow.suspension-expiry-sweep
// ---------------------------------------------------------------------------

export interface WorkflowSuspensionExpiryResult {
  tenantsChecked: number;
  expired: number;
  /** Approval Queue rows expired alongside their run, through `orchestration`'s SHARED
   *  primitive (ADR-0013 §7.4). */
  approvalsExpired: number;
}

/**
 * `workflow.suspension-expiry-sweep` (60s) — transitions any
 * `state='Suspended' AND suspension_expires_at < now()` run to its **declared**
 * `suspension_expiry_outcome` (FR-WF-05: "a run never remains suspended indefinitely").
 * Modelled on `escalation.sla-sweep`, the real shipped due-date sweep in this repo.
 *
 * **The ADR-0013 §7.4 hazard, and how the ordering closes it.** A run suspended on a
 * Tier-3 approval carries `suspension_ref = 'approval_request:<uuid>'`. If the run
 * expired but the approval did not, an approver would see a live, actionable Tier-3
 * request for a run that has already terminated — and `decideTier3()` would CAS it to
 * `Executing` and dispatch a real write tool on a dead run's behalf.
 *
 * ADR-0013 §7.4 asks for both rows to transition "in one transaction". A transaction
 * spanning `orchestration`'s `tool_call`/`approval_request` writes and this module's
 * `workflow_run` write would require `orchestration` to hand its transaction client
 * across a module seam, breaking the boundary that same ADR protects. **Disclosed
 * deviation, argued:** the approval is expired FIRST and the run terminated SECOND, and
 * both halves are idempotent. That ordering makes the *unsafe* direction — an actionable
 * queue row for a terminated run — structurally unreachable, and leaves only the *safe*
 * direction (approval `Expired`, run still `Suspended`) as a possible interleaving,
 * which self-heals on the very next tick and in which `decideTier3()` already throws
 * `ApprovalExpiredError`. `approval-expiry-hazard.int.test.ts` asserts exactly this.
 *
 * The expiry itself goes through `orchestration`'s SHARED primitive, so this module
 * never writes `tool_call` and there is exactly one clock governing both rows.
 */
export async function sweepWorkflowSuspensionExpiry(
  runtimeFor: (ctx: TenantContext) => WorkflowNodeRuntime,
  asOf: Date = new Date(),
  tenantIds?: string[],
): Promise<WorkflowSuspensionExpiryResult> {
  const tenants = scopeTenants(await listActiveTenantContexts(), tenantIds);
  let expired = 0;
  let approvalsExpired = 0;

  for (const ctx of tenants) {
    try {
      const runtime = runtimeFor(ctx);
      const due = await listExpiredSuspendedRuns(ctx, asOf);
      for (const run of due) {
        // STEP 1 — the approval, so the queue can never be actionable for a run this
        // sweep is about to terminate. Goes through `orchestration`'s SHARED expiry
        // primitive, never a `tool_call` write of this module's own.
        if (run.suspensionKind === "Approval" && run.suspensionRef?.startsWith("approval_request:")) {
          const toolCallId = await approvalToolCallId(ctx, run);
          if (toolCallId) {
            const result = await runtime.tools.expireToolCall(toolCallId);
            if (result.expired) approvalsExpired += 1;
          }
        }

        // STEP 2 — the run, at its DECLARED outcome. `suspension_expiry_outcome` is NOT
        // NULL for every suspended run (`workflow_run_suspension_consistent`), so this
        // is always an authored decision, never a default this sweep invented; the
        // `?? "Timeout"` is unreachable defense in depth against a row that predates the
        // constraint.
        const outcome = run.suspensionExpiryOutcome ?? "Timeout";
        const terminated = await terminateRunWithOutcome(ctx, { runtime, owner: "suspension-expiry-sweep" }, run.id, ["Suspended"], outcome, {
          reason: "SUSPENSION_EXPIRED",
          suspensionKind: run.suspensionKind,
          suspensionRef: run.suspensionRef,
          expiredAt: asOf.toISOString(),
          message: "This run's suspension passed its declared deadline.",
        });
        if (terminated) expired += 1;
      }
    } catch (err) {
      console.error(`NextBot worker: workflow suspension expiry sweep failed for tenant "${ctx.tenantId}"`, err);
    }
  }

  return { tenantsChecked: tenants.length, expired, approvalsExpired };
}

/** Re-exported so `run-executor.ts`'s terminal path and the pump's reconciliation share
 *  one definition of "what a finished child does to its parent". */
export { resumeParentOnChildTerminal };

/** Exposed for tests that need to drive one tenant's reconciliation deterministically
 *  rather than through the cross-tenant sweep. */
export type { WorkflowCheckpoint };
