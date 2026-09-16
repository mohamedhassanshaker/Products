import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { SelectablePill } from "./selectable-pill";

describe("SelectablePill", () => {
  it("renders unchecked by default with its label visible", () => {
    render(
      <SelectablePill variant="multi" checked={false} onCheckedChange={vi.fn()}>
        Friendly
      </SelectablePill>,
    );
    const input = screen.getByRole("checkbox", { name: "Friendly" });
    expect(input).toBeInTheDocument();
    expect(input).not.toBeChecked();
  });

  it("is backed by a real, focusable input — not display:none/visibility:hidden — so it stays in the tab order", () => {
    render(
      <SelectablePill variant="multi" checked={false} onCheckedChange={vi.fn()}>
        Friendly
      </SelectablePill>,
    );
    const input = screen.getByRole("checkbox", { name: "Friendly" });
    expect(input.className).toMatch(/\bsr-only\b/);
    input.focus();
    expect(input).toHaveFocus();
  });

  it("multi variant: toggles independently via a real checkbox input", () => {
    const onCheckedChange = vi.fn();
    render(
      <SelectablePill variant="multi" checked={false} onCheckedChange={onCheckedChange}>
        Friendly
      </SelectablePill>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Friendly" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("single variant: real radio-group semantics — selecting one clears the others sharing a name", () => {
    function ToneGroup() {
      const [tone, setTone] = React.useState("formal");
      const options = ["formal", "friendly", "concise"];
      return (
        <>
          {options.map((option) => (
            <SelectablePill
              key={option}
              variant="single"
              name="tone"
              value={option}
              checked={tone === option}
              onCheckedChange={() => setTone(option)}
            >
              {option}
            </SelectablePill>
          ))}
        </>
      );
    }
    render(<ToneGroup />);
    expect(screen.getByRole("radio", { name: "formal" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "friendly" }));
    expect(screen.getByRole("radio", { name: "friendly" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "formal" })).not.toBeChecked();
  });

  it("renders the check glyph as a non-colour marker of selection, not colour alone", () => {
    const { container, rerender } = render(
      <SelectablePill variant="multi" checked={false} onCheckedChange={vi.fn()}>
        Friendly
      </SelectablePill>,
    );
    expect(container.querySelector("svg")).not.toBeInTheDocument();
    rerender(
      <SelectablePill variant="multi" checked onCheckedChange={vi.fn()}>
        Friendly
      </SelectablePill>,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("disables the input natively when disabled", () => {
    render(
      <SelectablePill variant="multi" checked={false} onCheckedChange={vi.fn()} disabled>
        Friendly
      </SelectablePill>,
    );
    expect(screen.getByRole("checkbox", { name: "Friendly" })).toBeDisabled();
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(
      <SelectablePill variant="multi" checked={false} onCheckedChange={vi.fn()}>
        Friendly
      </SelectablePill>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
