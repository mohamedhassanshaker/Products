import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { ChevronRight, Check } from "lucide-react";
import { Icon, MIRROR_IN_RTL_ICONS } from "./icon";

describe("Icon", () => {
  it("renders the given lucide icon, aria-hidden by default", () => {
    const { container } = render(<Icon icon={ChevronRight} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");
  });

  it("renders currentColor only — IconProps has no color/fill/stroke override to give it anything else", () => {
    const { container } = render(<Icon icon={ChevronRight} />);
    const svg = container.querySelector("svg");
    // lucide's own default, unreachable-by-override since `color` is not
    // part of this component's public prop type at all (icon.tsx).
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg).toHaveAttribute("fill", "none");
  });

  it("exposes role=img + aria-label instead of aria-hidden when given a `label`", () => {
    const { container } = render(<Icon icon={ChevronRight} label="Next page" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute("aria-label", "Next page");
    expect(svg).not.toHaveAttribute("aria-hidden");
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<Icon icon={ChevronRight} label="Next page" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  describe("RTL mirroring allowlist", () => {
    it("MIRROR_IN_RTL_ICONS names ChevronRight (directional) but not Check (a glyph, never mirrored)", () => {
      expect(MIRROR_IN_RTL_ICONS.has("ChevronRight")).toBe(true);
      expect(MIRROR_IN_RTL_ICONS.has("Check")).toBe(false);
    });

    it('applies the rtl mirror class for an allowlisted icon rendered inside a dir="rtl" ancestor', () => {
      const { container } = render(
        <div dir="rtl">
          <Icon icon={ChevronRight} />
        </div>,
      );
      const svg = container.querySelector("svg");
      // `rtl:-scale-x-100` only ever resolves visually under a `dir="rtl"`
      // ancestor (compiled and confirmed against this project's real
      // Tailwind v4 pipeline: `.rtl\:-scale-x-100:where(:dir(rtl), […])`) —
      // this asserts the *component* actually emits that class for an
      // allowlisted icon, which is what this atom is responsible for.
      expect(svg?.getAttribute("class")).toContain("rtl:-scale-x-100");
    });

    it('does not apply the mirror class for a non-allowlisted icon in the same dir="rtl" ancestor', () => {
      const { container } = render(
        <div dir="rtl">
          <Icon icon={Check} />
        </div>,
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class") ?? "").not.toContain("rtl:-scale-x-100");
    });

    it("mirrorInRtl prop overrides the allowlist explicitly", () => {
      const { container } = render(<Icon icon={Check} mirrorInRtl />);
      expect(container.querySelector("svg")?.getAttribute("class")).toContain("rtl:-scale-x-100");
    });
  });
});
