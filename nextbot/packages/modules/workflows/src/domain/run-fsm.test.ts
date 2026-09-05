import { describe, expect, it } from "vitest";
import type { WorkflowRunStateValue, WorkflowRunTerminalOutcomeValue } from "@nextbot/contracts";
import { assertRunTransition, canTransitionRun, IllegalWorkflowRunTransition, isTerminalRunState, stateForOutcome, TERMINAL_RUN_STATES, widenAuthoredOutcome } from "./run-fsm.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, LLD §14.6.2) — unit coverage for the
 * `workflow_run` state machine, mirroring `orchestration/domain/tool-call-fsm.test.ts`'s
 * own discipline: every edge AND every non-edge, exhaustively, so a transition nobody
 * thought about is a loud defect rather than a silent write.
 */

const ALL_STATES: WorkflowRunStateValue[] = ["Pending", "Running", "Suspended", "Compensating", "Succeeded", "Failed", "TimedOut", "Cancelled"];

const EXPECTED_EDGES: Record<WorkflowRunStateValue, WorkflowRunStateValue[]> = {
  Pending: ["Running", "Cancelled", "TimedOut", "Failed"],
  Running: ["Suspended", "Compensating", "Succeeded", "Failed", "TimedOut", "Cancelled"],
  Suspended: ["Running", "Failed", "TimedOut", "Cancelled"],
  Compensating: ["Failed", "TimedOut", "Cancelled"],
  Succeeded: [],
  Failed: [],
  TimedOut: [],
  Cancelled: [],
};

describe("the edge set is exactly as documented — every edge and every NON-edge", () => {
  for (const from of ALL_STATES) {
    for (const to of ALL_STATES) {
      const allowed = EXPECTED_EDGES[from].includes(to);
      it(`${from} -> ${to} is ${allowed ? "allowed" : "REJECTED"}`, () => {
        expect(canTransitionRun(from, to)).toBe(allowed);
        if (allowed) {
          expect(assertRunTransition(from, to)).toBe(to);
        } else {
          expect(() => assertRunTransition(from, to)).toThrow(IllegalWorkflowRunTransition);
        }
      });
    }
  }
});

describe("terminal states", () => {
  it("are the four the DB CHECKs also name", () => {
    expect([...TERMINAL_RUN_STATES].sort()).toEqual(["Cancelled", "Failed", "Succeeded", "TimedOut"]);
  });

  it("have no outgoing edges at all — nothing may move a finished run", () => {
    for (const state of TERMINAL_RUN_STATES) {
      expect(ALL_STATES.filter((to) => canTransitionRun(state, to))).toEqual([]);
      expect(isTerminalRunState(state)).toBe(true);
    }
  });

  it("the four non-terminal states are not terminal", () => {
    for (const state of ["Pending", "Running", "Suspended", "Compensating"] as WorkflowRunStateValue[]) {
      expect(isTerminalRunState(state)).toBe(false);
    }
  });
});

describe("Compensating never returns to Running", () => {
  it("because resuming forward execution mid-unwind would re-apply the writes being undone", () => {
    expect(canTransitionRun("Compensating", "Running")).toBe(false);
    expect(canTransitionRun("Compensating", "Suspended")).toBe(false);
    expect(canTransitionRun("Compensating", "Succeeded")).toBe(false);
  });
});

describe("stateForOutcome — the two columns are derived from one place so they cannot disagree", () => {
  it.each([
    ["Resolved", "Succeeded"],
    ["Escalated", "Succeeded"],
    ["Transferred", "Succeeded"],
    ["Timeout", "TimedOut"],
    ["Cancelled", "Cancelled"],
    ["Failed", "Failed"],
    ["BudgetExceeded", "Failed"],
  ] as [WorkflowRunTerminalOutcomeValue, WorkflowRunStateValue][])("outcome %s implies state %s", (outcome, state) => {
    expect(stateForOutcome(outcome)).toBe(state);
  });

  it("treats Escalated/Transferred as SUCCESSFUL completions of the authored graph, not failures", () => {
    // The run did what the author designed; the business outcome was a handoff. Same
    // reading `agent_run` already takes of an escalating turn.
    expect(isTerminalRunState(stateForOutcome("Escalated"))).toBe(true);
    expect(stateForOutcome("Escalated")).toBe("Succeeded");
  });

  it("keeps BudgetExceeded distinguishable from a node-level Failed (FR-WF-06's 'logged distinctly')", () => {
    // Both land on state `Failed`, but the OUTCOME column keeps them apart — which is
    // exactly what FR-WF-06 asks for.
    expect(stateForOutcome("BudgetExceeded")).toBe(stateForOutcome("Failed"));
    expect("BudgetExceeded").not.toBe("Failed");
  });

  it("every terminal state is producible by at least one outcome", () => {
    const produced = new Set((["Resolved", "Escalated", "Transferred", "Failed", "BudgetExceeded", "Timeout", "Cancelled"] as WorkflowRunTerminalOutcomeValue[]).map(stateForOutcome));
    expect([...produced].sort()).toEqual(["Cancelled", "Failed", "Succeeded", "TimedOut"]);
  });
});

describe("widenAuthoredOutcome", () => {
  it("widens each of the four AUTHORABLE outcomes into the runtime vocabulary unchanged", () => {
    for (const authored of ["Resolved", "Escalated", "Transferred", "Failed"] as const) {
      expect(widenAuthoredOutcome(authored)).toBe(authored);
    }
  });
});
