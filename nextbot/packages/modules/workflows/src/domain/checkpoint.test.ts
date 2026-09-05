import { describe, expect, it } from "vitest";
import {
  addConsumption,
  clearJoinBarrier,
  emptyCheckpoint,
  frontierNodeIds,
  incrementLoop,
  isJoinSatisfied,
  isValidCheckpoint,
  loopCount,
  parseCheckpoint,
  popCompensation,
  pushCompensation,
  recordJoinArrival,
  replaceFrontierEntry,
  resetLoop,
  resumeMarkerKey,
  sameFrontierEntry,
  setResumeMarker,
  takeResumeMarker,
  withVariable,
  withVariables,
} from "./checkpoint.js";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, LLD §14.6.2) — unit coverage for the
 * structure that holds the whole resumable state of a run.
 *
 * The recurring theme: every helper is IMMUTABLE and TOTAL. Immutability matters because
 * the resume protocol persists the checkpoint in one transaction with the step row — an
 * in-place mutation would leave the in-memory checkpoint ahead of the durable one if the
 * persist failed, which is precisely the divergence the optimistic-concurrency guard
 * exists to catch and far better never to create.
 */

const entry = { nodeId: "a", branchKey: null, iteration: 0 };

describe("emptyCheckpoint / parseCheckpoint / isValidCheckpoint", () => {
  it("an empty checkpoint satisfies WorkflowCheckpointSchema", () => {
    expect(isValidCheckpoint(emptyCheckpoint())).toBe(true);
  });

  it("round-trips a real checkpoint through JSON unchanged (it is stored as jsonb)", () => {
    const checkpoint = pushCompensation(withVariable(emptyCheckpoint(), "x", 1), {
      stepId: "11111111-1111-4111-8111-111111111111",
      nodeId: "n",
      toolId: "22222222-2222-4222-8222-222222222222",
      args: { a: 1 },
      idempotencyKey: "k",
    });
    expect(parseCheckpoint(JSON.parse(JSON.stringify(checkpoint)))).toEqual(checkpoint);
  });

  it("REPAIRS a malformed/legacy value to a coherent shape instead of throwing — a bad row must not wedge the pump", () => {
    for (const raw of [null, undefined, {}, { variables: "not an object" }, { unknownKey: 1 }]) {
      const repaired = parseCheckpoint(raw);
      expect(isValidCheckpoint(repaired)).toBe(true);
      expect(repaired.frontier).toEqual([]);
    }
  });

  it("drops undeclared keys — a checkpoint must never become a place executor state hides", () => {
    const repaired = parseCheckpoint({ ...emptyCheckpoint(), smuggled: { pid: 1 } });
    expect(repaired).not.toHaveProperty("smuggled");
  });
});

describe("variables", () => {
  it("withVariable and withVariables return NEW checkpoints and never mutate the input", () => {
    const original = emptyCheckpoint();
    const next = withVariables(withVariable(original, "a", 1), { b: "two" });
    expect(original.variables).toEqual({});
    expect(next.variables).toEqual({ a: 1, b: "two" });
  });
});

describe("resume markers", () => {
  it("keys by (nodeId, iteration) under a reserved prefix an author cannot write", () => {
    // Node ids match `^[a-z][a-z0-9_]{0,63}$`, so no `outputVariable` can start with `_`.
    expect(resumeMarkerKey("wait_1", 3)).toBe("__resume__wait_1__3");
  });

  it("set then take returns the marker and REMOVES it — resume is single-use", () => {
    const parked = setResumeMarker(emptyCheckpoint(), "approval_node", 0, { status: "Succeeded" });
    const taken = takeResumeMarker(parked, "approval_node", 0);
    expect(taken.marker).toEqual({ status: "Succeeded" });
    expect(takeResumeMarker(taken.checkpoint, "approval_node", 0).marker).toBeNull();
  });

  it("does not match a different iteration of the same node — a suspending node inside a loop resumes the right pass", () => {
    const parked = setResumeMarker(emptyCheckpoint(), "approval_node", 1, { status: "Succeeded" });
    expect(takeResumeMarker(parked, "approval_node", 2).marker).toBeNull();
    expect(takeResumeMarker(parked, "approval_node", 1).marker).toEqual({ status: "Succeeded" });
  });

  it("takes nothing (and does not mutate) when no marker exists", () => {
    const checkpoint = emptyCheckpoint();
    const taken = takeResumeMarker(checkpoint, "nope", 0);
    expect(taken.marker).toBeNull();
    expect(taken.checkpoint).toBe(checkpoint);
  });
});

describe("frontier", () => {
  it("treats the same node in a different branch or iteration as a DIFFERENT position", () => {
    expect(sameFrontierEntry(entry, { ...entry })).toBe(true);
    expect(sameFrontierEntry(entry, { ...entry, branchKey: "left" })).toBe(false);
    expect(sameFrontierEntry(entry, { ...entry, iteration: 1 })).toBe(false);
  });

  it("replaces one entry with one successor (the ordinary case)", () => {
    const checkpoint = { ...emptyCheckpoint(), frontier: [entry] };
    const next = replaceFrontierEntry(checkpoint, entry, [{ nodeId: "b", branchKey: null, iteration: 0 }]);
    expect(next.frontier).toEqual([{ nodeId: "b", branchKey: null, iteration: 0 }]);
  });

  it("replaces one entry with MANY (a Parallel fan-out) and with NONE (a branch that ended)", () => {
    const checkpoint = { ...emptyCheckpoint(), frontier: [entry] };
    expect(replaceFrontierEntry(checkpoint, entry, [
      { nodeId: "l", branchKey: "l", iteration: 0 },
      { nodeId: "r", branchKey: "r", iteration: 0 },
    ]).frontier).toHaveLength(2);
    expect(replaceFrontierEntry(checkpoint, entry, []).frontier).toEqual([]);
  });

  it("collapses duplicate successors, so two branches converging on one node do not execute it twice", () => {
    const checkpoint = { ...emptyCheckpoint(), frontier: [entry, { nodeId: "z", branchKey: null, iteration: 0 }] };
    const next = replaceFrontierEntry(checkpoint, entry, [{ nodeId: "z", branchKey: null, iteration: 0 }]);
    expect(next.frontier).toEqual([{ nodeId: "z", branchKey: null, iteration: 0 }]);
  });

  it("derives `current_node_ids` from the frontier, deduplicated", () => {
    const checkpoint = {
      ...emptyCheckpoint(),
      frontier: [
        { nodeId: "a", branchKey: "l", iteration: 0 },
        { nodeId: "a", branchKey: "r", iteration: 0 },
        { nodeId: "b", branchKey: null, iteration: 0 },
      ],
    };
    expect(frontierNodeIds(checkpoint).sort()).toEqual(["a", "b"]);
  });
});

describe("join barriers", () => {
  it("records arrivals by branch key and DEDUPLICATES them — a re-executed branch cannot satisfy an All join alone", () => {
    let checkpoint = emptyCheckpoint();
    let arrival = recordJoinArrival(checkpoint, "join_1", "left", 2);
    checkpoint = arrival.checkpoint;
    expect(arrival.arrived).toBe(1);

    arrival = recordJoinArrival(checkpoint, "join_1", "left", 2);
    expect(arrival.arrived).toBe(1);

    arrival = recordJoinArrival(arrival.checkpoint, "join_1", "right", 2);
    expect(arrival.arrived).toBe(2);
  });

  it("collapses a null branch key to one slot", () => {
    const first = recordJoinArrival(emptyCheckpoint(), "join_1", null, 1);
    expect(recordJoinArrival(first.checkpoint, "join_1", null, 1).arrived).toBe(1);
  });

  it("clears a barrier so a Join inside a Loop starts fresh next iteration", () => {
    const arrived = recordJoinArrival(emptyCheckpoint(), "join_1", "left", 2).checkpoint;
    expect(clearJoinBarrier(arrived, "join_1").joinBarriers).toEqual({});
  });

  it.each([
    ["All" as const, 1, 2, undefined, false],
    ["All" as const, 2, 2, undefined, true],
    ["Any" as const, 1, 3, undefined, true],
    ["Any" as const, 0, 3, undefined, false],
    ["Quorum" as const, 1, 3, 2, false],
    ["Quorum" as const, 2, 3, 2, true],
  ])("%s with %i of %i arrived (quorum %s) is satisfied=%s", (mode, arrived, expected, quorum, satisfied) => {
    expect(isJoinSatisfied(mode, arrived, expected, quorum)).toBe(satisfied);
  });

  it("Quorum with no declared quorum FAILS SAFE — it waits for all branches rather than releasing early", () => {
    expect(isJoinSatisfied("Quorum", 2, 3, undefined)).toBe(false);
    expect(isJoinSatisfied("Quorum", 3, 3, undefined)).toBe(true);
  });
});

describe("loop counters", () => {
  it("counts from zero and increments immutably", () => {
    const checkpoint = emptyCheckpoint();
    expect(loopCount(checkpoint, "loop_1")).toBe(0);
    const once = incrementLoop(checkpoint, "loop_1");
    expect(loopCount(once, "loop_1")).toBe(1);
    expect(loopCount(checkpoint, "loop_1")).toBe(0);
  });

  it("resets a nested loop's counter so an inner loop gets its full cap on each outer pass", () => {
    const counted = incrementLoop(incrementLoop(emptyCheckpoint(), "inner"), "inner");
    expect(loopCount(resetLoop(counted, "inner"), "inner")).toBe(0);
  });
});

describe("compensation stack (FR-WF-04)", () => {
  const compensation = (nodeId: string) => ({
    stepId: "11111111-1111-4111-8111-111111111111",
    nodeId,
    toolId: "22222222-2222-4222-8222-222222222222",
    args: {},
    idempotencyKey: `k-${nodeId}`,
  });

  it("unwinds DEEPEST-LAST — the only order that is safe for dependent writes", () => {
    // create-order then charge-card must undo as refund-card then cancel-order.
    let checkpoint = pushCompensation(emptyCheckpoint(), compensation("create_order"));
    checkpoint = pushCompensation(checkpoint, compensation("charge_card"));

    const first = popCompensation(checkpoint);
    expect(first.entry?.nodeId).toBe("charge_card");
    const second = popCompensation(first.checkpoint);
    expect(second.entry?.nodeId).toBe("create_order");
    expect(popCompensation(second.checkpoint).entry).toBeNull();
  });

  it("popping from an empty stack is the executor's signal that the unwind is complete", () => {
    const checkpoint = emptyCheckpoint();
    const popped = popCompensation(checkpoint);
    expect(popped.entry).toBeNull();
    expect(popped.checkpoint).toBe(checkpoint);
  });
});

describe("consumed budget accumulator", () => {
  it("accumulates cost and steps, but takes wall-clock as an ABSOLUTE elapsed value", () => {
    // Wall clock is a property of the run's lifetime (including time spent Suspended),
    // not the sum of its steps' durations — so it is replaced, never added.
    let checkpoint = addConsumption(emptyCheckpoint(), { usd: 0.5, steps: 1, elapsedSeconds: 10 });
    checkpoint = addConsumption(checkpoint, { usd: 0.25, steps: 1, elapsedSeconds: 12 });
    expect(checkpoint.consumed).toEqual({ usd: 0.75, steps: 2, seconds: 12 });
  });

  it("preserves the previous elapsed value when none is supplied", () => {
    const checkpoint = addConsumption(addConsumption(emptyCheckpoint(), { elapsedSeconds: 7 }), { steps: 1 });
    expect(checkpoint.consumed.seconds).toBe(7);
  });
});
