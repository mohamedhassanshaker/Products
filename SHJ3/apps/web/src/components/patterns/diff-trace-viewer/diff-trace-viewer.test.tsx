import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { DiffTraceViewer } from "./diff-trace-viewer";
import { groupTraceSteps, type DiffLine, type TraceStep } from "./diff-trace-viewer-types";

const steps: TraceStep[] = [
  { id: "s1", primaryLine: "router → billing_agent", confidence: 0.94, status: "success" },
  {
    id: "s2",
    primaryLine: 'billing_agent.fetch_bill(account="123")',
    durationMs: 240,
    status: "success",
    payload: '{"account":"123","amount":412}',
  },
  { id: "s3", primaryLine: "guardrail.check_pii", status: "warning" },
];

describe("groupTraceSteps", () => {
  it("clusters consecutive steps sharing a parallelGroup, in order", () => {
    const parallel: TraceStep[] = [
      { id: "a", primaryLine: "a", parallelGroup: "fan-1" },
      { id: "b", primaryLine: "b", parallelGroup: "fan-1" },
      { id: "c", primaryLine: "c" },
    ];
    const groups = groupTraceSteps(parallel);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.steps.map((s) => s.id)).toEqual(["a", "b"]);
    expect(groups[1]?.steps.map((s) => s.id)).toEqual(["c"]);
  });

  it("does not merge steps sharing no group, or an undefined one", () => {
    const solo: TraceStep[] = [
      { id: "a", primaryLine: "a" },
      { id: "b", primaryLine: "b" },
    ];
    expect(groupTraceSteps(solo)).toHaveLength(2);
  });
});

describe("DiffTraceViewer (trace/orchestration/grounding)", () => {
  it("renders steps as a real <ol>, in order, structurally not just visually", () => {
    render(<DiffTraceViewer steps={steps} />);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("router → billing_agent");
  });

  it("confidence renders as text, never a bar-only representation", () => {
    render(<DiffTraceViewer steps={steps} />);
    expect(screen.getByText("confidence 0.94")).toBeInTheDocument();
  });

  it("an expandable step is a real button with aria-expanded, revealing its payload via CodeBlock", () => {
    render(<DiffTraceViewer steps={steps} />);
    const toggle = screen.getByRole("button", { name: "Show payload" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/"amount":412/)).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide payload" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText(/"amount":412/)).toBeInTheDocument();
  });

  it("orchestration variant clusters a parallelGroup into one fan-out entry", () => {
    const parallelSteps: TraceStep[] = [
      { id: "p1", primaryLine: "worker_a.run", parallelGroup: "fan-1" },
      { id: "p2", primaryLine: "worker_b.run", parallelGroup: "fan-1" },
    ];
    render(<DiffTraceViewer variant="orchestration" steps={parallelSteps} />);
    expect(screen.getByText("Ran in parallel (2)")).toBeInTheDocument();
    expect(screen.getByText("worker_a.run")).toBeInTheDocument();
    expect(screen.getByText("worker_b.run")).toBeInTheDocument();
  });

  it("streaming: appending a step announces ONLY the newest step in the live region, not the concatenation of all of them", () => {
    const { rerender } = render(
      <DiffTraceViewer state="streaming" steps={[steps[0]!]} aria-label="Live trace" />,
    );
    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveTextContent("router → billing_agent");

    rerender(
      <DiffTraceViewer state="streaming" steps={[steps[0]!, steps[1]!]} aria-label="Live trace" />,
    );
    // The single latest step only — the first step's text must NOT also be
    // present, which is exactly what "announces the whole list" would produce.
    expect(liveRegion).toHaveTextContent('billing_agent.fetch_bill(account="123")');
    expect(liveRegion).not.toHaveTextContent("router → billing_agent");

    rerender(
      <DiffTraceViewer
        state="streaming"
        steps={[steps[0]!, steps[1]!, steps[2]!]}
        aria-label="Live trace"
      />,
    );
    expect(liveRegion).toHaveTextContent("guardrail.check_pii");
    expect(liveRegion).not.toHaveTextContent("router → billing_agent");
    expect(liveRegion).not.toHaveTextContent('billing_agent.fetch_bill(account="123")');
  });

  it("empty state renders a real, meaningful EmptyState, not a blank region", () => {
    render(
      <DiffTraceViewer
        steps={[]}
        emptyHeadline="No grounding needed"
        emptyCause="Static template."
      />,
    );
    expect(screen.getByText("No grounding needed")).toBeInTheDocument();
  });

  it("error state renders role=alert with the message", () => {
    render(<DiffTraceViewer steps={steps} state="error" errorMessage="Trace fetch failed" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Trace fetch failed");
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<DiffTraceViewer steps={steps} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("DiffTraceViewer (diff)", () => {
  const lines: DiffLine[] = [
    { id: "l1", kind: "unchanged", text: 'model: "gpt-4"' },
    { id: "l2", kind: "removed", text: "temperature: 0.9" },
    { id: "l3", kind: "added", text: "temperature: 0.4" },
  ];

  it("renders added/removed lines with <ins>/<del> plus a gutter marker — never fill colour alone", () => {
    const { container } = render(<DiffTraceViewer variant="diff" lines={lines} />);
    const ins = container.querySelector("ins");
    const del = container.querySelector("del");
    expect(ins).toHaveTextContent("temperature: 0.4");
    expect(del).toHaveTextContent("temperature: 0.9");
    // The gutter marker text is present independent of the fill colour.
    expect(screen.getByText("+")).toBeInTheDocument();
    expect(screen.getByText("−")).toBeInTheDocument();
  });

  it("has zero axe violations in diff mode", async () => {
    const { container } = render(<DiffTraceViewer variant="diff" lines={lines} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
