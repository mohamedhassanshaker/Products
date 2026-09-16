import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Textarea } from "./textarea";

describe("Textarea", () => {
  it("renders in its default state and accepts typed input", () => {
    const onChange = vi.fn();
    render(<Textarea aria-label="System prompt" onChange={onChange} />);
    const textarea = screen.getByRole("textbox", { name: "System prompt" });
    fireEvent.change(textarea, { target: { value: "You are a helpful assistant." } });
    expect(onChange).toHaveBeenCalledOnce();
    expect(textarea).toHaveValue("You are a helpful assistant.");
  });

  it("is always dir=auto, unlike Input's mono variant, so per-field content decides its own direction", () => {
    render(<Textarea aria-label="System prompt" />);
    expect(screen.getByRole("textbox", { name: "System prompt" })).toHaveAttribute("dir", "auto");
  });

  it("applies field-sizing-content only for the auto-grow variant", () => {
    const { rerender } = render(<Textarea aria-label="Notes" variant="default" />);
    expect(screen.getByRole("textbox", { name: "Notes" }).className).not.toMatch(
      /field-sizing-content/,
    );
    rerender(<Textarea aria-label="Notes" variant="auto-grow" />);
    expect(screen.getByRole("textbox", { name: "Notes" }).className).toMatch(
      /field-sizing-content/,
    );
  });

  it("disables the field natively when disabled", () => {
    render(<Textarea aria-label="Locked notes" disabled />);
    expect(screen.getByRole("textbox", { name: "Locked notes" })).toBeDisabled();
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<Textarea aria-label="Change summary" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
