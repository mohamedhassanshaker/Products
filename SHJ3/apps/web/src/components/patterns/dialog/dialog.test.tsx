import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DestructiveConfirmDialog,
  Sheet,
  SheetContent,
  SheetTrigger,
  type SheetSide,
} from "./dialog";

/**
 * Same jsdom gap `dropdown-menu.test.tsx`/`select.test.tsx` already document
 * for Radix's Popper-adjacent internals. `Dialog` itself is not
 * Popper-positioned (it's a fixed/portal overlay, not anchored to a
 * trigger), but `FocusScope`'s auto-focus pass still touches
 * `scrollIntoView`, which jsdom does not implement.
 */
beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(() => {
  document.documentElement.dir = "";
});

function renderBasicDialog() {
  return render(
    <Dialog>
      <DialogTrigger>Open dialog</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive agent</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>,
  );
}

describe("Dialog", () => {
  it("is closed by default", () => {
    renderBasicDialog();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // Distinct from `DropdownMenu`: confirmed by reading @radix-ui/react-dialog's
  // compiled source directly (`DialogTrigger`'s handler is `onClick`, not
  // `onPointerDown`) rather than assumed from `dropdown-menu.test.tsx`'s
  // helper — a plain `fireEvent.click` is the real open interaction here.
  it("opens on trigger click", async () => {
    renderBasicDialog();
    fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("wires aria-labelledby and aria-describedby to the real Title/Description once they mount", async () => {
    renderBasicDialog();
    fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));
    const dialog = await screen.findByRole("dialog");
    const title = screen.getByText("Archive agent");
    const description = screen.getByText("This cannot be undone.");
    expect(title.id).toBeTruthy();
    expect(description.id).toBeTruthy();
    expect(dialog).toHaveAttribute("aria-labelledby", title.id);
    expect(dialog).toHaveAttribute("aria-describedby", description.id);
  });

  it("moves focus inside the dialog on open", async () => {
    renderBasicDialog();
    fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it("Escape closes the dialog and returns focus to the trigger", async () => {
    renderBasicDialog();
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("clicking the footer close affordance closes the dialog and returns focus to the trigger", async () => {
    renderBasicDialog();
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    // This fixture renders two "Close"-labelled affordances (the footer's
    // plain `DialogClose` text button and `DialogContent`'s own corner icon
    // button) — `getAllByRole` and picking the first (the footer one, first
    // in DOM order) keeps this query deterministic; the corner one gets its
    // own dedicated test below.
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("the corner close button (showCloseButton) also closes the dialog", async () => {
    renderBasicDialog();
    fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));
    await screen.findByRole("dialog");
    // Two "Close" affordances exist in this fixture: the footer's plain
    // DialogClose text button and the corner icon button, both labelled
    // "Close" — the corner one is the IconButton, distinguished by its
    // accessible name matching but role/position differing; querying all and
    // clicking the last (rendered after children, per DialogContent's DOM
    // order) exercises the corner affordance specifically.
    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    fireEvent.click(closeButtons[closeButtons.length - 1]!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("traps focus: Tab from the last focusable element wraps back to the first", async () => {
    render(
      <Dialog>
        <DialogTrigger>Open dialog</DialogTrigger>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Two actions</DialogTitle>
          </DialogHeader>
          <button type="button">First</button>
          <button type="button">Last</button>
        </DialogContent>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));
    await screen.findByRole("dialog");
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });
    last.focus();
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Tab" });
    await waitFor(() => expect(first).toHaveFocus());
  });

  it("has zero axe violations while open", async () => {
    renderBasicDialog();
    fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));
    await screen.findByRole("dialog");
    // Radix portals dialog content to `document.body`, outside the render
    // container — matching `dropdown-menu.test.tsx`'s identical, already-
    // justified scan target and "region" rule exclusion for this shape.
    expect(
      await axe(document.body, { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations();
  });
});

describe("DestructiveConfirmDialog", () => {
  it("restates the object by name in the body and shows the real action verb, never a bare OK", async () => {
    render(
      <DestructiveConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Archive this agent?"
        objectName="General FAQ Agent v3.0"
        actionLabel="Archive"
        onConfirm={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("General FAQ Agent v3.0");
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "OK" })).not.toBeInTheDocument();
  });

  it("confirming the action calls onConfirm; cancelling calls onOpenChange(false) without confirming", async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <DestructiveConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Remove team member?"
        objectName="Fatima S."
        actionLabel="Remove"
        onConfirm={onConfirm}
      />,
    );
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("a custom descriptionTemplate still receives the real object name", async () => {
    render(
      <DestructiveConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Archive?"
        objectName="Fee schedule v2"
        actionLabel="Archive"
        onConfirm={vi.fn()}
        descriptionTemplate={(name) => `Delete ${name} forever?`}
      />,
    );
    expect(await screen.findByText("Delete Fee schedule v2 forever?")).toBeInTheDocument();
  });

  it("confirming disables Cancel and shows the primary action as busy", async () => {
    render(
      <DestructiveConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Archive?"
        objectName="Agent"
        actionLabel="Archive"
        onConfirm={vi.fn()}
        confirming
      />,
    );
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Archive" })).toHaveAttribute("aria-busy", "true");
  });

  it("has zero axe violations", async () => {
    render(
      <DestructiveConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Archive this agent?"
        objectName="General FAQ Agent v3.0"
        actionLabel="Archive"
        onConfirm={vi.fn()}
      />,
    );
    await screen.findByRole("dialog");
    expect(
      await axe(document.body, { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations();
  });
});

describe("Sheet", () => {
  const sides: readonly SheetSide[] = ["bottom", "inline-start", "inline-end"];

  it.each(sides)(
    "renders the %s variant as a real dialog with the matching data-side",
    async (side) => {
      render(
        <Sheet>
          <SheetTrigger>Open sheet</SheetTrigger>
          <SheetContent side={side}>
            <DialogHeader>
              <DialogTitle>Node inspector</DialogTitle>
            </DialogHeader>
          </SheetContent>
        </Sheet>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Open sheet" }));
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveAttribute("data-side", side);
    },
  );

  it("Escape closes a sheet exactly like a dialog (same underlying primitive)", async () => {
    render(
      <Sheet>
        <SheetTrigger>Open sheet</SheetTrigger>
        <SheetContent side="bottom">
          <DialogHeader>
            <DialogTitle>Node inspector</DialogTitle>
          </DialogHeader>
        </SheetContent>
      </Sheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open sheet" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

/**
 * §5.5 #53: a destructive confirmation cannot be constructed without the
 * object's name and the action's real verb. Never called; its only job is
 * to fail `tsc` if the `@ts-expect-error`s stop being necessary — the same
 * convention `dropdown-menu.test.tsx`'s identical type-level proof uses.
 */
function typeLevelProofRequiresObjectNameAndActionLabel() {
  return (
    <>
      {
        // @ts-expect-error - objectName and actionLabel are required.
        <DestructiveConfirmDialog
          open
          onOpenChange={() => {}}
          title="Archive?"
          onConfirm={() => {}}
        />
      }
    </>
  );
}
void typeLevelProofRequiresObjectNameAndActionLabel;
