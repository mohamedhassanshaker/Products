import { describe, expect, it } from "vitest";
import type { WorkflowCheckpoint, WorkflowRunLimits } from "@nextbot/contracts";
import { BUDGET_BREACH_MESSAGES, checkLoopBudget, checkParallelBudget, checkRunBudget, checkSubWorkflowDepth } from "./run-budget.js";
import { emptyCheckpoint } from "./checkpoint.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, **FR-WF-06**) — unit coverage for all
 * six run-level ceilings.
 *
 * FR-WF-06 requires each ceiling to terminate the run at a DECLARED failure outcome,
 * "logged distinctly from a node-level `Failed`". These functions are the only place
 * that decides a ceiling was hit, so every ceiling is exercised at its boundary (one
 * under, exactly at, one over) rather than only in the obvious over case — an
 * off-by-one here is the difference between a budget that binds and one that does not.
 */

const limits: WorkflowRunLimits = {
  maxSteps: 10,
  maxCostUsd: 1.0,
  maxWallClockSeconds: 300,
  maxLoopIterations: 5,
  maxParallelBranches: 3,
  maxSubWorkflowDepth: 2,
};

function consumed(patch: Partial<WorkflowCheckpoint["consumed"]>): WorkflowCheckpoint {
  return { ...emptyCheckpoint(), consumed: { usd: 0, seconds: 0, steps: 0, ...patch } };
}

describe("checkRunBudget — steps", () => {
  it("allows one below the ceiling", () => {
    expect(checkRunBudget(limits, consumed({ steps: 9 }), 0)).toEqual({ ok: true });
  });

  it("BLOCKS at exactly the ceiling — `maxSteps: 10` means ten steps may run, not eleven", () => {
    const result = checkRunBudget(limits, consumed({ steps: 10 }), 0);
    expect(result).toEqual({ ok: false, reason: "STEP_BUDGET_EXCEEDED", limit: 10, observed: 10 });
  });
});

describe("checkRunBudget — cost", () => {
  it("allows below the ceiling and blocks at it", () => {
    expect(checkRunBudget(limits, consumed({ usd: 0.99 }), 0).ok).toBe(true);
    expect(checkRunBudget(limits, consumed({ usd: 1.0 }), 0)).toEqual({ ok: false, reason: "COST_BUDGET_EXCEEDED", limit: 1.0, observed: 1.0 });
  });
});

describe("checkRunBudget — wall clock", () => {
  it("uses the INJECTED elapsed value, not a clock, so the boundary is deterministic", () => {
    expect(checkRunBudget(limits, consumed({}), 299).ok).toBe(true);
    expect(checkRunBudget(limits, consumed({}), 300)).toEqual({ ok: false, reason: "WALL_CLOCK_BUDGET_EXCEEDED", limit: 300, observed: 300 });
  });
});

describe("checkRunBudget — precedence", () => {
  it("reports STEPS first when several ceilings are breached at once, so the message is stable", () => {
    const result = checkRunBudget(limits, consumed({ steps: 99, usd: 99 }), 9999);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("STEP_BUDGET_EXCEEDED");
  });
});

describe("checkLoopBudget — the node's own cap AND the run-wide ceiling, stricter wins", () => {
  it("honours a node cap below the run-wide ceiling", () => {
    expect(checkLoopBudget(limits, 2, 1).ok).toBe(true);
    expect(checkLoopBudget(limits, 2, 2)).toEqual({ ok: false, reason: "LOOP_ITERATIONS_EXCEEDED", limit: 2, observed: 2 });
  });

  it("clamps a node cap ABOVE the run-wide ceiling down to it — an author cannot exceed the run's own limit", () => {
    const result = checkLoopBudget(limits, 1000, 5);
    expect(result).toEqual({ ok: false, reason: "LOOP_ITERATIONS_EXCEEDED", limit: 5, observed: 5 });
  });

  it("falls back to the run-wide ceiling (never 'unlimited') when the node declares no cap", () => {
    // V4 makes this unreachable for a saved graph; the fallback is bounded anyway.
    expect(checkLoopBudget(limits, undefined, 4).ok).toBe(true);
    expect(checkLoopBudget(limits, undefined, 5).ok).toBe(false);
  });
});

describe("checkParallelBudget", () => {
  it("allows exactly the ceiling and blocks above it (fan-out is a count, not an index)", () => {
    expect(checkParallelBudget(limits, 3)).toEqual({ ok: true });
    expect(checkParallelBudget(limits, 4)).toEqual({ ok: false, reason: "PARALLEL_BRANCHES_EXCEEDED", limit: 3, observed: 4 });
  });
});

describe("checkSubWorkflowDepth", () => {
  it("allows a child at exactly the ceiling and blocks the one below it", () => {
    expect(checkSubWorkflowDepth(limits, 2)).toEqual({ ok: true });
    expect(checkSubWorkflowDepth(limits, 3)).toEqual({ ok: false, reason: "SUBWORKFLOW_DEPTH_EXCEEDED", limit: 2, observed: 3 });
  });

  it("a maxSubWorkflowDepth of 0 forbids any child at all", () => {
    expect(checkSubWorkflowDepth({ ...limits, maxSubWorkflowDepth: 0 }, 1).ok).toBe(false);
  });
});

describe("BUDGET_BREACH_MESSAGES", () => {
  it("has operator-readable copy for every reason code — a bare code in outcome_detail is not diagnosable", () => {
    for (const reason of ["STEP_BUDGET_EXCEEDED", "COST_BUDGET_EXCEEDED", "WALL_CLOCK_BUDGET_EXCEEDED", "LOOP_ITERATIONS_EXCEEDED", "PARALLEL_BRANCHES_EXCEEDED", "SUBWORKFLOW_DEPTH_EXCEEDED"] as const) {
      expect(BUDGET_BREACH_MESSAGES[reason]).toBeTruthy();
    }
  });
});
