import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  it("marks its region aria-busy so a screen reader knows content is loading", () => {
    const { container } = render(<Skeleton />);
    expect(container.querySelector('[data-slot="skeleton"]')).toHaveAttribute("aria-busy", "true");
  });

  it("applies the shimmer animation class, token-driven (packages/tokens' --animate-* gap workaround)", () => {
    const { container } = render(<Skeleton />);
    expect(container.querySelector('[data-slot="skeleton"]')?.getAttribute("class")).toContain(
      "shj3-animate-shimmer",
    );
  });

  it.each([
    ["text", "h-4"],
    ["block", "rounded-md"],
    ["circle", "rounded-full"],
  ] as const)("variant=%s applies its expected shape class", (variant, expectedClass) => {
    const { container } = render(<Skeleton variant={variant} />);
    expect(container.querySelector('[data-slot="skeleton"]')?.getAttribute("class")).toContain(
      expectedClass,
    );
  });

  it("variant=row sizes itself from the shared --table-row-height component token", () => {
    const { container } = render(<Skeleton variant="row" />);
    const el = container.querySelector('[data-slot="skeleton"]') as HTMLElement;
    expect(el.style.blockSize).toBe("var(--table-row-height)");
  });

  it("has zero axe violations", async () => {
    const { container } = render(<Skeleton variant="text" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
