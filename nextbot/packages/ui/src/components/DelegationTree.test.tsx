// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { DelegationTreeNode } from "@nextbot/contracts";
import { DelegationTree } from "./DelegationTree.js";

afterEach(() => cleanup());

function node(overrides: Partial<DelegationTreeNode> & Pick<DelegationTreeNode, "delegationEventId">): DelegationTreeNode {
  return {
    depth: 0,
    agentLabel: "supervisor@1",
    memberKey: null,
    reason: "routing to specialist",
    outcome: "Answered",
    tokensIn: 10,
    tokensOut: 20,
    costUsd: "0.0025",
    latencyMs: 120,
    spanId: "span-1",
    toolCallIds: [],
    children: [],
    ...overrides,
  };
}

describe("DelegationTree (Target Architecture Blueprint Phase 6 rendering foundation)", () => {
  it("renders an explanatory empty state when there are no delegation events (every run today — no live executor yet)", () => {
    render(<DelegationTree roots={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent(/no delegation events recorded/i);
  });

  it("renders a single root node with its label, outcome, and reason", () => {
    render(<DelegationTree roots={[node({ delegationEventId: "e1" })]} />);
    expect(screen.getByText("supervisor@1")).toBeInTheDocument();
    expect(screen.getByText("Answered")).toBeInTheDocument();
    expect(screen.getByText("routing to specialist")).toBeInTheDocument();
  });

  it("renders nested children under their parent (the tree structure, not a flat list)", () => {
    render(
      <DelegationTree
        roots={[
          node({
            delegationEventId: "root",
            agentLabel: "supervisor@1",
            children: [node({ delegationEventId: "child", agentLabel: "billing_agent@1", depth: 1, outcome: "Escalated" })],
          }),
        ]}
      />,
    );
    const items = screen.getAllByRole("treeitem");
    expect(items).toHaveLength(2);
    expect(screen.getByText("billing_agent@1")).toBeInTheDocument();
    expect(screen.getByText("Escalated")).toBeInTheDocument();
  });

  it("renders a member key when present (Phase 14 will populate this once team_member exists)", () => {
    render(<DelegationTree roots={[node({ delegationEventId: "e1", memberKey: "billing_agent" })]} />);
    expect(screen.getByText("(billing_agent)")).toBeInTheDocument();
  });
});
