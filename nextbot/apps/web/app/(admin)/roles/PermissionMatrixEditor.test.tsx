// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RBAC_MODULES } from "@nextbot/contracts";
import { PermissionMatrixEditor, emptyPermissionMatrix } from "./PermissionMatrixEditor.js";
import { RBAC_MODULE_LABELS } from "./rbac-module-labels.js";

afterEach(() => cleanup());

/** Opens a shadcn/Base UI `Select` by its trigger's accessible name (the row's
 * `aria-label`), then clicks the option with the given visible text — the Batch B
 * equivalent of the old native-`<select>` `fireEvent.change`, matching the helper
 * `RoutingConfig.test.tsx` established for Batch A's `Select` conversion. */
async function chooseOption(triggerName: string | RegExp, optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerName }));
  const option = await screen.findByRole("option", { name: optionName });
  // Base UI's `Select.Item` only commits a mouse-originated selection when it saw a
  // real `pointerdown` immediately before the `click`.
  fireEvent.pointerDown(option);
  fireEvent.click(option);
}

describe("PermissionMatrixEditor", () => {
  it("renders one row per RBAC module, defaulting every level to None on an empty matrix", () => {
    render(<PermissionMatrixEditor matrix={emptyPermissionMatrix()} onChange={vi.fn()} />);
    for (const module of RBAC_MODULES) {
      expect(screen.getByText(RBAC_MODULE_LABELS[module])).toBeInTheDocument();
    }
    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(RBAC_MODULES.length);
    for (const select of selects) expect(select).toHaveTextContent("None");
  });

  it("reflects an existing matrix's levels", () => {
    const matrix = emptyPermissionMatrix();
    matrix.approval_queue = "Write";
    matrix.reporting = "Read";
    render(<PermissionMatrixEditor matrix={matrix} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Approval Queue access level" })).toHaveTextContent("Write");
    expect(screen.getByRole("combobox", { name: "Reporting access level" })).toHaveTextContent("Read");
  });

  it("calls onChange with the module and new level when a select changes", async () => {
    const onChange = vi.fn();
    render(<PermissionMatrixEditor matrix={emptyPermissionMatrix()} onChange={onChange} />);
    await chooseOption("Approval Queue access level", "Write");
    expect(onChange).toHaveBeenCalledWith("approval_queue", "Write");
  });

  it("disables every select when disabled is true", () => {
    render(<PermissionMatrixEditor matrix={emptyPermissionMatrix()} onChange={vi.fn()} disabled />);
    for (const select of screen.getAllByRole("combobox")) expect(select).toBeDisabled();
  });
});
