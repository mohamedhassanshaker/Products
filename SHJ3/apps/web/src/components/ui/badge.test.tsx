import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { CircleCheck } from "lucide-react";
import { Badge } from "./badge";

describe("Badge", () => {
  it("renders its required label as visible text", () => {
    render(<Badge variant="success" label="Healthy" />);
    expect(screen.getByText("Healthy")).toBeInTheDocument();
  });

  it("renders every status family from the vocabulary (§6.2)", () => {
    const { rerender } = render(<Badge variant="success" label="Active" />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    rerender(<Badge variant="warning" label="Draft" />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
    rerender(<Badge variant="destructive" label="Failed" />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    rerender(<Badge variant="info" label="Locked" />);
    expect(screen.getByText("Locked")).toBeInTheDocument();
    rerender(<Badge variant="neutral" label="Archived" />);
    expect(screen.getByText("Archived")).toBeInTheDocument();
    rerender(<Badge variant="outline" label="Untouched" />);
    expect(screen.getByText("Untouched")).toBeInTheDocument();
  });

  it("renders an optional leading icon as a second, decorative, non-colour channel", () => {
    const { container } = render(
      <Badge variant="success" label="Healthy" icon={<CircleCheck aria-hidden="true" />} />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<Badge variant="success" label="Healthy" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

/**
 * §6.1 made mechanical: `<Badge variant="success" />` with no text must not
 * type-check. `label` is a required prop with no children-based escape
 * hatch, proven at compile time — never called, its only job is to fail
 * `tsc` if the `@ts-expect-error` stops being necessary.
 */
function typeLevelProofLabelIsRequired() {
  // @ts-expect-error - label is required; omitting it must not type-check.
  return <Badge variant="success" />;
}
void typeLevelProofLabelIsRequired;
