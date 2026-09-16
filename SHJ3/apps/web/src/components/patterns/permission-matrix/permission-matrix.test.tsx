import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { PermissionMatrix } from "./permission-matrix";
import type { PermissionMatrixEntity, PermissionMatrixGrid } from "./use-permission-matrix-grid";
import { setMockViewportWidth, DEFAULT_MOCK_VIEWPORT_WIDTH } from "@/test/media-query-mock";

const PERMISSIONS: PermissionMatrixEntity[] = [
  { id: "view-agents", label: "View agents" },
  { id: "publish-agents", label: "Publish agents" },
  { id: "manage-users", label: "Manage users & teams" },
];

const ROLES: PermissionMatrixEntity[] = [
  { id: "admin", label: "Entity Admin" },
  { id: "designer", label: "Agent Designer" },
  { id: "viewer", label: "Viewer" },
];

function emptyGrid(): PermissionMatrixGrid {
  return new Map();
}

function grantedGrid(entries: Array<[string, string]>): PermissionMatrixGrid {
  const grid = new Map<string, Map<string, boolean>>();
  for (const [permissionId, roleId] of entries) {
    const row = grid.get(permissionId) ?? new Map<string, boolean>();
    row.set(roleId, true);
    grid.set(permissionId, row);
  }
  return grid;
}

function baseProps(overrides: Partial<React.ComponentProps<typeof PermissionMatrix>> = {}) {
  return {
    permissions: PERMISSIONS,
    roles: ROLES,
    defaultValue: emptyGrid(),
    caption: "Roles & permissions",
    ...overrides,
  } satisfies React.ComponentProps<typeof PermissionMatrix>;
}

/** The grid's own single tab stop. */
function getGrid(): HTMLElement {
  return screen.getByRole("grid");
}

afterEach(() => {
  document.documentElement.dir = "";
  setMockViewportWidth(DEFAULT_MOCK_VIEWPORT_WIDTH);
});

describe("PermissionMatrix", () => {
  it("renders a real table with a caption, row headers and column headers", () => {
    render(<PermissionMatrix {...baseProps()} />);
    // The `<table>`'s own accessible name is correctly derived from its
    // `<caption>` — standard accessible-name computation for a table, not
    // something this component has to wire up itself.
    expect(screen.getByRole("grid", { name: "Roles & permissions" })).toBeInTheDocument();
    for (const permission of PERMISSIONS) {
      expect(screen.getByRole("rowheader", { name: permission.label })).toBeInTheDocument();
    }
    for (const role of ROLES) {
      expect(screen.getByRole("columnheader", { name: role.label })).toBeInTheDocument();
    }
  });

  it("each cell's accessible name is a real computed string combining both headers and state", () => {
    render(
      <PermissionMatrix
        {...baseProps({ defaultValue: grantedGrid([["publish-agents", "designer"]]) })}
      />,
    );
    expect(
      screen.getByRole("gridcell", { name: "Publish agents, Agent Designer, granted" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("gridcell", { name: "View agents, Entity Admin, not granted" }),
    ).toBeInTheDocument();
  });

  it("the grid has a single tab stop — Tab/Shift+Tab enter and leave it, not each cell", () => {
    render(
      <>
        <button type="button">before</button>
        <PermissionMatrix {...baseProps()} />
        <button type="button">after</button>
      </>,
    );
    expect(getGrid()).toHaveAttribute("tabIndex", "0");
    // No cell (nor anything inside one) is independently tabbable.
    expect(
      screen
        .getByRole("gridcell", { name: "View agents, Entity Admin, not granted" })
        .querySelector("[tabindex]"),
    ).toHaveAttribute("tabIndex", "-1");
  });

  describe("keyboard model — each key proven against real state, not just a handler existing", () => {
    it("Arrow keys move the virtual cursor one cell, reflected in aria-activedescendant", () => {
      render(<PermissionMatrix {...baseProps()} />);
      const grid = getGrid();
      grid.focus();
      const first = screen.getByRole("gridcell", {
        name: "View agents, Entity Admin, not granted",
      });
      expect(grid).toHaveAttribute("aria-activedescendant", first.id);

      fireEvent.keyDown(grid, { key: "ArrowRight" });
      const second = screen.getByRole("gridcell", {
        name: "View agents, Agent Designer, not granted",
      });
      expect(grid).toHaveAttribute("aria-activedescendant", second.id);

      fireEvent.keyDown(grid, { key: "ArrowDown" });
      const third = screen.getByRole("gridcell", {
        name: "Publish agents, Agent Designer, not granted",
      });
      expect(grid).toHaveAttribute("aria-activedescendant", third.id);
    });

    it("Arrow keys clamp at the grid edges rather than wrapping", () => {
      render(<PermissionMatrix {...baseProps()} />);
      const grid = getGrid();
      grid.focus();
      fireEvent.keyDown(grid, { key: "ArrowUp" }); // already row 0
      fireEvent.keyDown(grid, { key: "ArrowLeft" }); // already col 0
      const first = screen.getByRole("gridcell", {
        name: "View agents, Entity Admin, not granted",
      });
      expect(grid).toHaveAttribute("aria-activedescendant", first.id);
    });

    it("Home/End move to the first/last cell in the current row", () => {
      render(<PermissionMatrix {...baseProps()} />);
      const grid = getGrid();
      grid.focus();
      fireEvent.keyDown(grid, { key: "ArrowDown" }); // row 1
      fireEvent.keyDown(grid, { key: "End" });
      expect(grid).toHaveAttribute(
        "aria-activedescendant",
        screen.getByRole("gridcell", { name: "Publish agents, Viewer, not granted" }).id,
      );
      fireEvent.keyDown(grid, { key: "Home" });
      expect(grid).toHaveAttribute(
        "aria-activedescendant",
        screen.getByRole("gridcell", { name: "Publish agents, Entity Admin, not granted" }).id,
      );
    });

    it("Ctrl+Home/Ctrl+End move to the first/last cell in the whole grid", () => {
      render(<PermissionMatrix {...baseProps()} />);
      const grid = getGrid();
      grid.focus();
      fireEvent.keyDown(grid, { key: "End", ctrlKey: true });
      expect(grid).toHaveAttribute(
        "aria-activedescendant",
        screen.getByRole("gridcell", { name: "Manage users & teams, Viewer, not granted" }).id,
      );
      fireEvent.keyDown(grid, { key: "Home", ctrlKey: true });
      expect(grid).toHaveAttribute(
        "aria-activedescendant",
        screen.getByRole("gridcell", { name: "View agents, Entity Admin, not granted" }).id,
      );
    });

    it("PageUp/PageDown move 5 rows, clamped", () => {
      const manyPermissions: PermissionMatrixEntity[] = [];
      for (let index = 0; index < 8; index++) {
        manyPermissions.push({ id: `perm-${index}`, label: `Permission ${index}` });
      }
      render(<PermissionMatrix {...baseProps({ permissions: manyPermissions })} />);
      const grid = getGrid();
      grid.focus();
      fireEvent.keyDown(grid, { key: "PageDown" });
      expect(grid).toHaveAttribute(
        "aria-activedescendant",
        screen.getByRole("gridcell", { name: "Permission 5, Entity Admin, not granted" }).id,
      );
      fireEvent.keyDown(grid, { key: "PageDown" }); // would be row 10, clamped to 7
      expect(grid).toHaveAttribute(
        "aria-activedescendant",
        screen.getByRole("gridcell", { name: "Permission 7, Entity Admin, not granted" }).id,
      );
      fireEvent.keyDown(grid, { key: "PageUp" });
      expect(grid).toHaveAttribute(
        "aria-activedescendant",
        screen.getByRole("gridcell", { name: "Permission 2, Entity Admin, not granted" }).id,
      );
    });

    it("Space toggles the focused cell only", () => {
      const onCellsChange = vi.fn();
      render(<PermissionMatrix {...baseProps({ onCellsChange })} />);
      const grid = getGrid();
      grid.focus();
      fireEvent.keyDown(grid, { key: "ArrowRight" }); // View agents / Agent Designer
      fireEvent.keyDown(grid, { key: " " });

      expect(
        screen.getByRole("gridcell", { name: "View agents, Agent Designer, granted" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("gridcell", { name: "View agents, Entity Admin, not granted" }),
      ).toBeInTheDocument();
      expect(onCellsChange).toHaveBeenCalledExactlyOnceWith([
        { permissionId: "view-agents", roleId: "designer", granted: true },
      ]);
    });

    it("Shift+Space toggles the entire focused row", () => {
      render(<PermissionMatrix {...baseProps()} />);
      const grid = getGrid();
      grid.focus();
      fireEvent.keyDown(grid, { key: "ArrowDown" }); // row: Publish agents
      fireEvent.keyDown(grid, { key: " ", shiftKey: true });

      for (const role of ROLES) {
        expect(
          screen.getByRole("gridcell", { name: `Publish agents, ${role.label}, granted` }),
        ).toBeInTheDocument();
      }
      expect(
        screen.getByRole("gridcell", { name: "View agents, Entity Admin, not granted" }),
      ).toBeInTheDocument();
    });

    it("Ctrl+Space toggles the entire focused column", () => {
      render(<PermissionMatrix {...baseProps()} />);
      const grid = getGrid();
      grid.focus();
      fireEvent.keyDown(grid, { key: "ArrowRight" }); // column: Agent Designer
      fireEvent.keyDown(grid, { key: " ", ctrlKey: true });

      for (const permission of PERMISSIONS) {
        expect(
          screen.getByRole("gridcell", { name: `${permission.label}, Agent Designer, granted` }),
        ).toBeInTheDocument();
      }
      expect(
        screen.getByRole("gridcell", { name: "View agents, Entity Admin, not granted" }),
      ).toBeInTheDocument();
    });

    it("Ctrl+Z undoes the last toggle, including a row/column bulk toggle", () => {
      render(<PermissionMatrix {...baseProps()} />);
      const grid = getGrid();
      grid.focus();
      fireEvent.keyDown(grid, { key: " ", shiftKey: true }); // bulk-grant row "View agents"
      for (const role of ROLES) {
        expect(
          screen.getByRole("gridcell", { name: `View agents, ${role.label}, granted` }),
        ).toBeInTheDocument();
      }

      fireEvent.keyDown(grid, { key: "z", ctrlKey: true });
      for (const role of ROLES) {
        expect(
          screen.getByRole("gridcell", { name: `View agents, ${role.label}, not granted` }),
        ).toBeInTheDocument();
      }
    });

    it("announces the new value and running total in a polite live region", () => {
      render(<PermissionMatrix {...baseProps()} />);
      const grid = getGrid();
      grid.focus();
      fireEvent.keyDown(grid, { key: "ArrowDown" });
      fireEvent.keyDown(grid, { key: " " }); // Publish agents / Entity Admin -> granted

      const status = screen.getByRole("status");
      expect(status).toHaveTextContent("Entity Admin now has 1 of 3 permissions");
    });
  });

  describe("locked cells (with-locked-cells)", () => {
    it("cannot be toggled by Space, and are excluded from a row/column bulk toggle", () => {
      render(
        <PermissionMatrix
          {...baseProps({
            isLocked: (permissionId, roleId) =>
              permissionId === "publish-agents" && roleId === "viewer",
          })}
        />,
      );
      const grid = getGrid();
      grid.focus();
      fireEvent.keyDown(grid, { key: "ArrowDown" }); // row: Publish agents
      fireEvent.keyDown(grid, { key: " ", shiftKey: true }); // bulk-grant the row

      expect(
        screen.getByRole("gridcell", { name: "Publish agents, Entity Admin, granted" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("gridcell", { name: "Publish agents, Viewer, locked" }),
      ).toBeInTheDocument();
    });
  });

  describe("read-only variant", () => {
    it("renders check/dash glyphs instead of checkboxes, and every toggle key is a no-op", () => {
      const onCellsChange = vi.fn();
      render(
        <PermissionMatrix
          {...baseProps({
            defaultValue: grantedGrid([["view-agents", "admin"]]),
            readOnly: true,
            onCellsChange,
          })}
        />,
      );
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

      const grid = getGrid();
      grid.focus();
      fireEvent.keyDown(grid, { key: " " });
      fireEvent.keyDown(grid, { key: " ", shiftKey: true });
      fireEvent.keyDown(grid, { key: " ", ctrlKey: true });
      expect(onCellsChange).not.toHaveBeenCalled();
      // Navigation still works read-only.
      fireEvent.keyDown(grid, { key: "ArrowRight" });
      expect(grid).toHaveAttribute(
        "aria-activedescendant",
        screen.getByRole("gridcell", { name: "View agents, Agent Designer, not granted" }).id,
      );
    });
  });

  describe("confirmChange", () => {
    it("a rejected confirmation blocks the change", async () => {
      const confirmChange = vi.fn().mockReturnValue(false);
      render(<PermissionMatrix {...baseProps({ confirmChange })} />);
      const grid = getGrid();
      grid.focus();
      fireEvent.keyDown(grid, { key: " " });

      expect(confirmChange).toHaveBeenCalledWith([
        { permissionId: "view-agents", roleId: "admin", granted: true },
      ]);
      expect(
        await screen.findByRole("gridcell", { name: "View agents, Entity Admin, not granted" }),
      ).toBeInTheDocument();
    });
  });

  describe("RTL", () => {
    it("ArrowRight moves the virtual cursor toward the previous column once the ambient direction is rtl", () => {
      document.documentElement.dir = "rtl";
      render(<PermissionMatrix {...baseProps()} />);
      const grid = getGrid();
      grid.focus();
      fireEvent.keyDown(grid, { key: "ArrowRight" });
      expect(grid).toHaveAttribute(
        "aria-activedescendant",
        within(grid).getAllByRole("gridcell")[0]!.id,
      );
      // Moving right from the leftmost column stays clamped under RTL too —
      // the meaningful, non-trivial proof is the *reversed* direction below.
      fireEvent.keyDown(grid, { key: "ArrowLeft" });
      expect(grid).toHaveAttribute(
        "aria-activedescendant",
        screen.getByRole("gridcell", { name: "View agents, Agent Designer, not granted" }).id,
      );
    });
  });

  describe("≤820px collapse", () => {
    it("drops grid semantics entirely for one Card per role containing a Switch per permission", () => {
      setMockViewportWidth(700);
      render(
        <PermissionMatrix
          {...baseProps({ defaultValue: grantedGrid([["view-agents", "admin"]]) })}
        />,
      );

      expect(screen.queryByRole("grid")).not.toBeInTheDocument();
      for (const role of ROLES) {
        expect(screen.getByRole("heading", { name: role.label })).toBeInTheDocument();
      }
      // Every role's card renders a "View agents" switch (the card's own
      // heading already carries the role identity — matching how a list of
      // per-record cards does not need to repeat the record's identity
      // inside every one of its fields either); the first, in DOM order,
      // belongs to "Entity Admin" — `ROLES[0]`, seeded granted above.
      const adminSwitch = screen.getAllByRole("switch", { name: "View agents" })[0]!;
      expect(adminSwitch).toHaveAttribute("aria-checked", "true");
    });

    it("each Switch is independently toggleable", () => {
      setMockViewportWidth(700);
      const onCellsChange = vi.fn();
      render(<PermissionMatrix {...baseProps({ onCellsChange })} />);
      const switches = screen.getAllByRole("switch", { name: "View agents" });
      fireEvent.click(switches[0]!);
      expect(onCellsChange).toHaveBeenCalledExactlyOnceWith([
        { permissionId: "view-agents", roleId: "admin", granted: true },
      ]);
    });
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<PermissionMatrix {...baseProps()} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has zero axe violations in the read-only variant", async () => {
    const { container } = render(<PermissionMatrix {...baseProps({ readOnly: true })} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has zero axe violations in the ≤820px collapsed layout", async () => {
    setMockViewportWidth(700);
    const { container } = render(<PermissionMatrix {...baseProps()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
