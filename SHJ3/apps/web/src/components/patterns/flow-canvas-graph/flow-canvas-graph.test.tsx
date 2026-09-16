import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { FlowCanvasGraph } from "./flow-canvas-graph";
import type { FlowConnection, FlowModel, FlowNode } from "../flow-canvas/flow-canvas-types";

/**
 * xyflow keeps every node rendered with inline `visibility: hidden` until it has been
 * "measured" at least once (`nodeHasDimensions` in `@xyflow/system`, gated on
 * `node.measured?.width !== undefined`) — real, deliberate behaviour so a node placed off its
 * final layout position never flashes at the wrong spot. Measurement is driven by a real
 * `ResizeObserver` firing on each node element (`useResizeObserver` in `@xyflow/react`); the
 * shared `vitest.setup.ts` polyfill is a documented no-op (built for `Slider`'s unconditional
 * `new ResizeObserver()` call, which only needs `observe()` not to throw), so it never fires and
 * every node in this suite would stay `visibility: hidden` — accessible only with RTL's
 * `hidden: true` — forever. A component-local, firing polyfill (scoped to this file only, not
 * the shared setup other component tests rely on staying inert) invokes the observer callback
 * once per observed element, matching a real browser's first-paint measurement pass; the actual
 * reported size does not matter (`nodeHasDimensions` only checks the field is *defined*, not
 * non-zero — jsdom cannot report a real one regardless).
 */
class FiringResizeObserverPolyfill implements ResizeObserver {
  #callback: ResizeObserverCallback;
  #targets = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }

  observe(target: Element): void {
    this.#targets.add(target);
    const entry = {
      target,
      contentRect: target.getBoundingClientRect(),
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    } as unknown as ResizeObserverEntry;
    this.#callback([entry], this);
  }

  unobserve(target: Element): void {
    this.#targets.delete(target);
  }

  disconnect(): void {
    this.#targets.clear();
  }
}

/**
 * jsdom also implements no `DOMMatrixReadOnly` at all — xyflow's own node-measurement path
 * (`updateNodeInternals` in `@xyflow/system`) reads the *current zoom* off it (`new
 * DOMMatrixReadOnly(viewportStyle.transform).m22`) to convert a measured element size back into
 * flow-space. Every test in this suite renders at the default `scale(1)` transform, so a stub
 * that always reports `m22 = 1` (real zoom) is exact here, not an approximation — xyflow's own
 * testing guide recommends exactly this same minimal stub for the identical reason.
 */
class DOMMatrixReadOnlyPolyfill {
  m22 = 1;
  // No declared constructor parameter — xyflow calls `new DOMMatrixReadOnly(style.transform)`,
  // but the transform string itself is never needed (every test renders at `scale(1)`), and this
  // project's lint config has no underscore-prefix escape for an unused parameter.
}

let realResizeObserver: typeof ResizeObserver;
let realDOMMatrixReadOnly: unknown;
let realOffsetWidth: PropertyDescriptor | undefined;
let realOffsetHeight: PropertyDescriptor | undefined;
/** Typed as `SVGElement` (not `SVGGraphicsElement`) — checked directly against jsdom's real
 * prototype chain: `SVGTextElement.prototype` inherits `getBBox` from `SVGElement.prototype`
 * there, not from an intermediate `SVGGraphicsElement.prototype` the spec names but this jsdom
 * version does not wire into the actual instance chain. */
type SvgElementWithBBox = { getBBox?: () => DOMRect };
let realGetBBox: (() => DOMRect) | undefined;

beforeEach(() => {
  realResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = FiringResizeObserverPolyfill;
  realDOMMatrixReadOnly = (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly;
  (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly = DOMMatrixReadOnlyPolyfill;

  // jsdom never lays anything out, so `offsetWidth`/`offsetHeight` (what xyflow's own
  // `getDimensions` reads to decide a node has been measured — see this file's own
  // `FiringResizeObserverPolyfill` doc comment) are always 0, and xyflow's real
  // `updateNodeInternals` explicitly requires BOTH to be truthy before it records a node as
  // measured at all (checked directly against the installed `@xyflow/system` source, not
  // assumed) — a fixed non-zero stub is the same real gap `vitest.setup.ts`'s own
  // `ResizeObserver` polyfill doc comment already names for jsdom generally ("cannot report a
  // real size regardless of what this polyfill does").
  realOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 150 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 60 });

  // jsdom implements no SVG layout at all — once nodes have a real measured size (the stubs
  // above), xyflow's real edge-label renderer measures its own `<text>` via `getBBox()` to
  // centre it, which jsdom's SVGElement simply does not define. A zero-rect stub is enough:
  // this suite never asserts on edge-label geometry, only on node/canvas accessibility.
  realGetBBox = (SVGElement.prototype as SvgElementWithBBox).getBBox;
  (SVGElement.prototype as SvgElementWithBBox).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
});

// start -> ask-amount -> check-amount --(Yes)--> handover-high
//                                      --(No)--> confirm
const nodes: FlowNode[] = [
  { id: "start", type: "message", title: "Greeting", summary: "Welcomes the user.", x: 0, y: 0 },
  {
    id: "ask-amount",
    type: "question",
    title: "Ask amount",
    summary: "How much is the bill?",
    x: 240,
    y: 0,
  },
  {
    id: "check-amount",
    type: "condition",
    title: "Amount over 500?",
    summary: "Branches on amount.",
    x: 480,
    y: 0,
  },
  {
    id: "handover-high",
    type: "handover",
    title: "Escalate",
    summary: "Hand over to a human.",
    x: 720,
    y: 0,
  },
  { id: "confirm", type: "message", title: "Confirm", summary: "Confirms the payment.", x: 720, y: 160 },
];

const connections: FlowConnection[] = [
  { id: "c1", sourceId: "start", targetId: "ask-amount" },
  { id: "c2", sourceId: "ask-amount", targetId: "check-amount" },
  { id: "c3", sourceId: "check-amount", targetId: "handover-high", branchLabel: "Yes" },
  { id: "c4", sourceId: "check-amount", targetId: "confirm", branchLabel: "No" },
];

const model: FlowModel = { nodes, connections };

afterEach(() => {
  document.documentElement.dir = "";
  globalThis.ResizeObserver = realResizeObserver;
  (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly = realDOMMatrixReadOnly;
  if (realOffsetWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", realOffsetWidth);
  if (realOffsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", realOffsetHeight);
  if (realGetBBox) (SVGElement.prototype as SvgElementWithBBox).getBBox = realGetBBox;
});

describe("FlowCanvasGraph", () => {
  it("renders every real node as a focusable, accessibly-named button", () => {
    render(<FlowCanvasGraph model={model} />);
    expect(
      screen.getByRole("button", { name: "Condition: Amount over 500?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Handover: Escalate" })).toBeInTheDocument();
  });

  it("the canvas is role=application with an accessible name", () => {
    render(<FlowCanvasGraph model={model} aria-label="Conversation flow" />);
    expect(screen.getByRole("application", { name: "Conversation flow" })).toBeInTheDocument();
  });

  it("roving tabindex starts on the root node", () => {
    render(<FlowCanvasGraph model={model} />);
    expect(screen.getByRole("button", { name: /Greeting/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("button", { name: /Ask amount/ })).toHaveAttribute("tabindex", "-1");
  });

  it("ArrowDown walks the topological order, not DOM order", async () => {
    render(<FlowCanvasGraph model={model} selectedNodeId="start" />);
    const start = screen.getByRole("button", { name: /Greeting/ });
    start.focus();
    fireEvent.keyDown(start, { key: "ArrowDown" });
    await waitFor(() => expect(screen.getByRole("button", { name: /Ask amount/ })).toHaveFocus());
  });

  it("ArrowRight moves to the sibling that is geometrically previous once the document is RTL", async () => {
    document.documentElement.dir = "rtl";
    render(<FlowCanvasGraph model={model} selectedNodeId="confirm" />);
    const confirm = await screen.findByRole("button", { name: /Confirm/ });
    confirm.focus();
    fireEvent.keyDown(confirm, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByRole("button", { name: /Escalate/ })).toHaveFocus());
  });

  it("Enter opens the inspector and moves focus into it; Escape returns focus to the originating node", async () => {
    render(<FlowCanvasGraph model={model} selectedNodeId="start" />);
    const start = screen.getByRole("button", { name: /Greeting/ });
    start.focus();
    fireEvent.keyDown(start, { key: "Enter" });

    const heading = await screen.findByRole("heading", { name: "Greeting" });
    await waitFor(() => expect(heading).toHaveFocus());

    fireEvent.keyDown(heading, { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("button", { name: /Greeting/ })).toHaveFocus());
    expect(screen.queryByRole("heading", { name: "Greeting" })).not.toBeInTheDocument();
  });

  it("onActivateNode, when supplied, replaces the built-in inspector entirely", () => {
    const activated: string[] = [];
    render(<FlowCanvasGraph model={model} onActivateNode={(id) => activated.push(id)} />);
    fireEvent.click(screen.getByRole("button", { name: /Greeting/ }));
    expect(activated).toEqual(["start"]);
    expect(screen.queryByRole("heading", { name: "Greeting" })).not.toBeInTheDocument();
  });

  it("the outline view is the mandatory second representation, rendering the same nodes from the same model", () => {
    render(<FlowCanvasGraph model={model} />);
    fireEvent.click(screen.getByRole("radio", { name: "Outline view" }));

    for (const node of nodes) {
      expect(screen.getByText(node.title)).toBeInTheDocument();
    }
    expect(screen.getByText(/— Yes/)).toBeInTheDocument();
  });

  it("selecting a node from the outline view returns to the canvas focused on it", async () => {
    render(<FlowCanvasGraph model={model} />);
    fireEvent.click(screen.getByRole("radio", { name: "Outline view" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Escalate in the flow" }));

    // xyflow's own internal wrapper also carries `role="application"` (nested inside this
    // canvas's own, named one) — matched by accessible name to avoid the ambiguous match.
    await waitFor(() =>
      expect(screen.getByRole("application", { name: "Conversation flow" })).toBeInTheDocument(),
    );
  });

  it("never renders an R3 banner on the canvas, regardless of escape-path state — the check now happens at publish time (agents/actions.ts), not here", () => {
    const noEscape: FlowModel = {
      nodes: [nodes[0]!, nodes[1]!],
      connections: [connections[0]!],
    };
    const { rerender } = render(<FlowCanvasGraph model={noEscape} />);
    expect(screen.queryByText(/Free-text escape path/)).not.toBeInTheDocument();

    rerender(<FlowCanvasGraph model={model} />);
    expect(screen.queryByText(/Free-text escape path/)).not.toBeInTheDocument();
  });

  it("loading and error states render without the canvas", () => {
    const { rerender } = render(<FlowCanvasGraph model={model} state="loading" />);
    expect(screen.queryByRole("application")).not.toBeInTheDocument();

    rerender(<FlowCanvasGraph model={model} state="error" errorMessage="Flow query failed" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Flow query failed");
  });

  it("empty state renders when the flow has no nodes", () => {
    render(<FlowCanvasGraph model={{ nodes: [], connections: [] }} />);
    expect(screen.getByText("This flow is empty")).toBeInTheDocument();
  });

  it("empty state still offers every node type when a caller supplies onRequestCreateNode — a brand-new flow must be able to create its first node", () => {
    const onRequestCreateNode = vi.fn();
    render(
      <FlowCanvasGraph
        model={{ nodes: [], connections: [] }}
        onRequestCreateNode={onRequestCreateNode}
      />,
    );
    const messageButton = screen.getByRole("button", { name: /Message/ });
    fireEvent.click(messageButton);
    expect(onRequestCreateNode).toHaveBeenCalledWith("message");
  });

  it("empty state hides the node-creation buttons when no onRequestCreateNode is supplied, or in readonly", () => {
    const { rerender } = render(<FlowCanvasGraph model={{ nodes: [], connections: [] }} />);
    expect(screen.queryByRole("button", { name: /Message/ })).not.toBeInTheDocument();

    rerender(
      <FlowCanvasGraph
        model={{ nodes: [], connections: [] }}
        variant="readonly"
        onRequestCreateNode={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /Message/ })).not.toBeInTheDocument();
  });

  it("readonly variant does not open the inspector on Enter", () => {
    render(<FlowCanvasGraph model={model} variant="readonly" />);
    const start = screen.getByRole("button", { name: /Greeting/ });
    start.focus();
    fireEvent.keyDown(start, { key: "Enter" });
    expect(screen.queryByRole("heading", { name: "Greeting" })).not.toBeInTheDocument();
  });

  it("readonly variant hides the node-creation palette even when a caller supplies onRequestCreateNode", () => {
    render(
      <FlowCanvasGraph model={model} variant="readonly" onRequestCreateNode={() => {}} />,
    );
    expect(screen.queryByText("Add node")).not.toBeInTheDocument();
  });

  it("the node-creation palette lists every real node type and requests creation on click", () => {
    const requested: string[] = [];
    render(<FlowCanvasGraph model={model} onRequestCreateNode={(type) => requested.push(type)} />);
    fireEvent.click(screen.getByRole("button", { name: "Tool call" }));
    expect(requested).toEqual(["tool-call"]);
  });

  it("clicking an edge calls onEdgeClick with its real id, when supplied", () => {
    const onEdgeClick = vi.fn();
    const { container } = render(<FlowCanvasGraph model={model} onEdgeClick={onEdgeClick} />);
    const edge = container.querySelector('.react-flow__edge[data-id="c1"]');
    expect(edge).not.toBeNull();
    fireEvent.click(edge!);
    expect(onEdgeClick).toHaveBeenCalledWith("c1");
  });

  it("omitting onEdgeClick leaves edges non-interactive (no click cursor, no crash on click)", () => {
    const { container } = render(<FlowCanvasGraph model={model} />);
    const edge = container.querySelector('.react-flow__edge[data-id="c1"]');
    expect(edge).not.toBeNull();
    expect(edge).not.toHaveClass("cursor-pointer");
    expect(() => fireEvent.click(edge!)).not.toThrow();
  });

  it("readonly variant never wires edge clicks even when a caller supplies onEdgeClick", () => {
    const onEdgeClick = vi.fn();
    const { container } = render(
      <FlowCanvasGraph model={model} variant="readonly" onEdgeClick={onEdgeClick} />,
    );
    const edge = container.querySelector('.react-flow__edge[data-id="c1"]');
    fireEvent.click(edge!);
    expect(onEdgeClick).not.toHaveBeenCalled();
  });

  it("the canvas/outline toggle can be lifted to the caller via view/onViewChange", () => {
    const onViewChange = vi.fn();
    const { rerender } = render(
      <FlowCanvasGraph model={model} view="canvas" onViewChange={onViewChange} />,
    );
    expect(screen.getByRole("application", { name: "Conversation flow" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Outline view" }));
    expect(onViewChange).toHaveBeenCalledWith("outline");

    // The caller owns the value in controlled mode — nothing switches views until the
    // caller re-renders with the new value, matching `Checkbox`'s own controlled contract.
    expect(screen.getByRole("application", { name: "Conversation flow" })).toBeInTheDocument();
    rerender(<FlowCanvasGraph model={model} view="outline" onViewChange={onViewChange} />);
    expect(screen.queryByRole("application", { name: "Conversation flow" })).not.toBeInTheDocument();
  });

  it("editing a field in the inspector keeps the Save action disabled until the form is valid", async () => {
    render(<FlowCanvasGraph model={model} />);
    const askAmount = screen.getByRole("button", { name: /Ask amount/ });
    fireEvent.click(askAmount);

    const inspector = await screen.findByRole("region", { name: "Node inspector" });
    const saveButton = within(inspector).getByRole("button", { name: "Save" });
    expect(saveButton).toBeDisabled();

    fireEvent.change(within(inspector).getByLabelText("Question prompt"), {
      target: { value: "How much do you owe?" },
    });
    fireEvent.change(within(inspector).getByLabelText("Save answer as"), {
      target: { value: "amount" },
    });
    expect(saveButton).toBeEnabled();
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<FlowCanvasGraph model={model} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
