import type { WorkflowRunOutcomeValue, WorkflowRunStateValue, WorkflowRunTerminalOutcomeValue } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, LLD §14.6.2) — the `workflow_run`
 * state machine, as a pure edge set.
 *
 * Mirrors `orchestration/domain/tool-call-fsm.ts` exactly in shape and intent: one
 * declared edge table that every state-mutating call site must go through, so a
 * transition nobody thought about is a loud defect rather than a silent write. The
 * database enforces the *shape* invariants (a Suspended run must declare what it waits
 * on; an outcome only exists on a terminal state); this enforces the *sequence*.
 */

/** Thrown when code attempts a transition not on the diagram. Always a defect, never
 *  a caller-input error — every legitimate business rejection (cancelling an already-
 *  terminal run, resuming a Succeeded one) is its own typed application-layer error
 *  raised BEFORE this is called. */
export class IllegalWorkflowRunTransition extends Error {
  constructor(from: WorkflowRunStateValue, to: WorkflowRunStateValue) {
    super(`Illegal workflow_run transition: ${from} -> ${to}`);
    this.name = "IllegalWorkflowRunTransition";
  }
}

const ALLOWED_TRANSITIONS: Record<WorkflowRunStateValue, WorkflowRunStateValue[]> = {
  // A brand-new run is claimed by the pump and starts executing. It can also be
  // cancelled before it ever runs, and can time out if its wall-clock budget is
  // already exhausted at first claim (a run created long before the pump reached it).
  Pending: ["Running", "Cancelled", "TimedOut", "Failed"],
  // The ordinary working state. `Compensating` is entered on a failure with a
  // non-empty compensation stack; `Failed`/`TimedOut` directly otherwise.
  Running: ["Suspended", "Compensating", "Succeeded", "Failed", "TimedOut", "Cancelled"],
  // A suspension resolves back to `Running` (the reconciling pump saw its condition
  // satisfied) or terminates at its DECLARED `suspension_expiry_outcome`. It may also
  // be cancelled by an operator while it waits.
  Suspended: ["Running", "Failed", "TimedOut", "Cancelled"],
  // FR-WF-04's unwind pass. It never returns to `Running`: once a run has begun
  // undoing its writes, resuming forward execution would re-apply them.
  Compensating: ["Failed", "TimedOut", "Cancelled"],
  Succeeded: [],
  Failed: [],
  TimedOut: [],
  Cancelled: [],
};

/** A run in one of these states is finished; nothing may move it again. Matches the
 *  `workflow_run_outcome_terminal_only` / `workflow_run_ended_at_terminal_only` DB
 *  CHECKs, which are the same rule enforced one layer down. */
export const TERMINAL_RUN_STATES: WorkflowRunStateValue[] = ["Succeeded", "Failed", "TimedOut", "Cancelled"];

export function isTerminalRunState(state: WorkflowRunStateValue): boolean {
  return TERMINAL_RUN_STATES.includes(state);
}

/**
 * Validates one `workflow_run` state transition.
 *
 * @throws {IllegalWorkflowRunTransition} if `to` is not a documented successor of `from`.
 */
export function assertRunTransition(from: WorkflowRunStateValue, to: WorkflowRunStateValue): WorkflowRunStateValue {
  if (!(ALLOWED_TRANSITIONS[from] ?? []).includes(to)) throw new IllegalWorkflowRunTransition(from, to);
  return to;
}

export function canTransitionRun(from: WorkflowRunStateValue, to: WorkflowRunStateValue): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Maps a terminal outcome to the run state that must accompany it.
 *
 * The two columns are not independent — a run whose `outcome` is `Timeout` but whose
 * `state` is `Failed` would make the Runs list and the trace disagree about the same
 * run. Deriving one from the other in a single place is what keeps them consistent.
 *
 *  - `Resolved`/`Escalated`/`Transferred` are *successful* completions of the authored
 *    graph: the run did what the author designed, so the run state is `Succeeded` even
 *    though the business outcome was an escalation or a transfer. This mirrors how
 *    `agent_run` treats an escalating turn as a completed run, not a failed one.
 *  - `Timeout` -> `TimedOut`, `Cancelled` -> `Cancelled`, and both `Failed` and
 *    `BudgetExceeded` -> `Failed` (the two stay distinguishable via `outcome`, which is
 *    exactly what FR-WF-06's "logged distinctly" asks for).
 */
export function stateForOutcome(outcome: WorkflowRunTerminalOutcomeValue): WorkflowRunStateValue {
  switch (outcome) {
    case "Resolved":
    case "Escalated":
    case "Transferred":
      return "Succeeded";
    case "Timeout":
      return "TimedOut";
    case "Cancelled":
      return "Cancelled";
    case "Failed":
    case "BudgetExceeded":
      return "Failed";
    default: {
      const exhaustive: never = outcome;
      throw new Error(`stateForOutcome: unknown outcome ${String(exhaustive)}`);
    }
  }
}

/** Widens the 4-value AUTHORABLE outcome union (`End.outcome`, `Wait`/`HumanTask`'s
 *  `onTimeout`) into the 7-value runtime one. A pure widening — every authorable value
 *  is a runtime value — declared explicitly so the two vocabularies stay visibly
 *  related rather than being bridged by an unchecked cast at each call site. */
export function widenAuthoredOutcome(authored: WorkflowRunOutcomeValue): WorkflowRunTerminalOutcomeValue {
  return authored;
}
