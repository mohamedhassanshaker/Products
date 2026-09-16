import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

/**
 * Radix Select's positioning/interaction internals call a handful of browser
 * APIs jsdom does not implement (`hasPointerCapture`, `scrollIntoView`,
 * `ResizeObserver`) — confirmed directly: the "opens on click" test below
 * threw on each of these in turn before they were stubbed. Scoped to this
 * file rather than the shared `vitest.setup.ts`, since Select is the only
 * atom in this batch that exercises Radix's Popper-based positioning.
 */
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!("ResizeObserver" in globalThis)) {
    class NoopResizeObserver implements ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = NoopResizeObserver;
  }
});

function renderProviderSelect() {
  return render(
    <Select defaultValue="sewa">
      <SelectTrigger aria-label="Provider">
        <SelectValue placeholder="Choose a provider" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="sewa">SEWA</SelectItem>
        <SelectItem value="customs">Customs</SelectItem>
      </SelectContent>
    </Select>,
  );
}

describe("Select", () => {
  it("renders a closed trigger in its default state", () => {
    renderProviderSelect();
    const trigger = screen.getByRole("combobox", { name: "Provider" });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("opens on click and exposes its options (Radix: typeahead/Home/End/Escape/focus-return are inherited, not reimplemented)", async () => {
    renderProviderSelect();
    fireEvent.click(screen.getByRole("combobox", { name: "Provider" }));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: "SEWA" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Customs" })).toBeInTheDocument();
  });

  it("forces dir=ltr on the mono variant's trigger", () => {
    render(
      <div dir="rtl">
        <Select defaultValue="mcp">
          <SelectTrigger aria-label="Endpoint" variant="mono">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mcp">mcp://sharjah-services.internal</SelectItem>
          </SelectContent>
        </Select>
      </div>,
    );
    expect(screen.getByRole("combobox", { name: "Endpoint" })).toHaveAttribute("dir", "ltr");
  });

  it("has zero axe violations in its closed default state", async () => {
    const { container } = renderProviderSelect();
    expect(await axe(container)).toHaveNoViolations();
  });
});
