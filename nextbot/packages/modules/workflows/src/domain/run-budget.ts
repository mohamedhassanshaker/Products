import type { WorkflowCheckpoint, WorkflowRunLimits } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, **FR-WF-06**, LLD §14.6.2) —
 * run-level budget enforcement.
 *
 * FR-WF-06's ceilings come from `workflow_version.run_limits`, which Phase 15 already
 * guarantees is complete and non-null at save time (`WorkflowRunLimitsSchema`: "ALL
 * required, no schema-level defaults — an author who omits one has expressed nothing,
 * not 'unlimited'"). So this module never defaults a missing ceiling; if one were
 * somehow absent the run is stopped rather than run unbounded.
 *
 * Pure and dependency-free so every ceiling can be exercised exhaustively without a
 * database, and so the executor has exactly one place that decides "this run has spent
 * too much" — never a second comparison written inline at a call site.
 *
 * **Why `BudgetExceeded` is its own outcome.** FR-WF-06 requires that exceeding a
 * ceiling be "logged distinctly from a node-level `Failed`". `workflow_run_outcome`
 * carries `BudgetExceeded` as a runtime-only value no author can express, so the
 * distinction is structural rather than a convention someone can forget.
 */

/** Which ceiling stopped the run. Surfaced verbatim in `workflow_run.outcome_detail`
 *  so an operator sees *which* budget was hit, not merely that one was. */
export type BudgetBreachReason =
  | "STEP_BUDGET_EXCEEDED"
  | "COST_BUDGET_EXCEEDED"
  | "WALL_CLOCK_BUDGET_EXCEEDED"
  | "LOOP_ITERATIONS_EXCEEDED"
  | "PARALLEL_BRANCHES_EXCEEDED"
  | "SUBWORKFLOW_DEPTH_EXCEEDED";

export type BudgetCheck = { ok: true } | { ok: false; reason: BudgetBreachReason; limit: number; observed: number };

/** Human-readable copy for each breach, used in `outcome_detail.message`. Kept beside
 *  the codes so the two can never drift. */
export const BUDGET_BREACH_MESSAGES: Record<BudgetBreachReason, string> = {
  STEP_BUDGET_EXCEEDED: "This run reached its maximum number of steps.",
  COST_BUDGET_EXCEEDED: "This run reached its maximum cost.",
  WALL_CLOCK_BUDGET_EXCEEDED: "This run reached its maximum wall-clock duration.",
  LOOP_ITERATIONS_EXCEEDED: "A loop in this run reached its maximum iteration count.",
  PARALLEL_BRANCHES_EXCEEDED: "A parallel node in this run exceeded the maximum number of concurrent branches.",
  SUBWORKFLOW_DEPTH_EXCEEDED: "This run reached the maximum sub-workflow nesting depth.",
};

/**
 * The **run-level** pre-node check, evaluated before EVERY node the executor is about
 * to run — not merely at pass boundaries, so a single expensive node cannot push a run
 * arbitrarily past its ceiling before anyone notices.
 *
 * @param limits the version's `run_limits` (complete by construction — see module doc).
 * @param checkpoint the run's live `consumed` accumulator.
 * @param elapsedSeconds wall-clock since `workflow_run.started_at`, passed in rather
 *   than read from a clock here so this stays pure and exhaustively testable.
 * @returns `{ ok: true }`, or the specific ceiling that would be violated.
 */
export function checkRunBudget(limits: WorkflowRunLimits, checkpoint: WorkflowCheckpoint, elapsedSeconds: number): BudgetCheck {
  if (checkpoint.consumed.steps >= limits.maxSteps) {
    return { ok: false, reason: "STEP_BUDGET_EXCEEDED", limit: limits.maxSteps, observed: checkpoint.consumed.steps };
  }
  if (checkpoint.consumed.usd >= limits.maxCostUsd) {
    return { ok: false, reason: "COST_BUDGET_EXCEEDED", limit: limits.maxCostUsd, observed: checkpoint.consumed.usd };
  }
  if (elapsedSeconds >= limits.maxWallClockSeconds) {
    return { ok: false, reason: "WALL_CLOCK_BUDGET_EXCEEDED", limit: limits.maxWallClockSeconds, observed: elapsedSeconds };
  }
  return { ok: true };
}

/**
 * A `Loop` node's own per-node cap AND the run-wide `maxLoopIterations` ceiling, in one
 * place. Both apply: FR-WF-01 makes `maxIterations` mandatory per Loop (V4 rejects a
 * Loop without one at save time), and FR-WF-06 additionally bounds every loop in the
 * run by `run_limits.maxLoopIterations`. The stricter of the two wins, which is why a
 * single function evaluates both rather than two call sites racing to be first.
 *
 * @param nodeMaxIterations the Loop node's own `maxIterations`. `undefined` cannot
 *   occur for a saved graph (V4); if it somehow does, the run-wide ceiling alone applies
 *   — a bounded fallback, never "unlimited".
 */
export function checkLoopBudget(limits: WorkflowRunLimits, nodeMaxIterations: number | undefined, currentIterations: number): BudgetCheck {
  const effectiveCap = Math.min(nodeMaxIterations ?? limits.maxLoopIterations, limits.maxLoopIterations);
  if (currentIterations >= effectiveCap) {
    return { ok: false, reason: "LOOP_ITERATIONS_EXCEEDED", limit: effectiveCap, observed: currentIterations };
  }
  return { ok: true };
}

/**
 * A `Parallel` node's fan-out against `run_limits.maxParallelBranches`.
 *
 * V6 already checks this statically at save time. Re-checking at run time is deliberate
 * defense in depth of exactly the kind this codebase applies everywhere else (the
 * egress PEP re-check, `runTierEngine`'s `allowedCapabilityGroupIds` re-derivation):
 * the static check reasons over the graph as authored, and this one reasons over the
 * graph as actually loaded and executed.
 */
export function checkParallelBudget(limits: WorkflowRunLimits, branchCount: number): BudgetCheck {
  if (branchCount > limits.maxParallelBranches) {
    return { ok: false, reason: "PARALLEL_BRANCHES_EXCEEDED", limit: limits.maxParallelBranches, observed: branchCount };
  }
  return { ok: true };
}

/**
 * A `SubWorkflow` node's child depth against `run_limits.maxSubWorkflowDepth`.
 *
 * V8 resolves this statically through pinned versions at save time. This run-time
 * re-check exists because a statically-resolved chain and a dynamically-loaded one can
 * differ at the edges (a pinned sub-workflow version whose own graph changed shape is
 * impossible — versions are immutable — but a chain assembled across separately-saved
 * versions is only ever verified pairwise). Same defense-in-depth principle as the
 * parallel check above, and it is also what keeps `workflow_run.depth`'s own 0..8 DB
 * CHECK from ever being the thing that surfaces the problem.
 */
export function checkSubWorkflowDepth(limits: WorkflowRunLimits, childDepth: number): BudgetCheck {
  if (childDepth > limits.maxSubWorkflowDepth) {
    return { ok: false, reason: "SUBWORKFLOW_DEPTH_EXCEEDED", limit: limits.maxSubWorkflowDepth, observed: childDepth };
  }
  return { ok: true };
}
