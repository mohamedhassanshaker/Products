import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { Spinner } from "./spinner";

describe("Spinner", () => {
  it("renders an indeterminate glyph, decorative by default", () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg?.getAttribute("class")).toContain("shj3-animate-spin");
  });

  it("never mirrors under RTL — the rotation direction is not a directional icon", () => {
    const { container } = render(
      <div dir="rtl">
        <Spinner />
      </div>,
    );
    expect(container.querySelector("svg")?.getAttribute("class") ?? "").not.toContain(
      "rtl:-scale-x-100",
    );
  });

  it("exposes an accessible name via role=img when a label is given", () => {
    const { container } = render(<Spinner label="Loading results" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute("aria-label", "Loading results");
  });

  it("maps xs/sm/md sizes to the underlying Icon's numeric size prop", () => {
    const { container: xs } = render(<Spinner size="xs" />);
    const { container: md } = render(<Spinner size="md" />);
    expect(xs.querySelector("svg")).toHaveAttribute("width", "14");
    expect(md.querySelector("svg")).toHaveAttribute("width", "20");
  });

  it("has zero axe violations", async () => {
    const { container } = render(<Spinner label="Loading" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
