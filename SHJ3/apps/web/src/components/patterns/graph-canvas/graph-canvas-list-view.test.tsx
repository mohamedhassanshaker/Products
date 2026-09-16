import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GraphCanvasListView } from "./graph-canvas-list-view";
import type { GraphNode } from "./graph-canvas-types";

const NODE: GraphNode = { id: "n1", type: "provider", label: "SEWA", x: 0, y: 0 };

describe("GraphCanvasListView — emptyContent", () => {
  it("renders the table as before when emptyContent is omitted, even with zero nodes", () => {
    render(<GraphCanvasListView nodes={[]} edges={[]} entityTypeLabels={{}} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("renders emptyContent instead of the table when there are zero nodes", () => {
    render(
      <GraphCanvasListView
        nodes={[]}
        edges={[]}
        entityTypeLabels={{}}
        emptyContent={<p>No entities yet</p>}
      />,
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("No entities yet")).toBeInTheDocument();
  });

  it("renders the real table, not emptyContent, once there is at least one node", () => {
    render(
      <GraphCanvasListView
        nodes={[NODE]}
        edges={[]}
        entityTypeLabels={{}}
        emptyContent={<p>No entities yet</p>}
      />,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByText("No entities yet")).not.toBeInTheDocument();
  });
});
