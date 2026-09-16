import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Button } from "./button";

describe("Button", () => {
  it("renders in its default state as a real <button> with an explicit type", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeInTheDocument();
    // Never an implicit "submit" — design-system.md §5.3 #1.
    expect(button).toHaveAttribute("type", "button");
  });

  it("fires onClick when enabled", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Continue</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not fire onClick and reports disabled when disabled", () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Continue
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Continue" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows a spinner, sets aria-busy, retains the label, and stays inert while loading", () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button onClick={onClick} loading>
        Publishing
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Publishing" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    // The label text itself is retained (§5.2: "label retained").
    expect(button).toHaveTextContent("Publishing");
    expect(container.querySelector("svg")).toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<Button>Save changes</Button>);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has zero axe violations when disabled", async () => {
    const { container } = render(<Button disabled>Save changes</Button>);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("asChild renders the child element in place of a <button>, without throwing", () => {
    // Regression test: B-3's live-infrastructure proof found this is the app's first-ever
    // real `asChild` consumer (`agents-screen.tsx`'s "New agent" link) and it 500'd every
    // real request — Radix `Slot.Root` throws ("Slot failed to slot onto its children")
    // unless the element it should merge props onto is wrapped in `Slot.Slottable`, and this
    // component's icon-start/label/icon-end children shape always gave it three children,
    // never one. No test exercised `asChild` before this, which is exactly how it shipped.
    render(
      <Button asChild>
        <a href="/somewhere">Go</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Go" });
    expect(link).toBeInTheDocument();
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/somewhere");
    // Slot merges Button's own props onto the child — the styling/data attributes really
    // landed on the <a>, not on some wrapper element.
    expect(link).toHaveAttribute("data-slot", "button");
  });

  it("asChild plus iconStart/iconEnd still renders exactly one child element with no crash", () => {
    render(
      <Button asChild iconStart={<span data-testid="start" />} iconEnd={<span data-testid="end" />}>
        <a href="/somewhere">Go</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Go" });
    expect(link).toBeInTheDocument();
    // The icon siblings render as real DOM siblings inside the slotted element.
    expect(screen.getByTestId("start")).toBeInTheDocument();
    expect(screen.getByTestId("end")).toBeInTheDocument();
  });
});
