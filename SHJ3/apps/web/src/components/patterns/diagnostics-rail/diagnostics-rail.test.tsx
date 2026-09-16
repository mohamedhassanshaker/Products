import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Direction } from "radix-ui";
import { axe } from "jest-axe";
import { DiagnosticsRail } from "./diagnostics-rail";

/**
 * Radix `Tabs.Trigger` activates on `onMouseDown`, not `onClick` — confirmed
 * by reading `@radix-ui/react-tabs`'s compiled source directly (its
 * `onMouseDown` handler is what calls `context.onValueChange(value)`; there
 * is no `onClick` activation handler at all). The same class of gotcha
 * `dropdown-menu.test.tsx`'s own `openMenu` helper documents for a different
 * Radix primitive (`pointerdown` there); a bare `fireEvent.click` never
 * dispatches a `mousedown` on its own, so it silently never switches tabs.
 */
function clickTab(tab: HTMLElement) {
  fireEvent.mouseDown(tab, { button: 0 });
}

function renderRail(wrapper?: (children: React.ReactNode) => React.ReactElement) {
  const content = (
    <DiagnosticsRail
      trace={<p>Routing decision: router → billing_agent (confidence 0.94)</p>}
      grounding={<p>SEWA tariff schedule · updated 3 days ago</p>}
    />
  );
  return render(wrapper ? wrapper(content) : content);
}

describe("DiagnosticsRail", () => {
  it("renders both tabs and shows the trace panel by default", () => {
    renderRail();
    expect(screen.getByRole("tab", { name: "Agent trace" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByText("Routing decision: router → billing_agent (confidence 0.94)"),
    ).toBeInTheDocument();
  });

  it("switching to the Sources tab shows the grounding panel", async () => {
    renderRail();
    clickTab(screen.getByRole("tab", { name: "Sources" }));
    expect(
      await screen.findByText("SEWA tariff schedule · updated 3 days ago"),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sources" })).toHaveAttribute("aria-selected", "true");
  });

  it("is a controlled component when value/onValueChange are supplied", () => {
    const onValueChange = vi.fn();
    render(
      <DiagnosticsRail
        trace={<p>Trace</p>}
        grounding={<p>Grounding</p>}
        value="grounding"
        onValueChange={onValueChange}
      />,
    );
    expect(screen.getByRole("tab", { name: "Sources" })).toHaveAttribute("aria-selected", "true");
    clickTab(screen.getByRole("tab", { name: "Agent trace" }));
    expect(onValueChange).toHaveBeenCalledWith("trace");
  });

  it("accepts caller-supplied labels instead of the English defaults", () => {
    render(
      <DiagnosticsRail
        trace={<p>Trace</p>}
        grounding={<p>Grounding</p>}
        traceLabel="أثر الوكيل"
        groundingLabel="المصادر"
        aria-label="التشخيص"
      />,
    );
    expect(screen.getByRole("tablist", { name: "التشخيص" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "أثر الوكيل" })).toBeInTheDocument();
  });

  describe("root DirectionProvider wiring (Task 1) — real @radix-ui/react-direction context, not this app's own useResolvedDir()", () => {
    it("with no DirectionProvider in the tree, Tabs.Root resolves and renders dir=ltr", () => {
      renderRail();
      const tablist = screen.getByRole("tablist");
      // `Tabs.Root` renders the *resolved* direction as a real `dir`
      // attribute on its own DOM node (confirmed by reading
      // @radix-ui/react-tabs's compiled source — see the component's module
      // doc comment) — the tablist is `Tabs.Root`'s own child carrying the
      // ancestor's native `dir`, so asserting via `closest` on the rendered
      // root is the direct, no-inference check.
      expect(tablist.closest("[dir]")).toHaveAttribute("dir", "ltr");
    });

    it("wrapped in a real Direction.Provider dir='rtl', Tabs.Root resolves and renders dir=rtl — with no dir prop passed anywhere in this component", () => {
      renderRail((children) => <Direction.Provider dir="rtl">{children}</Direction.Provider>);
      const tablist = screen.getByRole("tablist");
      expect(tablist.closest("[dir]")).toHaveAttribute("dir", "rtl");
    });

    it('behaviourally: under a real RTL DirectionProvider, ArrowRight (="previous" under rtl) from the first tab is a no-op with loop disabled', async () => {
      renderRail((children) => <Direction.Provider dir="rtl">{children}</Direction.Provider>);
      const traceTab = screen.getByRole("tab", { name: "Agent trace" });
      traceTab.focus();
      expect(traceTab).toHaveFocus();
      fireEvent.keyDown(traceTab, { key: "ArrowRight" });
      // Give any (incorrect) focus move a tick to happen before asserting
      // the negative — waitFor's own retry loop would otherwise pass on the
      // very first (still-correct) sample and hide a delayed regression.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(traceTab).toHaveFocus();
    });

    it("behaviourally: the identical ArrowRight keypress moves focus forward under the default LTR resolution — proving the two resolutions genuinely diverge, not just the attribute", async () => {
      renderRail();
      const traceTab = screen.getByRole("tab", { name: "Agent trace" });
      const groundingTab = screen.getByRole("tab", { name: "Sources" });
      traceTab.focus();
      fireEvent.keyDown(traceTab, { key: "ArrowRight" });
      await waitFor(() => expect(groundingTab).toHaveFocus());
    });
  });

  it("has zero axe violations", async () => {
    const { container } = renderRail();
    expect(await axe(container)).toHaveNoViolations();
  });
});
