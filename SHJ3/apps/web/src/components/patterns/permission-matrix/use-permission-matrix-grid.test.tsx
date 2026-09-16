import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePermissionMatrixGrid, type PermissionMatrixGrid } from "./use-permission-matrix-grid";

const PERMISSIONS = [
  { id: "view-agents", label: "View agents" },
  { id: "publish-agents", label: "Publish agents" },
  { id: "manage-users", label: "Manage users & teams" },
];

const ROLES = [
  { id: "admin", label: "Entity Admin" },
  { id: "designer", label: "Agent Designer" },
  { id: "viewer", label: "Viewer" },
];

function emptyGrid(): PermissionMatrixGrid {
  return new Map();
}

function seededGrid(entries: Array<[string, string]>): PermissionMatrixGrid {
  const grid = new Map<string, Map<string, boolean>>();
  for (const [permissionId, roleId] of entries) {
    const row = grid.get(permissionId) ?? new Map<string, boolean>();
    row.set(roleId, true);
    grid.set(permissionId, row);
  }
  return grid;
}

describe("usePermissionMatrixGrid", () => {
  describe("focus movement", () => {
    it("Arrow keys move one cell, clamped at the grid edges", () => {
      const { result } = renderHook(() =>
        usePermissionMatrixGrid({
          permissions: PERMISSIONS,
          roles: ROLES,
          defaultValue: emptyGrid(),
        }),
      );
      expect(result.current.focus).toEqual({ row: 0, col: 0 });

      act(() => result.current.moveFocusBy(0, -1)); // ArrowLeft from the top-left corner
      expect(result.current.focus).toEqual({ row: 0, col: 0 }); // clamped

      act(() => result.current.moveFocusBy(1, 1));
      expect(result.current.focus).toEqual({ row: 1, col: 1 });

      act(() => result.current.moveFocusBy(10, 10)); // far past the bottom-right
      expect(result.current.focus).toEqual({ row: PERMISSIONS.length - 1, col: ROLES.length - 1 });
    });

    it("Home/End move to the first/last cell in the current row", () => {
      const { result } = renderHook(() =>
        usePermissionMatrixGrid({
          permissions: PERMISSIONS,
          roles: ROLES,
          defaultValue: emptyGrid(),
        }),
      );
      act(() => result.current.moveFocusBy(1, 1));
      act(() => result.current.moveFocusToRowEdge("end"));
      expect(result.current.focus).toEqual({ row: 1, col: ROLES.length - 1 });
      act(() => result.current.moveFocusToRowEdge("start"));
      expect(result.current.focus).toEqual({ row: 1, col: 0 });
    });

    it("Ctrl+Home/Ctrl+End move to the first/last cell in the whole grid", () => {
      const { result } = renderHook(() =>
        usePermissionMatrixGrid({
          permissions: PERMISSIONS,
          roles: ROLES,
          defaultValue: emptyGrid(),
        }),
      );
      act(() => result.current.moveFocusBy(1, 1));
      act(() => result.current.moveFocusToGridEdge("end"));
      expect(result.current.focus).toEqual({ row: PERMISSIONS.length - 1, col: ROLES.length - 1 });
      act(() => result.current.moveFocusToGridEdge("start"));
      expect(result.current.focus).toEqual({ row: 0, col: 0 });
    });

    it("PageUp/PageDown move 5 rows, clamped", () => {
      // Not `Array.from({ length: 12 }, (_, index) => ...)`: this project's
      // lint config rejects any named unused callback parameter (see
      // `pagination.tsx`'s identical note) — a plain loop instead.
      const manyPermissions: Array<{ id: string; label: string }> = [];
      for (let index = 0; index < 12; index++) {
        manyPermissions.push({ id: `perm-${index}`, label: `Permission ${index}` });
      }
      const { result } = renderHook(() =>
        usePermissionMatrixGrid({
          permissions: manyPermissions,
          roles: ROLES,
          defaultValue: emptyGrid(),
        }),
      );
      act(() => result.current.movePage(1));
      expect(result.current.focus.row).toBe(5);
      act(() => result.current.movePage(1));
      expect(result.current.focus.row).toBe(10);
      act(() => result.current.movePage(1)); // would be 15, clamped to 11
      expect(result.current.focus.row).toBe(11);
      act(() => result.current.movePage(-1));
      expect(result.current.focus.row).toBe(6);
    });
  });

  describe("Space: toggle the focused cell", () => {
    it("flips only the focused cell and reports the change", () => {
      const onCellsChange = vi.fn();
      const { result } = renderHook(() =>
        usePermissionMatrixGrid({
          permissions: PERMISSIONS,
          roles: ROLES,
          defaultValue: emptyGrid(),
          onCellsChange,
        }),
      );
      act(() => result.current.moveFocusBy(1, 1)); // publish-agents / designer
      act(() => result.current.toggleFocusedCell());

      expect(result.current.getGranted("publish-agents", "designer")).toBe(true);
      expect(result.current.getGranted("publish-agents", "admin")).toBe(false);
      expect(onCellsChange).toHaveBeenCalledExactlyOnceWith([
        { permissionId: "publish-agents", roleId: "designer", granted: true },
      ]);
      expect(result.current.announcement).toBe("Agent Designer now has 1 of 3 permissions");
    });

    it("a locked cell cannot be toggled", () => {
      const { result } = renderHook(() =>
        usePermissionMatrixGrid({
          permissions: PERMISSIONS,
          roles: ROLES,
          defaultValue: emptyGrid(),
          isLocked: (permissionId, roleId) =>
            permissionId === "publish-agents" && roleId === "designer",
        }),
      );
      act(() => result.current.moveFocusBy(1, 1));
      act(() => result.current.toggleFocusedCell());
      expect(result.current.getGranted("publish-agents", "designer")).toBe(false);
    });

    it("read-only: no toggle has any effect", () => {
      const onCellsChange = vi.fn();
      const { result } = renderHook(() =>
        usePermissionMatrixGrid({
          permissions: PERMISSIONS,
          roles: ROLES,
          defaultValue: emptyGrid(),
          onCellsChange,
          readOnly: true,
        }),
      );
      act(() => result.current.toggleFocusedCell());
      expect(onCellsChange).not.toHaveBeenCalled();
      expect(result.current.getGranted("view-agents", "admin")).toBe(false);
    });
  });

  describe("Shift+Space: toggle the entire row", () => {
    it("grants every role for that permission when not all are granted, skipping locked cells", () => {
      const onCellsChange = vi.fn();
      const { result } = renderHook(() =>
        usePermissionMatrixGrid({
          permissions: PERMISSIONS,
          roles: ROLES,
          defaultValue: emptyGrid(),
          onCellsChange,
          isLocked: (permissionId, roleId) =>
            permissionId === "publish-agents" && roleId === "viewer",
        }),
      );
      act(() => result.current.moveFocusBy(1, 0)); // focus row "publish-agents"
      act(() => result.current.toggleFocusedRow());

      expect(result.current.getGranted("publish-agents", "admin")).toBe(true);
      expect(result.current.getGranted("publish-agents", "designer")).toBe(true);
      expect(result.current.getGranted("publish-agents", "viewer")).toBe(false); // locked, untouched
      expect(onCellsChange).toHaveBeenCalledExactlyOnceWith([
        { permissionId: "publish-agents", roleId: "admin", granted: true },
        { permissionId: "publish-agents", roleId: "designer", granted: true },
      ]);
      expect(result.current.announcement).toBe("Publish agents granted to 2 of 3 roles");
    });

    it("revokes every role when all (eligible) roles already have it", () => {
      const { result } = renderHook(() =>
        usePermissionMatrixGrid({
          permissions: PERMISSIONS,
          roles: ROLES,
          defaultValue: seededGrid([
            ["publish-agents", "admin"],
            ["publish-agents", "designer"],
            ["publish-agents", "viewer"],
          ]),
        }),
      );
      act(() => result.current.moveFocusBy(1, 0));
      act(() => result.current.toggleFocusedRow());
      expect(result.current.getGranted("publish-agents", "admin")).toBe(false);
      expect(result.current.getGranted("publish-agents", "designer")).toBe(false);
      expect(result.current.getGranted("publish-agents", "viewer")).toBe(false);
    });
  });

  describe("Ctrl+Space: toggle the entire column", () => {
    it("grants every permission for that role, skipping locked cells", () => {
      const onCellsChange = vi.fn();
      const { result } = renderHook(() =>
        usePermissionMatrixGrid({
          permissions: PERMISSIONS,
          roles: ROLES,
          defaultValue: emptyGrid(),
          onCellsChange,
          isLocked: (permissionId, roleId) =>
            permissionId === "publish-agents" && roleId === "designer",
        }),
      );
      act(() => result.current.moveFocusBy(0, 1)); // focus column "designer"
      act(() => result.current.toggleFocusedColumn());

      expect(result.current.getGranted("view-agents", "designer")).toBe(true);
      expect(result.current.getGranted("manage-users", "designer")).toBe(true);
      expect(result.current.getGranted("publish-agents", "designer")).toBe(false); // locked
      expect(result.current.announcement).toBe("Agent Designer now has 2 of 3 permissions");
    });
  });

  describe("Ctrl+Z: undo", () => {
    it("reverses the last single-cell toggle", () => {
      const { result } = renderHook(() =>
        usePermissionMatrixGrid({
          permissions: PERMISSIONS,
          roles: ROLES,
          defaultValue: emptyGrid(),
        }),
      );
      act(() => result.current.toggleFocusedCell());
      expect(result.current.getGranted("view-agents", "admin")).toBe(true);
      act(() => result.current.undo());
      expect(result.current.getGranted("view-agents", "admin")).toBe(false);
    });

    it("reverses an entire row/column bulk toggle in one undo, not one cell at a time", () => {
      const { result } = renderHook(() =>
        usePermissionMatrixGrid({
          permissions: PERMISSIONS,
          roles: ROLES,
          defaultValue: emptyGrid(),
        }),
      );
      act(() => result.current.toggleFocusedRow()); // grants view-agents for all 3 roles
      expect(result.current.getGranted("view-agents", "admin")).toBe(true);
      expect(result.current.getGranted("view-agents", "viewer")).toBe(true);

      act(() => result.current.undo());
      expect(result.current.getGranted("view-agents", "admin")).toBe(false);
      expect(result.current.getGranted("view-agents", "designer")).toBe(false);
      expect(result.current.getGranted("view-agents", "viewer")).toBe(false);
    });

    it("undo does not push its own reversal onto the undo stack (no redo-via-undo loop)", () => {
      const { result } = renderHook(() =>
        usePermissionMatrixGrid({
          permissions: PERMISSIONS,
          roles: ROLES,
          defaultValue: emptyGrid(),
        }),
      );
      act(() => result.current.toggleFocusedCell());
      act(() => result.current.undo());
      expect(result.current.canUndo()).toBe(false);
      // A second undo is a no-op, not a redo — the state stays unchanged.
      act(() => result.current.undo());
      expect(result.current.getGranted("view-agents", "admin")).toBe(false);
    });

    it("undoing twice reverses the two most recent toggles in LIFO order", () => {
      const { result } = renderHook(() =>
        usePermissionMatrixGrid({
          permissions: PERMISSIONS,
          roles: ROLES,
          defaultValue: emptyGrid(),
        }),
      );
      act(() => result.current.toggleFocusedCell()); // view-agents/admin -> true
      act(() => result.current.moveFocusBy(0, 1));
      act(() => result.current.toggleFocusedCell()); // view-agents/designer -> true

      act(() => result.current.undo());
      expect(result.current.getGranted("view-agents", "designer")).toBe(false);
      expect(result.current.getGranted("view-agents", "admin")).toBe(true); // untouched by this undo

      act(() => result.current.undo());
      expect(result.current.getGranted("view-agents", "admin")).toBe(false);
    });

    it("read-only: undo is a no-op", () => {
      const { result } = renderHook(() =>
        usePermissionMatrixGrid({
          permissions: PERMISSIONS,
          roles: ROLES,
          defaultValue: seededGrid([["view-agents", "admin"]]),
          readOnly: true,
        }),
      );
      act(() => result.current.undo());
      expect(result.current.getGranted("view-agents", "admin")).toBe(true);
    });
  });

  describe("confirmChange guard", () => {
    it("cancels the change when the guard returns false", async () => {
      const confirmChange = vi.fn().mockReturnValue(false);
      const onCellsChange = vi.fn();
      const { result } = renderHook(() =>
        usePermissionMatrixGrid({
          permissions: PERMISSIONS,
          roles: ROLES,
          defaultValue: emptyGrid(),
          confirmChange,
          onCellsChange,
        }),
      );
      await act(async () => {
        result.current.toggleFocusedCell();
      });
      expect(confirmChange).toHaveBeenCalledWith([
        { permissionId: "view-agents", roleId: "admin", granted: true },
      ]);
      expect(onCellsChange).not.toHaveBeenCalled();
      expect(result.current.getGranted("view-agents", "admin")).toBe(false);
    });

    it("applies the change once an async guard resolves true", async () => {
      const confirmChange = vi.fn().mockResolvedValue(true);
      const { result } = renderHook(() =>
        usePermissionMatrixGrid({
          permissions: PERMISSIONS,
          roles: ROLES,
          defaultValue: emptyGrid(),
          confirmChange,
        }),
      );
      await act(async () => {
        result.current.toggleFocusedCell();
      });
      expect(result.current.getGranted("view-agents", "admin")).toBe(true);
    });
  });
});
