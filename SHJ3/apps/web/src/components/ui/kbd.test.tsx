import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Kbd } from "./kbd";

describe("Kbd", () => {
  it("renders its children inside a real <kbd> element", () => {
    render(<Kbd>Ctrl+Enter</Kbd>);
    const el = screen.getByText("Ctrl+Enter");
    expect(el.tagName).toBe("KBD");
  });

  it('forces dir="ltr" and unicode-bidi: isolate unconditionally, even inside an RTL ancestor', () => {
    render(
      <div dir="rtl">
        <Kbd>Ctrl+Enter</Kbd>
      </div>,
    );
    const el = screen.getByText("Ctrl+Enter");
    expect(el).toHaveAttribute("dir", "ltr");
    expect(el.style.unicodeBidi).toBe("isolate");
  });

  it("has zero axe violations", async () => {
    const { container } = render(<Kbd>Esc</Kbd>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
