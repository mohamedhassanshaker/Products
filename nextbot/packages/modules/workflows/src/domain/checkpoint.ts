import { Value } from "@sinclair/typebox/value";
import { WorkflowCheckpointSchema, type JsonValue, type WorkflowCheckpoint, type WorkflowCompensationEntry, type WorkflowFrontierEntry } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, LLD §14.6.2) — pure helpers over
 * `WorkflowCheckpointSchema`, the single structure that holds **the whole resumable
 * state of a run**.
 *
 * Every function here is total and side-effect-free and returns a NEW checkpoint
 * rather than mutating one. That is not stylistic: the resume protocol persists
 * `{state, current_node_ids, checkpoint_json, checkpoint_seq+1, …}` in one transaction
 * with the step row, and an in-place mutation would make a failed persist leave the
 * in-memory checkpoint ahead of the durable one — which is exactly the class of
 * divergence the optimistic-concurrency guard exists to catch, and which is far better
 * never to create.
 *
 * `domain/` may not import `@nextbot/db` (dependency-cruiser's `no-db-inside-domain`),
 * which is why persistence lives entirely in `infrastructure/workflow-run-repository.ts`
 * and this file knows nothing about rows.
 */

/** A brand-new run's checkpoint: no variables, an empty frontier (the executor seeds
 *  it with the Trigger node), no barriers, no loops, nothing to compensate, nothing
 *  consumed. */
export function emptyCheckpoint(): WorkflowCheckpoint {
  return { variables: {}, frontier: [], joinBarriers: {}, loopCounters: {}, compensations: [], consumed: { usd: 0, seconds: 0, steps: 0 } };
}

/**
 * Parses a `checkpoint_json` column value back into a typed checkpoint.
 *
 * A row written before a schema change, or hand-edited, must not crash a pump tick and
 * must not be silently accepted with unknown keys. So: a value that does not satisfy
 * `WorkflowCheckpointSchema` is REPAIRED to the nearest valid shape via TypeBox's own
 * `Value.Cast` (which fills missing required members with their defaults and drops
 * undeclared ones) rather than either throwing or being trusted. The repair is
 * deterministic and lossless for every checkpoint this codebase writes; it exists only
 * so a malformed row degrades to "this run restarts from a coherent state" instead of
 * "this run wedges the pump forever".
 *
 * @param raw the raw `checkpoint_json` value.
 * @returns a checkpoint guaranteed to satisfy `WorkflowCheckpointSchema`.
 */
export function parseCheckpoint(raw: unknown): WorkflowCheckpoint {
  if (Value.Check(WorkflowCheckpointSchema, raw)) return raw;
  return Value.Cast(WorkflowCheckpointSchema, raw ?? {}) as WorkflowCheckpoint;
}

/** Whether a raw column value is already a valid checkpoint — used by the schema test
 *  and by the repository's write-side assertion, so nothing invalid is ever persisted
 *  in the first place. */
export function isValidCheckpoint(raw: unknown): boolean {
  return Value.Check(WorkflowCheckpointSchema, raw);
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

/** Sets one variable, returning a new checkpoint. `undefined` is normalized to `null`
 *  by the caller (`toJsonValue`) so the persisted map always satisfies the schema. */
export function withVariable(checkpoint: WorkflowCheckpoint, name: string, value: JsonValue): WorkflowCheckpoint {
  return { ...checkpoint, variables: { ...checkpoint.variables, [name]: value } };
}

/** Merges a whole map of variables at once — used to seed a run from its trigger
 *  payload and to fold a sub-workflow's output back into its parent. */
export function withVariables(checkpoint: WorkflowCheckpoint, values: Record<string, JsonValue>): WorkflowCheckpoint {
  return { ...checkpoint, variables: { ...checkpoint.variables, ...values } };
}

// ---------------------------------------------------------------------------
// Resume markers
// ---------------------------------------------------------------------------

/**
 * The reserved variable name a resolved suspension's result is parked under.
 *
 * **Why this exists.** When a node suspends, the frontier is deliberately left pointing
 * at that same node (see `run-executor.ts`'s persist), so resuming re-executes it. For a
 * `Wait` that is exactly right — the timer elapsed, fall through. For an `Approval`, a
 * `HumanTask` or a `SubWorkflow` it would be actively wrong: re-executing would dispatch
 * a second tool call, raise a second escalation, or wait on the child all over again.
 *
 * A resume marker is how the reconciling pump hands the resolved result *to the node
 * that was waiting for it*. The node executor checks for its own marker first; if one is
 * present it consumes it and advances, and only otherwise does it dispatch. That keeps
 * "suspend and resume" a property of the checkpoint — durable, crash-safe, and visible
 * in the run row — rather than of a second control-flow concept.
 *
 * Keyed by `(nodeId, iteration)` so a suspending node inside a loop resumes the right
 * iteration, and prefixed with `__resume__` so it cannot collide with an authored
 * `outputVariable` (node ids are `^[a-z][a-z0-9_]{0,63}$`, so no author can write a
 * name starting with an underscore).
 */
export function resumeMarkerKey(nodeId: string, iteration: number): string {
  return `__resume__${nodeId}__${iteration}`;
}

/** Parks a resolved suspension's result for the node that was waiting on it. */
export function setResumeMarker(checkpoint: WorkflowCheckpoint, nodeId: string, iteration: number, result: JsonValue): WorkflowCheckpoint {
  return withVariable(checkpoint, resumeMarkerKey(nodeId, iteration), result);
}

/**
 * Consumes a node's resume marker, if it has one.
 *
 * Removing it in the same operation that reads it is what makes resume single-use: a
 * node that resumes, advances, and is later reached again (a loop, a rejoined branch)
 * suspends properly instead of instantly falling through on a stale result.
 *
 * @returns the marker (or `null`) and the checkpoint with it removed.
 */
export function takeResumeMarker(checkpoint: WorkflowCheckpoint, nodeId: string, iteration: number): { checkpoint: WorkflowCheckpoint; marker: JsonValue | null } {
  const key = resumeMarkerKey(nodeId, iteration);
  if (!Object.prototype.hasOwnProperty.call(checkpoint.variables, key)) return { checkpoint, marker: null };
  const variables = { ...checkpoint.variables };
  const marker = (variables[key] ?? null) as JsonValue | null;
  delete variables[key];
  return { checkpoint: { ...checkpoint, variables }, marker };
}

// ---------------------------------------------------------------------------
// Frontier
// ---------------------------------------------------------------------------

/** Two frontier entries are the same position when all three coordinates match —
 *  the same node inside a different Parallel branch, or a different Loop iteration,
 *  is genuinely a different position. */
export function sameFrontierEntry(a: WorkflowFrontierEntry, b: WorkflowFrontierEntry): boolean {
  return a.nodeId === b.nodeId && a.branchKey === b.branchKey && a.iteration === b.iteration;
}

/**
 * Replaces one frontier entry with zero or more successors — the single operation
 * every node executor's result is applied through.
 *
 * Zero successors means the branch ended (an `End` node, or a branch that arrived at a
 * `Join` which is still waiting). More than one means a `Parallel` fan-out. Exactly
 * one is the ordinary case.
 *
 * Duplicates are collapsed, so two branches converging on the same node at the same
 * iteration produce one frontier entry rather than executing that node twice.
 */
export function replaceFrontierEntry(checkpoint: WorkflowCheckpoint, entry: WorkflowFrontierEntry, successors: WorkflowFrontierEntry[]): WorkflowCheckpoint {
  const remaining = checkpoint.frontier.filter((f) => !sameFrontierEntry(f, entry));
  const merged = [...remaining];
  for (const successor of successors) {
    if (!merged.some((f) => sameFrontierEntry(f, successor))) merged.push(successor);
  }
  return { ...checkpoint, frontier: merged };
}

/** The `current_node_ids` denormalization the pump's claim scan reads, derived from
 *  the frontier so the two can never disagree. Deduplicated: the column answers "which
 *  nodes is this run at", not "how many branches are at each". */
export function frontierNodeIds(checkpoint: WorkflowCheckpoint): string[] {
  return [...new Set(checkpoint.frontier.map((f) => f.nodeId))];
}

// ---------------------------------------------------------------------------
// Join barriers
// ---------------------------------------------------------------------------

export interface JoinArrival {
  checkpoint: WorkflowCheckpoint;
  /** How many distinct branches have now arrived at this Join. */
  arrived: number;
  expected: number;
}

/**
 * Records one branch arriving at a `Join`, creating the barrier on first arrival.
 *
 * Arrivals are keyed by `branchKey` and deduplicated, so a branch that is re-executed
 * after a crash (the resume protocol guarantees at most one node re-executes) cannot
 * be counted twice and cannot satisfy an `All` join on its own.
 *
 * @param checkpoint the current checkpoint.
 * @param joinNodeId the `Join` node's authored id.
 * @param branchKey the arriving branch's discriminator; `null` collapses to the
 *   literal `"__default__"` so an unbranched arrival still occupies exactly one slot.
 * @param expected how many branches the matching `Parallel` opened.
 */
export function recordJoinArrival(checkpoint: WorkflowCheckpoint, joinNodeId: string, branchKey: string | null, expected: number): JoinArrival {
  const key = branchKey ?? "__default__";
  const existing = checkpoint.joinBarriers[joinNodeId] ?? { expected, arrived: [] };
  const arrived = existing.arrived.includes(key) ? existing.arrived : [...existing.arrived, key];
  const barrier = { expected: existing.expected || expected, arrived };
  return {
    checkpoint: { ...checkpoint, joinBarriers: { ...checkpoint.joinBarriers, [joinNodeId]: barrier } },
    arrived: arrived.length,
    expected: barrier.expected,
  };
}

/** Clears a satisfied barrier so a `Join` inside a `Loop` body starts fresh on the
 *  next iteration instead of instantly re-firing on the previous iteration's arrivals. */
export function clearJoinBarrier(checkpoint: WorkflowCheckpoint, joinNodeId: string): WorkflowCheckpoint {
  const barriers = { ...checkpoint.joinBarriers };
  delete barriers[joinNodeId];
  return { ...checkpoint, joinBarriers: barriers };
}

/** Whether a barrier's arrival count satisfies the `Join`'s declared mode. `Quorum`
 *  without a `quorum` value cannot occur (V11 rejects it at save time); the `?? expected`
 *  fallback is defense in depth that fails SAFE — it waits for all branches rather than
 *  releasing early. */
export function isJoinSatisfied(mode: "All" | "Any" | "Quorum", arrived: number, expected: number, quorum: number | undefined): boolean {
  if (mode === "Any") return arrived >= 1;
  if (mode === "Quorum") return arrived >= (quorum ?? expected);
  return arrived >= expected;
}

// ---------------------------------------------------------------------------
// Loop counters
// ---------------------------------------------------------------------------

export function loopCount(checkpoint: WorkflowCheckpoint, loopNodeId: string): number {
  return checkpoint.loopCounters[loopNodeId] ?? 0;
}

export function incrementLoop(checkpoint: WorkflowCheckpoint, loopNodeId: string): WorkflowCheckpoint {
  return { ...checkpoint, loopCounters: { ...checkpoint.loopCounters, [loopNodeId]: loopCount(checkpoint, loopNodeId) + 1 } };
}

/** Resets a nested loop's counter when its enclosing loop advances, so an inner loop
 *  gets its full `maxIterations` on each outer pass rather than exhausting its cap
 *  once and then never running again. */
export function resetLoop(checkpoint: WorkflowCheckpoint, loopNodeId: string): WorkflowCheckpoint {
  const counters = { ...checkpoint.loopCounters };
  delete counters[loopNodeId];
  return { ...checkpoint, loopCounters: counters };
}

// ---------------------------------------------------------------------------
// Compensation stack (FR-WF-04)
// ---------------------------------------------------------------------------

/**
 * Pushes one compensating action onto the stack. Called immediately AFTER a
 * write-classified `ToolCall` node succeeds — never before, since compensating a write
 * that never happened would itself be an unsafe side effect.
 *
 * Deepest-last, so `popCompensation` unwinds in strict reverse order of application,
 * which is the only order that is safe for dependent writes (create-order then
 * charge-card must undo as refund-card then cancel-order).
 */
export function pushCompensation(checkpoint: WorkflowCheckpoint, entry: WorkflowCompensationEntry): WorkflowCheckpoint {
  return { ...checkpoint, compensations: [...checkpoint.compensations, entry] };
}

/** Removes and returns the deepest (most recently pushed) compensation. Returns
 *  `entry: null` when the stack is empty, which is the executor's signal that the
 *  `Compensating` pass is complete and the run may reach its terminal state. */
export function popCompensation(checkpoint: WorkflowCheckpoint): { checkpoint: WorkflowCheckpoint; entry: WorkflowCompensationEntry | null } {
  if (checkpoint.compensations.length === 0) return { checkpoint, entry: null };
  const entry = checkpoint.compensations[checkpoint.compensations.length - 1]!;
  return { checkpoint: { ...checkpoint, compensations: checkpoint.compensations.slice(0, -1) }, entry };
}

// ---------------------------------------------------------------------------
// Consumed budget
// ---------------------------------------------------------------------------

/** Folds one node's consumption into the run's accumulator. `seconds` is recomputed
 *  from the run's own start rather than accumulated per step, because wall-clock is a
 *  property of the run's elapsed lifetime (including time spent Suspended), not the sum
 *  of its steps' durations. */
export function addConsumption(checkpoint: WorkflowCheckpoint, delta: { usd?: number; steps?: number; elapsedSeconds?: number }): WorkflowCheckpoint {
  return {
    ...checkpoint,
    consumed: {
      usd: checkpoint.consumed.usd + (delta.usd ?? 0),
      steps: checkpoint.consumed.steps + (delta.steps ?? 0),
      seconds: delta.elapsedSeconds ?? checkpoint.consumed.seconds,
    },
  };
}
