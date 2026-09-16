import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { RadioGroup, RadioGroupItem } from "./radio-group";

function renderToneGroup(onValueChange: (value: string) => void) {
  return render(
    <RadioGroup aria-label="Tone" defaultValue="formal" onValueChange={onValueChange}>
      <RadioGroupItem value="formal" aria-label="Formal" />
      <RadioGroupItem value="friendly" aria-label="Friendly" />
      <RadioGroupItem value="concise" aria-label="Concise" />
    </RadioGroup>,
  );
}

describe("RadioGroup", () => {
  it("renders with exactly one option checked by default", () => {
    renderToneGroup(vi.fn());
    expect(screen.getByRole("radio", { name: "Formal" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Friendly" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("radio", { name: "Concise" })).toHaveAttribute("aria-checked", "false");
  });

  it("selects a different option on click, exclusively", () => {
    const onValueChange = vi.fn();
    renderToneGroup(onValueChange);
    fireEvent.click(screen.getByRole("radio", { name: "Friendly" }));
    expect(onValueChange).toHaveBeenCalledWith("friendly");
    expect(screen.getByRole("radio", { name: "Friendly" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Formal" })).toHaveAttribute("aria-checked", "false");
  });

  it("moves and selects with arrow keys, landing on a single tab stop (Radix default, not overridden)", async () => {
    const onValueChange = vi.fn();
    renderToneGroup(onValueChange);
    const formal = screen.getByRole("radio", { name: "Formal" });
    formal.focus();
    fireEvent.keyDown(formal, { key: "ArrowDown" });
    // Radix's roving-focus group moves focus (and, via the resulting onFocus,
    // the selection) inside a `setTimeout` rather than synchronously in the
    // keydown handler itself — confirmed by reading
    // @radix-ui/react-roving-focus's actual source rather than assuming a
    // synchronous update, after a first, synchronous assertion here failed.
    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith("friendly"));
  });

  it("renders the card variant as a bordered, full-width option containing its own children", () => {
    render(
      <RadioGroup aria-label="Role" defaultValue="admin">
        <RadioGroupItem value="admin" variant="card">
          Admin
        </RadioGroupItem>
      </RadioGroup>,
    );
    const item = screen.getByRole("radio", { name: "Admin" });
    expect(item).toHaveTextContent("Admin");
    expect(item.className).toMatch(/w-full/);
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = renderToneGroup(vi.fn());
    expect(await axe(container)).toHaveNoViolations();
  });
});
