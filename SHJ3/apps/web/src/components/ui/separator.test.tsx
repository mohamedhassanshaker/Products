import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { Separator } from "./separator";

describe("Separator", () => {
  it("is decorative (role=none, no separator role) by default", () => {
    const { container } = render(<Separator />);
    const el = container.querySelector('[data-slot="separator"]');
    // Radix's own decorative contract (confirmed by reading
    // @radix-ui/react-separator's source): `role="none"`, not `aria-hidden`
    // — both remove the element from the accessibility tree, but `role`
    // is what this primitive actually emits.
    expect(el).toHaveAttribute("role", "none");
  });

  it("renders a real role=separator when it separates semantically meaningful groups", () => {
    const { container } = render(<Separator decorative={false} />);
    expect(container.querySelector('[role="separator"]')).toBeInTheDocument();
  });

  it("applies the horizontal sizing classes by default", () => {
    const { container } = render(<Separator />);
    const el = container.querySelector('[data-slot="separator"]');
    expect(el?.getAttribute("class")).toContain("h-px");
    expect(el?.getAttribute("class")).toContain("w-full");
  });

  it("applies the vertical sizing classes for orientation=vertical", () => {
    const { container } = render(<Separator orientation="vertical" />);
    const el = container.querySelector('[data-slot="separator"]');
    expect(el?.getAttribute("class")).toContain("h-full");
    expect(el?.getAttribute("class")).toContain("w-px");
  });

  it("has zero axe violations", async () => {
    const { container } = render(
      <div>
        <span>Section A</span>
        <Separator decorative={false} />
        <span>Section B</span>
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
