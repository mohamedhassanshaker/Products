import { describe, expect, it } from "vitest";
import { buildDelegationTree, type FlatDelegationEvent } from "./tree-builder.js";

function event(overrides: Partial<FlatDelegationEvent> & Pick<FlatDelegationEvent, "id">): FlatDelegationEvent {
  return {
    parentDelegationEventId: null,
    depth: 0,
    siblingOrdinal: 0,
    agentLabel: "agent@1",
    memberKey: null,
    reason: "routing to specialist",
    outcome: "Answered",
    tokensIn: 0,
    tokensOut: 0,
    costUsd: "0",
    latencyMs: null,
    spanId: "span-1",
    toolCallIds: [],
    ...overrides,
  };
}

describe("buildDelegationTree (LLD §14.7.2/§14.7.5)", () => {
  it("returns an empty forest for an empty event list (the current real-world case — no live executor yet)", () => {
    expect(buildDelegationTree([])).toEqual([]);
  });

  it("assembles a single root with no children", () => {
    const tree = buildDelegationTree([event({ id: "e1" })]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.delegationEventId).toBe("e1");
    expect(tree[0]?.children).toEqual([]);
  });

  it("nests a child under its parent via parentDelegationEventId", () => {
    const tree = buildDelegationTree([
      event({ id: "root", depth: 0 }),
      event({ id: "child", depth: 1, parentDelegationEventId: "root" }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children).toHaveLength(1);
    expect(tree[0]?.children[0]?.delegationEventId).toBe("child");
  });

  it("preserves sibling order (already sorted by the repository's depth/sibling_ordinal query)", () => {
    const tree = buildDelegationTree([
      event({ id: "root", depth: 0 }),
      event({ id: "first", depth: 1, siblingOrdinal: 0, parentDelegationEventId: "root" }),
      event({ id: "second", depth: 1, siblingOrdinal: 1, parentDelegationEventId: "root" }),
    ]);
    expect(tree[0]?.children.map((c) => c.delegationEventId)).toEqual(["first", "second"]);
  });

  it("a multi-level tree (fan-out then a further hop) assembles correctly", () => {
    const tree = buildDelegationTree([
      event({ id: "root", depth: 0 }),
      event({ id: "a", depth: 1, parentDelegationEventId: "root", siblingOrdinal: 0 }),
      event({ id: "b", depth: 1, parentDelegationEventId: "root", siblingOrdinal: 1 }),
      event({ id: "a1", depth: 2, parentDelegationEventId: "a" }),
    ]);
    expect(tree[0]?.children).toHaveLength(2);
    const a = tree[0]!.children.find((c) => c.delegationEventId === "a")!;
    expect(a.children).toHaveLength(1);
    expect(a.children[0]?.delegationEventId).toBe("a1");
    const b = tree[0]!.children.find((c) => c.delegationEventId === "b")!;
    expect(b.children).toEqual([]);
  });

  it("treats an orphaned row (parent id not present in the fetched set) as its own root rather than dropping it", () => {
    const tree = buildDelegationTree([event({ id: "orphan", depth: 3, parentDelegationEventId: "missing-parent" })]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.delegationEventId).toBe("orphan");
  });
});
