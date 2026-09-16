import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { Card, CardContent, CardDisclosure, CardFooter, CardHeader, CardTitle } from "./card";
import { Badge } from "./badge";

describe("Card", () => {
  it("renders a title at the given heading level, a badge, and body content", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle level={2}>SEWA bill lookup</CardTitle>
          <Badge variant="success" label="Published" />
        </CardHeader>
        <CardContent>v1.4 · SEWA · 412/day</CardContent>
      </Card>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "SEWA bill lookup" })).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByText("v1.4 · SEWA · 412/day")).toBeInTheDocument();
  });

  it("renders footer actions", () => {
    render(
      <Card>
        <CardFooter>
          <button type="button">Archive</button>
        </CardFooter>
      </Card>,
    );
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("variant=interactive renders as the real <a> the caller supplies via asChild, never a div with onClick", () => {
    render(
      <Card variant="interactive" asChild>
        <a href="/agents/123">General FAQ Agent</a>
      </Card>,
    );
    const link = screen.getByRole("link", { name: "General FAQ Agent" });
    expect(link).toHaveAttribute("href", "/agents/123");
    expect(link).toHaveAttribute("data-slot", "card");
  });

  it("loading replaces children with a fixed-height skeleton", () => {
    render(
      <Card loading>
        <CardTitle level={2}>Should not render</CardTitle>
      </Card>,
    );
    expect(screen.queryByText("Should not render")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
  });

  it("error replaces children with an alert message instead of a stale record", () => {
    render(
      <Card error="Could not load this record">
        <CardTitle level={2}>Should not render</CardTitle>
      </Card>,
    );
    expect(screen.queryByText("Should not render")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this record");
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(
      <Card>
        <CardHeader>
          <CardTitle level={2}>Agent</CardTitle>
        </CardHeader>
      </Card>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("CardDisclosure", () => {
  it("toggles its content and aria-expanded on click, wired via aria-controls", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <CardDisclosure label="Version history" open={false} onOpenChange={onOpenChange}>
        <p>v1.3 · Rolled back</p>
      </CardDisclosure>,
    );
    const trigger = screen.getByRole("button", { name: "Version history" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("v1.3 · Rolled back")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(true);

    rerender(
      <CardDisclosure label="Version history" open onOpenChange={onOpenChange}>
        <p>v1.3 · Rolled back</p>
      </CardDisclosure>,
    );
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const content = screen.getByText("v1.3 · Rolled back");
    expect(trigger.getAttribute("aria-controls")).toBe(content.parentElement?.id);
  });
});

/**
 * §5.4: `<Card variant="interactive">` with no `asChild` must not type-check
 * — the mechanical form of "interactive cards are `<a>` or `<button>`, never
 * a `div` with `onClick`". Never called; its only job is to fail `tsc` if the
 * `@ts-expect-error` stops being necessary.
 */
function typeLevelProofInteractiveRequiresAsChild() {
  // @ts-expect-error - variant="interactive" requires asChild: true.
  return <Card variant="interactive">no asChild</Card>;
}
void typeLevelProofInteractiveRequiresAsChild;
