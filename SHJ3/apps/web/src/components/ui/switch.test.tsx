import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Switch } from "./switch";

/**
 * jsdom never runs Tailwind's build, so `Switch`'s own compiled classes have
 * no matching CSS rules inside a component test — asserting "the resolved
 * position differs" needs *some* real stylesheet in the document to resolve
 * against. Rather than hand-guess Tailwind's output, this is a byte-accurate
 * capture: the exact class list from switch.tsx was run through the real
 * `@tailwindcss/postcss` pipeline (against this project's actual generated
 * theme) and the relevant rules pasted back verbatim, backslash escapes and
 * all — so this is proof against what Tailwind really emits, not a
 * parallel, hand-authored guess that could quietly drift from it.
 *
 * The one fact this depends on and that is *not* obvious: Tailwind v4's
 * `translate-x-*` utilities set the CSS `translate` property via a
 * `--tw-translate-x` custom property, not `transform: translateX(...)`.
 * Confirmed by inspecting the real compiled output before writing this —
 * asserting on `getComputedStyle(thumb).transform` would have silently
 * always read "none" and proven nothing.
 *
 * To regenerate if switch.tsx's class list ever changes: run the project's
 * `@tailwindcss/postcss` pipeline over a fixture containing the new class
 * list and copy the matching `.group-aria-checked\/switch\:…` rules back in.
 */
const COMPILED_SWITCH_CSS = `
.translate-x-0 {
  --tw-translate-x: var(--space-0);
  translate: var(--tw-translate-x) var(--tw-translate-y);
}
.group-aria-checked\\/switch\\:ltr\\:translate-x-full:is(:where(.group\\/switch)[aria-checked="true"] *):where(:dir(ltr), [dir="ltr"], [dir="ltr"] *) {
  --tw-translate-x: 100%;
  translate: var(--tw-translate-x) var(--tw-translate-y);
}
.group-aria-checked\\/switch\\:rtl\\:-translate-x-full:is(:where(.group\\/switch)[aria-checked="true"] *):where(:dir(rtl), [dir="rtl"], [dir="rtl"] *) {
  --tw-translate-x: -100%;
  translate: var(--tw-translate-x) var(--tw-translate-y);
}
@property --tw-translate-x {
  syntax: "*";
  inherits: false;
  initial-value: 0;
}
`;

beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = COMPILED_SWITCH_CSS;
  document.head.appendChild(style);
});

function thumbOf(container: HTMLElement): HTMLElement {
  const thumb = container.querySelector<HTMLElement>('[data-slot="switch-thumb"]');
  if (!thumb) throw new Error("switch thumb not found");
  return thumb;
}

describe("Switch", () => {
  it("renders unchecked by default with role=switch", () => {
    render(<Switch aria-label="Enable notifications" />);
    const el = screen.getByRole("switch", { name: "Enable notifications" });
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("aria-checked", "false");
  });

  it("toggles on click and reports the new value via onCheckedChange", () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Enable notifications" onCheckedChange={onCheckedChange} />);
    const el = screen.getByRole("switch", { name: "Enable notifications" });
    fireEvent.click(el);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(el).toHaveAttribute("aria-checked", "true");
  });

  it("resolves the thumb's real translate position oppositely under LTR vs RTL when checked — not merely a different class name", () => {
    const { container: ltrContainer } = render(
      <div dir="ltr">
        <Switch aria-label="On" checked onCheckedChange={() => {}} />
      </div>,
    );
    const { container: rtlContainer } = render(
      <div dir="rtl">
        <Switch aria-label="On" checked onCheckedChange={() => {}} />
      </div>,
    );

    const ltrThumb = thumbOf(ltrContainer);
    const rtlThumb = thumbOf(rtlContainer);

    // Sanity: both are correctly "on" per ARIA regardless of direction —
    // this alone is the assertion the brief explicitly says is *not* enough.
    expect(screen.getAllByRole("switch", { name: "On" })[0]).toHaveAttribute(
      "aria-checked",
      "true",
    );

    const ltrTranslateX = getComputedStyle(ltrThumb).getPropertyValue("--tw-translate-x").trim();
    const rtlTranslateX = getComputedStyle(rtlThumb).getPropertyValue("--tw-translate-x").trim();

    // The real, resolved custom property Tailwind's translate-x-full/
    // -translate-x-full utilities set — proven to differ, and to differ in
    // the physically-correct direction (positive = toward the end in LTR,
    // negative = toward the end in RTL), not just present-vs-absent.
    expect(ltrTranslateX).toBe("100%");
    expect(rtlTranslateX).toBe("-100%");
    expect(ltrTranslateX).not.toBe(rtlTranslateX);
  });

  it("supports the sm and md sizes", () => {
    const { container, rerender } = render(<Switch aria-label="Compact toggle" size="sm" />);
    expect(thumbOf(container)).toHaveStyle({ width: "var(--space-4)" });
    rerender(<Switch aria-label="Compact toggle" size="md" />);
    expect(thumbOf(container)).toHaveStyle({ width: "var(--space-5)" });
  });

  it("disables the control natively when disabled", () => {
    render(<Switch aria-label="Locked toggle" disabled />);
    expect(screen.getByRole("switch", { name: "Locked toggle" })).toBeDisabled();
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<Switch aria-label="Enable notifications" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
