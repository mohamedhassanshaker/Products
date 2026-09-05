import type { TenantContext } from "@nextbot/db";
import {
  WorkflowRunCheckpointConflictError,
  type WorkflowCheckpoint,
  type WorkflowGraph,
  type WorkflowRunLimits,
  type WorkflowRunTerminalOutcomeValue,
} from "@nextbot/contracts";
import { addConsumption, parseCheckpoint, popCompensation, replaceFrontierEntry, setResumeMarker, withVariable } from "../domain/checkpoint.js";
import { toJsonValue } from "../domain/expression.js";
import { compensationIdempotencyKey } from "../domain/idempotency.js";
import { BUDGET_BREACH_MESSAGES, checkRunBudget } from "../domain/run-budget.js";
import { stateForOutcome } from "../domain/run-fsm.js";
import { getWorkflowVersion } from "../infrastructure/workflow-repository.js";
import {
  createWorkflowRun,
  findWorkflowRunById,
  persistNodeAdvance,
  resumeSuspendedRun,
  terminateRun,
  type RunAdvance,
  type StepRecord,
  type WorkflowRunRow,
} from "../infrastructure/workflow-run-repository.js";
import { LEASE_RENEW_INTERVAL_SECONDS, acquireRunLease, releaseRunLease, renewRunLease } from "../infrastructure/workflow-run-lease-repository.js";
import { budgetTerminationOutcome, executeNode, findNode, type NodeOutcome } from "./node-executors.js";
import type { WorkflowNodeRuntime } from "../ports/node-runtime.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, FR-WF-05/06, LLD §14.6.2) — **the
 * resume protocol**, exactly as the LLD states it:
 *
 * > acquire lease -> reload `workflow_run` + `checkpoint_json` -> for each frontier
 * > entry, execute one node -> persist `{state, current_node_ids, checkpoint_json,
 * > checkpoint_seq+1, cost_usd, steps_executed}` **in one transaction with the
 * > `workflow_run_step` row** -> release or renew the lease.
 *
 * Placement authority: **ADR-0013 §7** — this module is hosted in-process by
 * `apps/worker`'s `workflow.run-pump` job, not by a `run-orchestrator` in
 * `apps/runtime` (which has never existed). The protocol itself is unchanged by that
 * correction, which is precisely the property the store-and-lease design exists to give.
 *
 * **The crash-safety argument, stated once, here.** A node is never executed without a
 * preceding checkpoint write recording the intent to execute it — that write is the
 * *previous* node's persist, which moved the frontier onto this node. So the durable
 * state at the instant any node begins already says "this run is at node X". A crash
 * anywhere inside node X therefore leaves the frontier still on X, and the resume
 * re-executes **exactly X** and nothing else: at most one node re-executes. That is safe
 * because every write-classified node carries an idempotency key that is a pure function
 * of `(runId, nodeId, iteration)` and the args — see `domain/idempotency.ts`, which
 * exists specifically so a retry produces the SAME key rather than a fresh one.
 *
 * `workflow-crash-resume.int.test.ts` asserts that property against the real downstream
 * side effect, not against the key having been passed.
 */

/** How many nodes one executor pass will advance a single run through before yielding.
 *  Bounded so one long graph cannot monopolize a pump tick and starve every other run
 *  in the tenant — the same fairness reasoning `knowledge.ingestion-pump`'s
 *  `maxConcurrentPerTenant` embodies. */
const MAX_NODES_PER_PASS = 25;

export interface ExecuteRunDeps {
  runtime: WorkflowNodeRuntime;
  /** This worker instance's id — becomes `workflow_run_lease.owner`. */
  owner: string;
}

export interface ExecuteRunResult {
  runId: string;
  /** `false` when another executor held the lease. The correct, expected outcome for
   *  every losing replica — not an error. */
  claimed: boolean;
  nodesExecuted: number;
  finalState: string;
}

/**
 * Advances ONE run as far as it can go in a single pass.
 *
 * @param ctx tenant context.
 * @param deps the node runtime and this worker's instance id.
 * @param run the run row as the pump scanned it. Deliberately re-read after the lease is
 *   acquired rather than trusted: between the scan and the claim, another executor may
 *   have advanced it, and acting on the scanned view would write against a stale
 *   `checkpoint_seq`.
 * @returns what happened, for the pump's own log line. Never throws for a run-level
 *   problem — a failing run terminates itself; a lost lease or a checkpoint conflict
 *   ends the pass quietly, because both mean "someone else owns this now".
 */
export async function executeRun(ctx: TenantContext, deps: ExecuteRunDeps, run: WorkflowRunRow): Promise<ExecuteRunResult> {
  const claimed = await acquireRunLease(ctx, run.id, deps.owner, run.checkpointSeq);
  if (!claimed) return { runId: run.id, claimed: false, nodesExecuted: 0, finalState: run.state };

  let nodesExecuted = 0;
  let current = run;
  try {
    // Re-read under the lease. This is the "reload `workflow_run` + `checkpoint_json`"
    // half of the protocol and it is not redundant with the pump's scan: the scan is
    // lock-free by design (`SKIP LOCKED`), so its view can already be stale by the time
    // the claim lands.
    const reloaded = await reloadRun(ctx, run.id);
    if (!reloaded) return { runId: run.id, claimed: true, nodesExecuted: 0, finalState: run.state };
    current = reloaded;

    const version = await getWorkflowVersion(ctx, current.workflowVersionId);
    const graph = version.graphJson;
    const limits = version.runLimits;

    let lastRenewAt = Date.now();
    while (nodesExecuted < MAX_NODES_PER_PASS) {
      // A run that left `Running`/`Pending`/`Compensating` during this pass (it
      // suspended, terminated, or was cancelled by an operator) is done for now.
      if (current.state !== "Running" && current.state !== "Pending" && current.state !== "Compensating") break;

      // LLD's "renewed every 20s while a step runs". A failed renewal means this
      // executor's lease expired and was taken over — it must stop immediately rather
      // than persist against a run it no longer owns.
      if (Date.now() - lastRenewAt > LEASE_RENEW_INTERVAL_SECONDS * 1000) {
        if (!(await renewRunLease(ctx, current.id, deps.owner))) break;
        lastRenewAt = Date.now();
      }

      const advanced = current.state === "Compensating" ? await compensateOnce(ctx, deps, current) : await advanceOnce(ctx, deps, current, graph, limits);
      if (!advanced) break;
      current = advanced;
      nodesExecuted += 1;
    }
  } catch (err) {
    if (!(err instanceof WorkflowRunCheckpointConflictError)) throw err;
    // The run moved on under a different owner. Abandoning the pass is the ONLY correct
    // response: retrying against a moved target is exactly how a duplicate step row gets
    // written. The next pump tick re-claims from the true state.
  } finally {
    await releaseRunLease(ctx, run.id, deps.owner);
  }

  return { runId: run.id, claimed: true, nodesExecuted, finalState: current.state };
}

async function reloadRun(ctx: TenantContext, runId: string): Promise<WorkflowRunRow | null> {
  return findWorkflowRunById(ctx, runId);
}

/**
 * Executes ONE node from the frontier and persists the result.
 *
 * @returns the run row as it now stands, or `null` when there is nothing left to do
 *   (an empty frontier, or a terminal/suspended state).
 */
async function advanceOnce(
  ctx: TenantContext,
  deps: ExecuteRunDeps,
  run: WorkflowRunRow,
  graph: WorkflowGraph,
  limits: WorkflowRunLimits,
): Promise<WorkflowRunRow | null> {
  const checkpoint = parseCheckpoint(run.checkpointJson);
  const entry = checkpoint.frontier[0];

  if (!entry) {
    // An empty frontier with no End node reached means every branch ended without a
    // terminal outcome. V3 makes this unreachable for a saved graph ("every path from
    // Trigger reaches an End"), so it is a defect path — terminated loudly at `Failed`
    // rather than left `Running` forever, which would wedge the pump on this run.
    const { run: terminated } = await terminateRun(ctx, run.id, ["Running", "Pending"], "Failed", "Failed", {
      code: "WORKFLOW_FRONTIER_EXHAUSTED",
      message: "Every branch of this run ended without reaching an End node.",
    });
    return terminated;
  }

  const elapsedSeconds = (Date.now() - run.startedAt.getTime()) / 1000;

  // FR-WF-06: checked before EVERY node, not at pass boundaries, so a single expensive
  // node cannot carry a run arbitrarily past its ceiling.
  const budget = checkRunBudget(limits, checkpoint, elapsedSeconds);
  if (!budget.ok) {
    const node = findNode(graph, entry.nodeId);
    const outcome = budgetTerminationOutcome(
      checkpoint,
      {
        nodeId: entry.nodeId,
        nodeKind: node?.kind ?? "End",
        iteration: entry.iteration,
        branchKey: entry.branchKey,
        refKind: "None",
        startedAt: new Date(),
        endedAt: new Date(),
      },
      { ...budget, message: BUDGET_BREACH_MESSAGES[budget.reason] },
      entry.nodeId,
    );
    return persistOutcome(ctx, deps, run, checkpoint, entry, outcome, elapsedSeconds);
  }

  const outcome = await executeNode({
    runId: run.id,
    agentRunId: run.agentRunId,
    conversationId: run.conversationId,
    graph,
    limits,
    checkpoint,
    entry,
    depth: run.depth,
    runtime: deps.runtime,
  });

  return persistOutcome(ctx, deps, run, checkpoint, entry, outcome, elapsedSeconds);
}

/** Applies a `NodeOutcome` to the durable run, in the one transaction the resume
 *  protocol requires. Every branch below ends in exactly one `persistNodeAdvance` call,
 *  so there is no path that writes a step row without also moving the checkpoint (or
 *  vice versa). */
async function persistOutcome(
  ctx: TenantContext,
  deps: ExecuteRunDeps,
  run: WorkflowRunRow,
  checkpoint: WorkflowCheckpoint,
  entry: WorkflowCheckpoint["frontier"][number],
  outcome: NodeOutcome,
  elapsedSeconds: number,
): Promise<WorkflowRunRow | null> {
  const cost = (Number(run.costUsd) + outcome.costUsd).toFixed(8);
  const steps = run.stepsExecuted + 1;

  const consumed = (next: WorkflowCheckpoint): WorkflowCheckpoint => addConsumption(next, { usd: outcome.costUsd, steps: 1, elapsedSeconds });

  if (outcome.kind === "Advance") {
    const next = consumed(replaceFrontierEntry(outcome.checkpoint, entry, outcome.successors));
    return persistNodeAdvance(ctx, run.id, run.checkpointSeq, { state: "Running", checkpoint: next, costUsd: cost, stepsExecuted: steps }, outcome.step);
  }

  if (outcome.kind === "Suspend") {
    // The frontier is left POINTING AT THE SUSPENDED NODE, deliberately. When the
    // reconciling pump resumes the run it re-executes that node — which is safe for
    // every suspending kind (a resolved approval short-circuits to its recorded result,
    // an elapsed timer falls through) and means the suspension's own step row and the
    // resume share one frontier position rather than needing a second "resume node"
    // concept.
    const next = consumed(outcome.checkpoint);
    return persistNodeAdvance(
      ctx,
      run.id,
      run.checkpointSeq,
      {
        state: "Suspended",
        checkpoint: next,
        costUsd: cost,
        stepsExecuted: steps,
        suspensionKind: outcome.suspension.kind,
        suspensionRef: outcome.suspension.ref,
        suspensionExpiresAt: outcome.suspension.expiresAt,
        suspensionExpiryOutcome: outcome.suspension.expiryOutcome,
      },
      outcome.step,
    );
  }

  if (outcome.kind === "SpawnChild") {
    const child = await createWorkflowRun(ctx, {
      workflowVersionId: outcome.child.workflowVersionId,
      conversationId: run.conversationId,
      agentRunId: run.agentRunId,
      triggerKind: "SubWorkflow",
      parentRunId: run.id,
      depth: run.depth + 1,
      // The child's checkpoint is seeded with the mapped input and an EMPTY frontier;
      // the pump seeds its Trigger on first claim, exactly as it does for a top-level
      // run — so a sub-workflow is not a special kind of run, just a run with a parent.
      checkpoint: { variables: outcome.child.input, frontier: [], joinBarriers: {}, loopCounters: {}, compensations: [], consumed: { usd: 0, seconds: 0, steps: 0 } },
      scopeHash: run.scopeHash,
      otelTraceId: run.otelTraceId,
      // Deterministic, so a re-executed SubWorkflow node after a crash resumes the SAME
      // child rather than spawning a second one — the run-level equivalent of a write
      // node's idempotency key.
      idempotencyKey: `subworkflow:${run.id}:${outcome.step.nodeId}:${entry.iteration}`,
    });

    const next = consumed(withVariable(outcome.checkpoint, `${outcome.step.nodeId}_child_run_id`, child.run.id));
    return persistNodeAdvance(
      ctx,
      run.id,
      run.checkpointSeq,
      {
        state: "Suspended",
        checkpoint: next,
        costUsd: cost,
        stepsExecuted: steps,
        suspensionKind: "SubWorkflow",
        suspensionRef: `workflow_run:${child.run.id}`,
        suspensionExpiresAt: outcome.suspensionExpiresAt,
        suspensionExpiryOutcome: outcome.suspensionExpiryOutcome,
      },
      { ...outcome.step, childRunId: child.run.id },
    );
  }

  if (outcome.kind === "Compensate") {
    // FR-WF-04. With nothing on the stack there is nothing to unwind, so this collapses
    // straight to a terminal `Failed` rather than entering a state that would
    // immediately exit — a `Compensating` run with an empty stack would otherwise be a
    // confusing, momentarily-visible state in the Runs list.
    if (outcome.checkpoint.compensations.length === 0) {
      return persistNodeAdvance(
        ctx,
        run.id,
        run.checkpointSeq,
        { state: "Failed", checkpoint: consumed(outcome.checkpoint), costUsd: cost, stepsExecuted: steps, outcome: "Failed", outcomeDetail: outcome.detail, endedAt: new Date() },
        outcome.step,
      );
    }
    return persistNodeAdvance(
      ctx,
      run.id,
      run.checkpointSeq,
      { state: "Compensating", checkpoint: consumed(outcome.checkpoint), costUsd: cost, stepsExecuted: steps },
      outcome.step,
    );
  }

  // Terminate.
  const terminalState = stateForOutcome(outcome.outcome);
  const advance: RunAdvance = {
    state: terminalState,
    checkpoint: consumed({ ...outcome.checkpoint, frontier: [] }),
    costUsd: cost,
    stepsExecuted: steps,
    outcome: outcome.outcome,
    outcomeDetail: outcome.detail,
    endedAt: new Date(),
  };
  const terminated = await persistNodeAdvance(ctx, run.id, run.checkpointSeq, advance, outcome.step);
  await notifyParentIfChild(ctx, deps, terminated);
  return terminated;
}

/**
 * FR-WF-04's unwind pass: pops ONE compensating action per executor step and dispatches
 * it, exactly like a forward node — through `ToolDispatcher`, so a compensating write is
 * subject to the same tiering, authz and egress discipline as the write it undoes.
 *
 * One per step (rather than a loop inside a single transaction) so the whole unwind is
 * itself crash-safe: a compensation that has been popped is durably gone from the stack
 * before the next one is attempted, so a crash mid-unwind resumes at the right depth
 * rather than either re-running a completed compensation or skipping one.
 *
 * The compensating call's own idempotency key is derived from the forward key
 * (`compensationIdempotencyKey`), so even a crash *during* a compensating call is safe
 * to retry — without that, a crashed refund could be issued twice.
 */
async function compensateOnce(ctx: TenantContext, deps: ExecuteRunDeps, run: WorkflowRunRow): Promise<WorkflowRunRow | null> {
  const checkpoint = parseCheckpoint(run.checkpointJson);
  const { checkpoint: popped, entry } = popCompensation(checkpoint);

  if (!entry) {
    // Stack empty — the unwind is complete and the run reaches its terminal state. The
    // outcome is `Failed`: a compensated run did not succeed, it was undone.
    const { run: terminated } = await terminateRun(ctx, run.id, ["Compensating"], "Failed", "Failed", {
      ...(run.outcomeDetail ?? {}),
      compensated: true,
      message: "This run failed and its write actions were compensated.",
    });
    if (terminated) await notifyParentIfChild(ctx, deps, terminated);
    return terminated;
  }

  const startedAt = new Date();
  let step: StepRecord;
  try {
    const result = await deps.runtime.tools.dispatch({
      toolId: entry.toolId,
      args: entry.args as Record<string, never>,
      conversationId: run.conversationId,
      idempotencyKey: compensationIdempotencyKey(entry.idempotencyKey),
      workflowRunStepId: run.id,
    });
    step = {
      nodeId: entry.nodeId,
      nodeKind: "ToolCall",
      // A compensating step is a NEW row, never an edit of the step it undoes (NFR-10).
      // The `-1` iteration keeps it out of the forward attempts' unique key, so a
      // compensation can never collide with a retry of the original node.
      iteration: -1,
      branchKey: null,
      refKind: "Tool",
      refVersionId: entry.toolId,
      refLabel: entry.toolId,
      status: result.kind === "Succeeded" ? "Compensated" : "Failed",
      input: await deps.runtime.masker.mask(entry.args),
      output: result.kind === "Succeeded" ? await deps.runtime.masker.mask(result.output) : null,
      error: result.kind === "Succeeded" ? null : { code: "WORKFLOW_COMPENSATION_FAILED", message: describeDispatchFailure(result), retriable: false },
      startedAt,
      endedAt: new Date(),
    };
  } catch (err) {
    step = {
      nodeId: entry.nodeId,
      nodeKind: "ToolCall",
      iteration: -1,
      branchKey: null,
      refKind: "Tool",
      refVersionId: entry.toolId,
      refLabel: entry.toolId,
      status: "Failed",
      error: { code: "WORKFLOW_COMPENSATION_FAILED", message: err instanceof Error ? err.message : String(err), retriable: false },
      startedAt,
      endedAt: new Date(),
    };
  }

  // The unwind CONTINUES even when one compensating action fails. Stopping would strand
  // every shallower write un-compensated, which is strictly worse than best-effort
  // unwinding; the failure is recorded on its own step row, so it is visible in the
  // trace and actionable rather than silent.
  return persistNodeAdvance(
    ctx,
    run.id,
    run.checkpointSeq,
    { state: "Compensating", checkpoint: popped, costUsd: run.costUsd, stepsExecuted: run.stepsExecuted + 1 },
    step,
  );
}

function describeDispatchFailure(result: { kind: string; reason?: string; errorMessage?: string }): string {
  if (result.kind === "Denied") return `compensation denied: ${result.reason ?? ""}`;
  if (result.kind === "Failed") return result.errorMessage ?? "compensation failed";
  return `compensation could not be dispatched (${result.kind})`;
}

/**
 * When a run with a parent reaches a terminal state, wake the parent immediately rather
 * than making it wait for its own suspension deadline.
 *
 * This is an OPTIMIZATION over the reconciling sweep, not a replacement for it: the
 * pump's suspension reconciliation independently checks every `SubWorkflow`-suspended
 * run's child on each tick, so a failure here (or a crash between the child terminating
 * and this call) delays the parent by one tick rather than stranding it. That is the
 * same "the sweep is authoritative, the fast path is an optimization" shape ADR-0013
 * §2.4 described for timers — kept here, where it costs nothing, even though ADR-0013 §7
 * removed the queue-backed version of it.
 */
async function notifyParentIfChild(ctx: TenantContext, _deps: ExecuteRunDeps, child: WorkflowRunRow | null): Promise<void> {
  if (!child?.parentRunId) return;
  await resumeParentOnChildTerminal(ctx, child);
}

/**
 * Folds a terminal child run's outcome into its parent's variables and wakes the parent.
 *
 * Idempotent by construction: `resumeSuspendedRun` CAS-es on `state = 'Suspended'`, so a
 * parent already woken (by this call, by the pump's reconciliation, or by its own expiry)
 * is left exactly as it is. Which of the two paths gets there first therefore does not
 * matter, and neither can double-apply the child's result.
 *
 * Exported so the pump's reconciling sweep uses THIS function rather than re-deriving
 * the same fold — one definition of "what a finished child does to its parent".
 */
export async function resumeParentOnChildTerminal(ctx: TenantContext, child: WorkflowRunRow): Promise<boolean> {
  if (!child.parentRunId) return false;
  const parent = await findWorkflowRunById(ctx, child.parentRunId);
  if (!parent || parent.state !== "Suspended" || parent.suspensionRef !== `workflow_run:${child.id}`) return false;

  const checkpoint = parseCheckpoint(parent.checkpointJson);
  // The parent's frontier is still on its `SubWorkflow` node (suspension leaves it
  // there), so the child's result is parked as that node's resume marker. When the
  // parent re-executes the node it consumes the marker, folds the child's variables into
  // its declared `outputVariable`, and advances — instead of spawning a second child.
  const entry = checkpoint.frontier[0];
  if (!entry) return false;
  const withResult = setResumeMarker(
    checkpoint,
    entry.nodeId,
    entry.iteration,
    toJsonValue({ runId: child.id, state: child.state, outcome: child.outcome, variables: parseCheckpoint(child.checkpointJson).variables }),
  );
  const { resumed } = await resumeSuspendedRun(ctx, parent.id, withResult);
  return resumed;
}

/** Seeds a freshly-created run's frontier with its single `Trigger` node (V1 guarantees
 *  exactly one). Called by the pump on first claim rather than at creation time, so run
 *  creation stays a pure insert and the graph is loaded exactly once, by the executor
 *  that is about to use it. */
export function seedFrontier(graph: WorkflowGraph, checkpoint: WorkflowCheckpoint): WorkflowCheckpoint {
  if (checkpoint.frontier.length > 0) return checkpoint;
  const trigger = graph.spec.nodes.find((n) => n.kind === "Trigger");
  if (!trigger) return checkpoint;
  return { ...checkpoint, frontier: [{ nodeId: trigger.id, branchKey: null, iteration: 0 }] };
}

/** Terminates a run at a declared outcome from outside the executor loop (the cancel
 *  endpoint, the suspension-expiry sweep). Exported so those callers go through one
 *  place that also wakes a waiting parent, rather than each writing their own terminate. */
export async function terminateRunWithOutcome(
  ctx: TenantContext,
  deps: ExecuteRunDeps,
  runId: string,
  expectedStates: Parameters<typeof terminateRun>[2],
  outcome: WorkflowRunTerminalOutcomeValue,
  detail: Record<string, unknown>,
): Promise<WorkflowRunRow | null> {
  const { terminated, run } = await terminateRun(ctx, runId, expectedStates, outcome, stateForOutcome(outcome), detail);
  if (terminated) await notifyParentIfChild(ctx, deps, run);
  return run;
}

/**
 * A fresh worker instance id, used as `workflow_run_lease.owner`.
 *
 * **The random suffix must be genuinely random, not a `generateId()` prefix.**
 * `generateId()` is a UUIDv7, whose leading hex characters are a millisecond timestamp —
 * so `generateId().slice(0, 8)` is IDENTICAL for two calls in the same millisecond. Two
 * replicas booting together (or restarting together after a deploy) would then share an
 * owner id, and every owner-scoped guarantee this module relies on would silently
 * collapse: `renewRunLease`'s `AND owner = $owner` would let a dispossessed holder steal
 * its run back mid-step, and `releaseRunLease` would let one replica release another's
 * live lease straight into a third claimer's hands.
 *
 * `crypto.randomUUID()` makes the suffix collision-resistant regardless of timing — the
 * same fix `createFixtureTenant` already documents for its own slug, and the reason
 * `@nextbot/teams`' conversation fixture mixes one in too. Found by this phase's own
 * lease-concurrency suite, which produced two identical ids in one test run.
 */
export function newWorkerInstanceId(): string {
  return `worker-${process.pid}-${crypto.randomUUID().slice(0, 12)}`;
}

/** The value written into `workflow_run_step.output` for a resumed suspension, kept
 *  here so the pump and the executor agree on its shape. */
export function suspensionResumePayload(kind: string, detail: Record<string, unknown>): Record<string, unknown> {
  return { resumedFrom: kind, ...detail };
}

/** Re-exported so `run-pump.ts` can fold a resolved suspension's result into the
 *  checkpoint using the same coercion the node executors use. */
export { toJsonValue };
