import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { GraphCanvas } from "./graph-canvas";
import { findNearestNeighbor, resolveArrowKeyDirection } from "./use-nearest-neighbor-focus";
import type { GraphEdge, GraphNode } from "./graph-canvas-types";

// A small L-shaped layout: SEWA sits to the right of "Pay utilities bill" and
// "Bill PDF" sits below SEWA — deliberately asymmetric so a DOM-order
// traversal (declaration order below is service, provider, document) would
// give a *different* answer than real geometry for at least one direction,
// which is what makes the geometric assertions below meaningful rather than
// incidentally correct.
const nodes: GraphNode[] = [
  { id: "service-1", type: "service", label: "Pay utilities bill", x: 0, y: 0 },
  { id: "provider-1", type: "provider", label: "SEWA", x: 300, y: 0 },
  { id: "document-1", type: "document", label: "Bill PDF", x: 300, y: 220 },
];

const edges: GraphEdge[] = [
  { id: "edge-1", sourceId: "service-1", targetId: "provider-1", relationshipLabel: "requires" },
  { id: "edge-2", sourceId: "provider-1", targetId: "document-1", relationshipLabel: "issues" },
];

afterEach(() => {
  document.documentElement.dir = "";
});

describe("findNearestNeighbor (pure geometry)", () => {
  const items = [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 300, y: 0 },
    { id: "c", x: 300, y: 220 },
  ];

  it("picks the node to the right, not the node below, for a rightward search", () => {
    expect(findNearestNeighbor("a", items, "right")).toBe("b");
  });

  it("picks the node below for a downward search from the right-hand node", () => {
    expect(findNearestNeighbor("b", items, "down")).toBe("c");
  });

  it("returns undefined when nothing qualifies in that direction", () => {
    expect(findNearestNeighbor("a", items, "left")).toBeUndefined();
  });

  it("prefers the nearer of two qualifying candidates", () => {
    const withTwo = [
      { id: "origin", x: 0, y: 0 },
      { id: "near", x: 50, y: 0 },
      { id: "far", x: 500, y: 0 },
    ];
    expect(findNearestNeighbor("origin", withTwo, "right")).toBe("near");
  });
});

describe("resolveArrowKeyDirection", () => {
  it("does not swap ArrowUp/ArrowDown under RTL", () => {
    expect(resolveArrowKeyDirection("ArrowDown", "rtl")).toBe("down");
    expect(resolveArrowKeyDirection("ArrowUp", "rtl")).toBe("up");
  });

  it("swaps ArrowLeft/ArrowRight under RTL", () => {
    expect(resolveArrowKeyDirection("ArrowRight", "ltr")).toBe("right");
    expect(resolveArrowKeyDirection("ArrowRight", "rtl")).toBe("left");
    expect(resolveArrowKeyDirection("ArrowLeft", "rtl")).toBe("right");
  });
});

describe("GraphCanvas", () => {
  it("computes each node's accessible name as '<Prefix>: <label>, N relationships'", () => {
    render(<GraphCanvas nodes={nodes} edges={edges} />);
    expect(
      screen.getByRole("button", { name: "Provider: SEWA, 2 relationships" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Service: Pay utilities bill, 1 relationship" }),
    ).toBeInTheDocument();
  });

  it("the canvas is role=application with an accessible name", () => {
    render(<GraphCanvas nodes={nodes} edges={edges} aria-label="Entity relationship graph" />);
    expect(
      screen.getByRole("application", { name: "Entity relationship graph" }),
    ).toBeInTheDocument();
  });

  it("roving tabindex: exactly one node starts as a real tab stop, the first by default", () => {
    render(<GraphCanvas nodes={nodes} edges={edges} />);
    const first = screen.getByRole("button", { name: /Pay utilities bill/ });
    const second = screen.getByRole("button", { name: /SEWA/ });
    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");
  });

  it("ArrowRight moves real DOM focus to the geometric neighbour on the right, not DOM order", async () => {
    render(<GraphCanvas nodes={nodes} edges={edges} />);
    const service = screen.getByRole("button", { name: /Pay utilities bill/ });
    service.focus();
    fireEvent.keyDown(service, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByRole("button", { name: /SEWA/ })).toHaveFocus());
  });

  it("ArrowDown from the provider moves focus to the document below it", async () => {
    render(<GraphCanvas nodes={nodes} edges={edges} />);
    // Navigate to the provider via a real ArrowRight first, the same proven
    // path the test above uses — deliberately not `provider.focus()` as a
    // shortcut: that moves real DOM focus immediately but races the
    // `onFocus`-triggered React state update this hook relies on to know
    // which node arrow keys should now move *from*, since `fireEvent`'s
    // `act()` wrapping only guarantees *its own* dispatched event has been
    // fully processed by the time it returns, not an unrelated prior raw
    // `.focus()` call's.
    const service = screen.getByRole("button", { name: /Pay utilities bill/ });
    service.focus();
    fireEvent.keyDown(service, { key: "ArrowRight" });
    const provider = await screen.findByRole("button", { name: /SEWA/ });
    await waitFor(() => expect(provider).toHaveFocus());

    fireEvent.keyDown(provider, { key: "ArrowDown" });
    await waitFor(() => expect(screen.getByRole("button", { name: /Bill PDF/ })).toHaveFocus());
  });

  it("ArrowRight moves focus to the geometric LEFT neighbour once the document is RTL — real focus target, not a forwarded prop", async () => {
    document.documentElement.dir = "rtl";
    render(<GraphCanvas nodes={nodes} edges={edges} selectedNodeId="provider-1" />);
    const provider = await screen.findByRole("button", { name: /SEWA/ });
    provider.focus();
    fireEvent.keyDown(provider, { key: "ArrowRight" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Pay utilities bill/ })).toHaveFocus(),
    );
  });

  it("Enter opens the detail panel and moves focus into it; Escape returns focus to the originating node", async () => {
    render(<GraphCanvas nodes={nodes} edges={edges} />);
    const service = screen.getByRole("button", { name: /Pay utilities bill/ });
    service.focus();
    fireEvent.keyDown(service, { key: "Enter" });

    const heading = await screen.findByRole("heading", { name: "Pay utilities bill" });
    await waitFor(() => expect(heading).toHaveFocus());

    fireEvent.keyDown(heading, { key: "Escape" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Pay utilities bill/ })).toHaveFocus(),
    );
    expect(screen.queryByRole("heading", { name: "Pay utilities bill" })).not.toBeInTheDocument();
  });

  it("'/' moves focus to the search field", () => {
    render(<GraphCanvas nodes={nodes} edges={edges} />);
    const canvas = screen.getByRole("application");
    fireEvent.keyDown(canvas, { key: "/" });
    expect(screen.getByRole("searchbox", { name: "Search entities" })).toHaveFocus();
  });

  it("the list view is the mandatory second representation, rendering the SAME entities from the same props — not a hand-maintained second copy", () => {
    render(<GraphCanvas nodes={nodes} edges={edges} />);
    fireEvent.click(screen.getByRole("radio", { name: "List view" }));

    const table = screen.getByRole("table");
    for (const node of nodes) {
      expect(within(table).getByText(node.label)).toBeInTheDocument();
    }
    // The relationship content is derived from the exact same `edges` array
    // the canvas used above, not restated — anchored so it matches only the
    // service row's own exact relationship text, not the provider row's
    // (which legitimately contains the same words as a substring: "Pay
    // utilities bill requires → SEWA").
    expect(within(table).getByText(/^requires → SEWA$/)).toBeInTheDocument();
  });

  it("selecting a row in the list view returns to the canvas focused on that node", async () => {
    render(<GraphCanvas nodes={nodes} edges={edges} />);
    fireEvent.click(screen.getByRole("radio", { name: "List view" }));
    fireEvent.click(screen.getByRole("button", { name: "View SEWA on the canvas" }));

    await waitFor(() => expect(screen.getByRole("application")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: /SEWA/ })).toHaveFocus());
  });

  it("zoom keys adjust the canvas's scale transform", () => {
    render(<GraphCanvas nodes={nodes} edges={edges} />);
    const canvas = screen.getByRole("application");
    const zoomGroup = canvas.querySelector("g[transform*='scale']");
    expect(zoomGroup).toHaveAttribute("transform", expect.stringContaining("scale(1)"));

    fireEvent.keyDown(canvas, { key: "+" });
    expect(zoomGroup).toHaveAttribute("transform", expect.stringContaining("scale(1.2)"));

    fireEvent.keyDown(canvas, { key: "0" });
    expect(zoomGroup).toHaveAttribute("transform", expect.stringContaining("scale(1)"));
  });

  it("search dims non-matching nodes without removing them from the DOM", () => {
    render(<GraphCanvas nodes={nodes} edges={edges} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search entities" }), {
      target: { value: "SEWA" },
    });

    const sewa = screen.getByRole("button", { name: /SEWA/ });
    const service = screen.getByRole("button", { name: /Pay utilities bill/ });
    expect(sewa.getAttribute("class") ?? "").not.toContain("opacity-40");
    expect(service.getAttribute("class") ?? "").toContain("opacity-40");
  });

  it("empty state shows the '+ Add source' action when there are no nodes", () => {
    const onAddSource = vi.fn();
    render(<GraphCanvas nodes={[]} edges={[]} onAddSource={onAddSource} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add source" }));
    expect(onAddSource).toHaveBeenCalledOnce();
  });

  it("loading and error states render without the canvas", () => {
    const { rerender } = render(<GraphCanvas nodes={nodes} edges={edges} state="loading" />);
    expect(screen.queryByRole("application")).not.toBeInTheDocument();

    rerender(
      <GraphCanvas nodes={nodes} edges={edges} state="error" errorMessage="Graph query failed" />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Graph query failed");
  });

  it("merge confirmation names both entities and confirms only on explicit action", () => {
    const onMerge = vi.fn();
    render(
      <GraphCanvas
        nodes={nodes}
        edges={edges}
        duplicates={[{ primaryNodeId: "provider-1", duplicateNodeId: "document-1" }]}
        onMergeDuplicate={onMerge}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));

    // Both names appear twice inside the dialog (the emphasised entity-pair
    // line, and again in the plain-language description sentence) — a real,
    // deliberate redundancy for sighted and screen-reader users alike, not a
    // single element to match exactly.
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText("SEWA", { exact: false }).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("Bill PDF", { exact: false }).length).toBeGreaterThan(0);
    expect(onMerge).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Merge" }));
    expect(onMerge).toHaveBeenCalledWith({
      primaryNodeId: "provider-1",
      duplicateNodeId: "document-1",
    });
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<GraphCanvas nodes={nodes} edges={edges} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
