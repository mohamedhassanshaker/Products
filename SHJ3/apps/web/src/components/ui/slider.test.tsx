import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { Slider } from "./slider";

afterEach(() => {
  document.documentElement.dir = "";
});

describe("Slider", () => {
  it("renders a single thumb with the given value and a visible, always-present numeric label (not tooltip-only)", () => {
    render(<Slider aria-label="Hybrid weighting" value={70} />);
    const thumb = screen.getByRole("slider", { name: "Hybrid weighting" });
    expect(thumb).toHaveAttribute("aria-valuenow", "70");
    expect(thumb).toHaveAttribute("aria-valuemin", "0");
    expect(thumb).toHaveAttribute("aria-valuemax", "100");
    // §5.4 #28: "must be readable, not a tooltip-only value" — real visible
    // text, present with zero interaction, not revealed only on hover/drag.
    expect(screen.getByText("70")).toBeInTheDocument();
  });

  it("arrow-key stepping moves the value by `step` (Radix's own keyboard model, unmodified)", () => {
    const onValueChange = vi.fn();
    render(
      <Slider aria-label="Hybrid weighting" value={70} step={5} onValueChange={onValueChange} />,
    );
    const thumb = screen.getByRole("slider", { name: "Hybrid weighting" });
    thumb.focus();
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(onValueChange).toHaveBeenCalledWith(75);
  });

  it("Home/End jump to min/max", () => {
    const onValueChange = vi.fn();
    render(
      <Slider
        aria-label="Hybrid weighting"
        value={70}
        min={0}
        max={100}
        onValueChange={onValueChange}
      />,
    );
    const thumb = screen.getByRole("slider", { name: "Hybrid weighting" });
    thumb.focus();
    fireEvent.keyDown(thumb, { key: "End" });
    expect(onValueChange).toHaveBeenCalledWith(100);
    fireEvent.keyDown(thumb, { key: "Home" });
    expect(onValueChange).toHaveBeenCalledWith(0);
  });

  it("range variant renders two independently labelled thumbs and a combined label", () => {
    render(<Slider variant="range" thumbAriaLabels={["Minimum", "Maximum"]} value={[20, 80]} />);
    expect(screen.getByRole("slider", { name: "Minimum" })).toHaveAttribute("aria-valuenow", "20");
    expect(screen.getByRole("slider", { name: "Maximum" })).toHaveAttribute("aria-valuenow", "80");
    expect(screen.getByText("20 – 80")).toBeInTheDocument();
  });

  it("a formatValue override renders in the visible label and aria-valuetext", () => {
    render(
      <Slider
        aria-label="Hybrid weighting"
        value={60}
        formatValue={(v) => `${v}% graph / ${100 - v}% vector`}
      />,
    );
    expect(screen.getByText("60% graph / 40% vector")).toBeInTheDocument();
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "60% graph / 40% vector");
  });

  it("disabled removes the thumb from the tab order", () => {
    render(<Slider aria-label="Hybrid weighting" value={70} disabled />);
    expect(screen.getByRole("slider")).not.toHaveAttribute("tabindex", "0");
  });

  describe("RTL fill position — real resolved inline style, independently re-verified the same way switch.test.tsx and progress-bar.test.tsx do", () => {
    // For a single-thumb Slider, Radix's own SliderRange always sets BOTH
    // `left` and `right` (confirmed by reading its compiled source: a single
    // value gives `offsetStart = 0`, `offsetEnd = 100 - percent`) — the fill
    // spans from one track edge to the thumb, so both boundaries are always
    // present. What actually flips under RTL is *which physical property*
    // each offset lands on (`orientation.startEdge`/`endEdge` swap), not
    // whether one is empty — value=30 gives offsets 0% / 70%.
    it("under an LTR document, the 0% offset lands on `left` and the 70% remainder lands on `right`", () => {
      document.documentElement.dir = "ltr";
      const { container } = render(
        <Slider aria-label="Hybrid weighting" value={30} min={0} max={100} />,
      );
      const range = container.querySelector(".bg-primary") as HTMLElement;
      expect(range.style.left).toBe("0%");
      expect(range.style.right).toBe("70%");
    });

    it("once the ambient <html dir> is rtl, the identical value swaps which physical property carries which offset — proof the dir prop actually reaches Radix, not just that a prop was passed", () => {
      document.documentElement.dir = "rtl";
      const { container } = render(
        <Slider aria-label="Hybrid weighting" value={30} min={0} max={100} />,
      );
      const range = container.querySelector(".bg-primary") as HTMLElement;
      expect(range.style.right).toBe("0%");
      expect(range.style.left).toBe("70%");
    });
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<Slider aria-label="Hybrid weighting" value={70} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
