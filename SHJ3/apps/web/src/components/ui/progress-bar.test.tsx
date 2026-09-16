import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { ProgressBar } from "./progress-bar";

describe("ProgressBar", () => {
  it("determinate: exposes role=progressbar + aria-valuenow AND a visible numeric label", () => {
    render(<ProgressBar value={70} locale="en" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "70");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    // §5.3 #12: "must be readable, not inferred from bar length" — real text,
    // not only an ARIA attribute.
    expect(screen.getByText("70%")).toBeInTheDocument();
  });

  it("indeterminate: has no aria-valuenow (Radix's own indeterminate contract)", () => {
    render(<ProgressBar variant="indeterminate" label="Loading" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });

  it("segmented: renders a stepper-plausible segments shape as role=progressbar with N children", () => {
    const { container } = render(
      <ProgressBar variant="segmented" segments={{ total: 4, completed: 2 }} />,
    );
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "4");
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(
      container.querySelectorAll('[data-slot="progress-bar"] [aria-hidden="true"]'),
    ).toHaveLength(4);
    expect(screen.getByText("2/4")).toBeInTheDocument();
  });

  it("a caller-supplied label overrides the computed default", () => {
    render(<ProgressBar value={70} label="70% indexed" />);
    expect(screen.getByText("70% indexed")).toBeInTheDocument();
    expect(screen.queryByText("70%")).not.toBeInTheDocument();
  });

  describe("RTL correctness of the fill (§5.3 #12 — fills from inline-start, must genuinely mirror)", () => {
    it("positions the fill with logical inset-inline-start/inline-size, never a physical left/right, under an LTR ancestor", () => {
      const { container } = render(
        <div dir="ltr">
          <ProgressBar value={30} />
        </div>,
      );
      const indicator = container.querySelector(
        '[data-slot="progress-bar-indicator"]',
      ) as HTMLElement;
      expect(indicator.style.insetInlineStart).toBe("0px");
      expect(indicator.style.inlineSize).toBe("30%");
      expect(indicator.style.left).toBe("");
      expect(indicator.style.right).toBe("");
    });

    it("uses the identical logical-property mechanism under a RTL ancestor — no physical left/right sneaks in", () => {
      const { container } = render(
        <div dir="rtl">
          <ProgressBar value={30} />
        </div>,
      );
      const indicator = container.querySelector(
        '[data-slot="progress-bar-indicator"]',
      ) as HTMLElement;
      // The component never branches on ambient `dir` in JS — it always
      // writes the same logical property, and it is the browser's CSS engine
      // (inset-inline-start resolves against computed `direction`) that
      // actually flips the *visual* edge between this render and the LTR one
      // above. Asserting the mechanism is what a jsdom unit test can prove;
      // the visual result is a real-browser/visual-regression concern
      // (design-system.md §12.5), out of scope for this suite.
      expect(indicator.style.insetInlineStart).toBe("0px");
      expect(indicator.style.inlineSize).toBe("30%");
      expect(indicator.style.left).toBe("");
      expect(indicator.style.right).toBe("");
    });
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<ProgressBar value={70} locale="en" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
