import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

/**
 * Same jsdom gap select.test.tsx already documents and stubs: Radix's
 * Popper-based positioning calls a handful of browser APIs jsdom does not
 * implement. Scoped to this file rather than the shared vitest.setup.ts,
 * matching select.test.tsx's own per-file scoping rationale.
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

/**
 * Radix's `DropdownMenuTrigger` opens on `pointerdown`, not `click` — an
 * immediate-open-on-press menu-button behaviour, confirmed by reading
 * `@radix-ui/react-dropdown-menu`'s compiled source directly (its trigger's
 * `onPointerDown` handler calls `context.onOpenToggle()`; there is no
 * `onClick` open handler at all). A bare `fireEvent.click` never dispatches
 * a `pointerdown`, so it silently never opens the menu — this is the actual
 * open interaction, not `Select`'s (whose trigger does open on `click`).
 */
function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger);
}

function renderMenu(onClone: () => void, onArchive: () => void) {
  return render(
    <DropdownMenu>
      <DropdownMenuTrigger>Row actions</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={onClone}>Clone</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          confirmationDescription="Archive General FAQ Agent v3.0"
          onSelect={onArchive}
        >
          Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
}

describe("DropdownMenu", () => {
  it("is closed by default", () => {
    renderMenu(vi.fn(), vi.fn());
    expect(screen.queryByRole("menuitem", { name: "Clone" })).not.toBeInTheDocument();
  });

  it("opens on trigger press and selecting an item fires onSelect and closes the menu", async () => {
    const onClone = vi.fn();
    renderMenu(onClone, vi.fn());

    openMenu(screen.getByRole("button", { name: "Row actions" }));
    const item = await screen.findByRole("menuitem", { name: "Clone" });

    fireEvent.click(item);
    expect(onClone).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: "Clone" })).not.toBeInTheDocument(),
    );
  });

  it("groups the destructive item behind a separator and marks it structurally, not colour-only", async () => {
    renderMenu(vi.fn(), vi.fn());
    openMenu(screen.getByRole("button", { name: "Row actions" }));

    const archiveItem = await screen.findByRole("menuitem", { name: "Archive" });
    expect(archiveItem).toHaveAttribute("data-variant", "destructive");
    expect(archiveItem).toHaveAttribute("data-confirmation", "Archive General FAQ Agent v3.0");
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("has zero axe violations once open", async () => {
    renderMenu(vi.fn(), vi.fn());
    openMenu(screen.getByRole("button", { name: "Row actions" }));
    await screen.findByRole("menuitem", { name: "Clone" });
    // Scanned from document.body (Radix portals menu content there) with the
    // page-level "region" rule disabled, matching tooltip.test.tsx's
    // identical, already-justified exclusion for an isolated component test.
    expect(
      await axe(document.body, { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations();
  });
});

/**
 * §5.4 #30: a destructive item cannot be constructed without the
 * confirmation seam. Never called; its only job is to fail `tsc` if the
 * `@ts-expect-error` stops being necessary.
 */
function typeLevelProofDestructiveRequiresConfirmationDescription() {
  return (
    // @ts-expect-error - variant="destructive" requires confirmationDescription.
    <DropdownMenuItem variant="destructive">Archive</DropdownMenuItem>
  );
}
void typeLevelProofDestructiveRequiresConfirmationDescription;
