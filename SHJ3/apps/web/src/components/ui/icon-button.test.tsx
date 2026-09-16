import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Star } from "lucide-react";
import { IconButton } from "./icon-button";

describe("IconButton", () => {
  it("renders in its default state, accessibly named by the required ariaLabel", () => {
    render(
      <IconButton ariaLabel="Add to favourites">
        <Star />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Add to favourites" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("type", "button");
  });

  it("fires onClick when enabled", () => {
    const onClick = vi.fn();
    render(
      <IconButton ariaLabel="Delete" onClick={onClick}>
        <Star />
      </IconButton>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("supports toggle usage via aria-pressed", () => {
    const { rerender } = render(
      <IconButton ariaLabel="Mute microphone" pressed={false}>
        <Star />
      </IconButton>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
    rerender(
      <IconButton ariaLabel="Mute microphone" pressed>
        <Star />
      </IconButton>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a spinner, sets aria-busy, and stays inert while loading", () => {
    const onClick = vi.fn();
    const { container } = render(
      <IconButton ariaLabel="Refresh" onClick={onClick} loading>
        <Star />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Refresh" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    expect(container.querySelector("svg")).toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(
      <IconButton ariaLabel="Close panel">
        <Star />
      </IconButton>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

/**
 * §5.3 #2: `ariaLabel` is required, not optional — a caller who omits it
 * must get a compile error, not a runtime a11y gap. This is a type-level
 * guarantee, so it is proven at compile time rather than at runtime (the
 * brief's own stated bar for this and `Badge.label`). Never called — its
 * only job is to fail `tsc` if the `@ts-expect-error` stops being necessary.
 */
function typeLevelProofAriaLabelIsRequired() {
  // @ts-expect-error - ariaLabel is required; omitting it must not type-check.
  return <IconButton>{null}</IconButton>;
}
void typeLevelProofAriaLabelIsRequired;
