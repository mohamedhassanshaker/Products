import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Checkbox } from "./checkbox";

describe("Checkbox", () => {
  it("renders unchecked by default", () => {
    render(<Checkbox aria-label="Accept terms" />);
    const checkbox = screen.getByRole("checkbox", { name: "Accept terms" });
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).toHaveAttribute("aria-checked", "false");
  });

  it("toggles on click and reports the new value via onCheckedChange", () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="Accept terms" onCheckedChange={onCheckedChange} />);
    const checkbox = screen.getByRole("checkbox", { name: "Accept terms" });
    fireEvent.click(checkbox);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(checkbox).toHaveAttribute("aria-checked", "true");
  });

  it("supports a controlled checked value", () => {
    const { rerender } = render(
      <Checkbox aria-label="Selected" checked={false} onCheckedChange={() => {}} />,
    );
    expect(screen.getByRole("checkbox", { name: "Selected" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    rerender(<Checkbox aria-label="Selected" checked={true} onCheckedChange={() => {}} />);
    expect(screen.getByRole("checkbox", { name: "Selected" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("renders the indeterminate state with a distinct glyph and aria-checked=mixed", () => {
    const { container } = render(
      <Checkbox aria-label="Select all" checked="indeterminate" onCheckedChange={() => {}} />,
    );
    const checkbox = screen.getByRole("checkbox", { name: "Select all" });
    expect(checkbox).toHaveAttribute("aria-checked", "mixed");
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("disables the control natively when disabled", () => {
    render(<Checkbox aria-label="Locked option" disabled />);
    expect(screen.getByRole("checkbox", { name: "Locked option" })).toBeDisabled();
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<Checkbox aria-label="Accept terms" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
