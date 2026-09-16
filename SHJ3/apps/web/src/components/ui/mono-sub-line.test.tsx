import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { MonoSubLine } from "./mono-sub-line";

describe("MonoSubLine", () => {
  it('renders its content and forces dir="ltr" + unicode-bidi: isolate by default', () => {
    render(<MonoSubLine>v1.4 · SEWA · 412/day</MonoSubLine>);
    const el = screen.getByText("v1.4 · SEWA · 412/day");
    expect(el).toHaveAttribute("dir", "ltr");
    expect(el.style.unicodeBidi).toBe("isolate");
  });

  it('§11.3 rule 1: still isolates as dir="ltr" when rendered inside a dir="rtl" ancestor — the load-bearing case', () => {
    render(
      <div dir="rtl">
        <MonoSubLine>mcp://customs.shj.ae</MonoSubLine>
      </div>,
    );
    const el = screen.getByText("mcp://customs.shj.ae");
    // Asserts the *actual resolved* attribute/inline style on the rendered
    // node, not merely that a prop was passed through — the ancestor's
    // dir="rtl" must not leak in and override this element's own direction.
    expect(el).toHaveAttribute("dir", "ltr");
    expect(el.style.unicodeBidi).toBe("isolate");
    // Sanity check the ancestor really is RTL, so the isolation is proven
    // against a genuinely conflicting context rather than a no-op case.
    expect(el.closest('[dir="rtl"]')).not.toBeNull();
  });

  it("variant=truncate applies ellipsis/overflow classes", () => {
    const { container } = render(
      <MonoSubLine variant="truncate">a-very-long-token-value</MonoSubLine>,
    );
    const el = container.querySelector('[data-slot="mono-sub-line"]');
    expect(el?.getAttribute("class")).toContain("overflow-hidden");
    expect(el?.getAttribute("class")).toContain("text-ellipsis");
  });

  it("variant=copyable renders a labelled copy control and copies the value on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<MonoSubLine variant="copyable">TXN-88213</MonoSubLine>);

    const button = screen.getByRole("button", { name: "Copy to clipboard" });
    fireEvent.click(button);

    expect(writeText).toHaveBeenCalledWith("TXN-88213");
    // Confirmation is a polite live region, not only a visual change.
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Copied to clipboard"),
    );
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<MonoSubLine>v1.4 · SEWA · 412/day</MonoSubLine>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
