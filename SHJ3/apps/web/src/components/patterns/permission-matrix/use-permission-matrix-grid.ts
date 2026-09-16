"use client";

import * as React from "react";

export interface PermissionMatrixEntity {
  id: string;
  label: string;
}

export interface PermissionMatrixChange {
  permissionId: string;
  roleId: string;
  granted: boolean;
}

/** Sparse grid: `grid.get(permissionId)?.get(roleId)`, defaulting to `false` — an absent entry is simply "not granted," not a third state. */
export type PermissionMatrixGrid = ReadonlyMap<string, ReadonlyMap<string, boolean>>;

export interface FocusPosition {
  row: number;
  col: number;
}

export interface UsePermissionMatrixGridOptions {
  permissions: readonly PermissionMatrixEntity[];
  roles: readonly PermissionMatrixEntity[];
  /** Seeds the grid on mount. Not a fully live-controlled value — see the hook's own doc comment for why. */
  defaultValue: PermissionMatrixGrid;
  // `| undefined` explicitly on these three, not just `?:` — `permission-
  // matrix.tsx` forwards its own same-named optional props straight through
  // to this hook, and under this project's `exactOptionalPropertyTypes`, a
  // destructured-but-omitted optional prop is typed `T | undefined`, which a
  // plain `?: T` parameter here would reject at that call site (the same
  // distinction `checkbox.tsx`'s conditional-spread notes describe for
  // Radix's own props — this is the same rule, fixed at the type instead of
  // the call site since this hook's own type is not a vendor's to work around).
  isLocked?: ((permissionId: string, roleId: string) => boolean) | undefined;
  /** Fires after every applied change (single cell, bulk row/column, or an undo) — the seam a caller persists through, matching `Wizard`'s `onSaveDraft` in spirit: this hook does not know or care what happens after. */
  onCellsChange?: ((changes: readonly PermissionMatrixChange[]) => void) | undefined;
  /**
   * Optional guard called with the change(s) a toggle is *about to* apply,
   * before they land — the generic hook this organism's own B9 rule
   * ("any edit that would grant Publish agents to a non-admin role raises a
   * confirmation naming the separation-of-duties rule it breaks") is built
   * from, without this reusable grid hardcoding one screen's role/permission
   * names. Returning (or resolving) `false` cancels the change entirely.
   */
  confirmChange?:
    ((changes: readonly PermissionMatrixChange[]) => boolean | Promise<boolean>) | undefined;
  /** `read-only` variant (design-system.md §5.5 #43): every toggle becomes a no-op; navigation keys still work. */
  readOnly?: boolean;
}

export interface UsePermissionMatrixGridResult {
  grid: PermissionMatrixGrid;
  getGranted: (permissionId: string, roleId: string) => boolean;
  isCellLocked: (permissionId: string, roleId: string) => boolean;
  focus: FocusPosition;
  /** The live-region sentence for the most recent change — design-system.md §5.5 #43: "a polite live region announces the new value and the running total." */
  announcement: string;
  moveFocusBy: (deltaRow: number, deltaCol: number) => void;
  moveFocusToRowEdge: (edge: "start" | "end") => void;
  moveFocusToGridEdge: (edge: "start" | "end") => void;
  movePage: (direction: 1 | -1) => void;
  setFocusPosition: (row: number, col: number) => void;
  toggleFocusedCell: () => void;
  toggleFocusedRow: () => void;
  toggleFocusedColumn: () => void;
  toggleCellAt: (permissionId: string, roleId: string) => void;
  undo: () => void;
  canUndo: () => boolean;
}

function gridKey(permissionId: string, roleId: string): string {
  return `${permissionId}::${roleId}`;
}

function readGranted(grid: PermissionMatrixGrid, permissionId: string, roleId: string): boolean {
  return grid.get(permissionId)?.get(roleId) ?? false;
}

function applyChangesToGrid(
  grid: PermissionMatrixGrid,
  changes: readonly PermissionMatrixChange[],
): PermissionMatrixGrid {
  const next = new Map<string, Map<string, boolean>>();
  for (const [permissionId, roleMap] of grid) next.set(permissionId, new Map(roleMap));
  for (const change of changes) {
    const roleMap = next.get(change.permissionId) ?? new Map<string, boolean>();
    roleMap.set(change.roleId, change.granted);
    next.set(change.permissionId, roleMap);
  }
  return next;
}

/**
 * Composes the exact announcement shape design-system.md §5.5 #43 gives —
 * `"Agent Designer now has 2 of 8 permissions"` for a change scoped to one
 * role (a single cell, or `Ctrl+Space`'s whole-column toggle) — and its
 * necessary parallel for a `Shift+Space` whole-*row* toggle, which the one
 * given example does not cover on its own (a row toggle touches every role
 * for one permission, not every permission for one role, so the role-centric
 * sentence has nothing to name): `"{permission} granted to N of M roles"`,
 * the same subject-verb-object shape applied to the other axis. A change
 * spanning more than one role *and* more than one permission cannot happen
 * from this hook's own actions (every toggle here is scoped to a single
 * cell, row, or column), so that case is unreachable rather than given its
 * own sentence.
 */
function announceChanges(
  changes: readonly PermissionMatrixChange[],
  nextGrid: PermissionMatrixGrid,
  permissions: readonly PermissionMatrixEntity[],
  roles: readonly PermissionMatrixEntity[],
): string {
  if (changes.length === 0) return "";

  const roleIds = new Set(changes.map((change) => change.roleId));
  if (roleIds.size === 1) {
    const roleId = changes[0]!.roleId;
    const role = roles.find((candidate) => candidate.id === roleId);
    const grantedCount = permissions.filter((permission) =>
      readGranted(nextGrid, permission.id, roleId),
    ).length;
    return `${role?.label ?? roleId} now has ${grantedCount} of ${permissions.length} permissions`;
  }

  const permissionIds = new Set(changes.map((change) => change.permissionId));
  if (permissionIds.size === 1) {
    const permissionId = changes[0]!.permissionId;
    const permission = permissions.find((candidate) => candidate.id === permissionId);
    const grantedCount = roles.filter((role) =>
      readGranted(nextGrid, permissionId, role.id),
    ).length;
    return `${permission?.label ?? permissionId} granted to ${grantedCount} of ${roles.length} roles`;
  }

  return "Permissions updated";
}

/**
 * The stateful core of `PermissionMatrix` (design-system.md §5.5 #43),
 * separated from `permission-matrix.tsx`'s DOM/ARIA/keyboard-event wiring
 * for the same reason `use-wizard-draft.ts` is its own file: "each key needs
 * its own test proving the actual focus/state change" is much more directly
 * provable against this hook's plain return values than by asserting on
 * rendered `aria-checked`/`aria-activedescendant` attributes for every case.
 * `permission-matrix.test.tsx` still covers the full keyboard table end to
 * end against the real rendered grid — this hook's own tests are the
 * narrower, faster-to-diagnose complement, not a replacement.
 *
 * ## Why the grid is seeded, not fully controlled
 *
 * `Ctrl+Z` ("undo the last toggle, including a row/column bulk toggle") only
 * has something to reverse if this hook owns the history — a fully
 * `value`-controlled component would need to reconcile its own undo stack
 * against a caller that can also change `value` out from under it at any
 * time (a live update from elsewhere), which is a real, harder problem this
 * wave's scope does not require solving (no live multi-editor collaboration
 * exists yet). `defaultValue` seeds the grid once, on mount; every toggle
 * after that is owned here and reported outward through `onCellsChange` —
 * the same "caller persists, this component owns the interaction" split
 * `Wizard`'s draft seam and `Composer`'s transcription props both use.
 *
 * ## Why `confirmChange` is generic rather than hardcoding B9's rule
 *
 * §5.5 #43's a11y paragraph: *"any edit that would grant Publish agents to a
 * non-admin role raises a confirmation naming the separation-of-duties rule
 * it breaks."* This hook has no idea what "Publish agents" or "Agent
 * Designer" mean — those are B9 screen data, supplied by a caller in a later
 * wave (B-2), not something a reusable 7×8-or-any-size grid should know by
 * name. `confirmChange` is the seam: the caller inspects the proposed
 * `PermissionMatrixChange[]` against its own domain rule and returns whether
 * to proceed, presumably backed by a real confirmation dialog (`Dialog`/
 * `AlertDialog` — a different organism, out of this file's scope) once one
 * exists.
 */
export function usePermissionMatrixGrid({
  permissions,
  roles,
  defaultValue,
  isLocked,
  onCellsChange,
  confirmChange,
  readOnly = false,
}: UsePermissionMatrixGridOptions): UsePermissionMatrixGridResult {
  const [grid, setGrid] = React.useState<PermissionMatrixGrid>(defaultValue);
  const [focus, setFocus] = React.useState<FocusPosition>({ row: 0, col: 0 });
  const [announcement, setAnnouncement] = React.useState("");
  // A plain ref, not `useState`: nothing renders from the stack's *contents*
  // (there is no visible "Undo" button in this spec, only the `Ctrl+Z` key),
  // only from whether an undo actually changed anything — which `undo()`
  // already surfaces synchronously through its own return path via `grid`.
  const undoStackRef = React.useRef<PermissionMatrixChange[][]>([]);

  const clampRow = React.useCallback(
    (row: number) => Math.max(0, Math.min(permissions.length - 1, row)),
    [permissions.length],
  );
  const clampCol = React.useCallback(
    (col: number) => Math.max(0, Math.min(roles.length - 1, col)),
    [roles.length],
  );

  const getGranted = React.useCallback(
    (permissionId: string, roleId: string) => readGranted(grid, permissionId, roleId),
    [grid],
  );

  const isCellLocked = React.useCallback(
    (permissionId: string, roleId: string) => isLocked?.(permissionId, roleId) ?? false,
    [isLocked],
  );

  const applyChanges = React.useCallback(
    async (changes: readonly PermissionMatrixChange[], recordUndo: boolean) => {
      if (readOnly || changes.length === 0) return;
      if (confirmChange) {
        const allowed = await confirmChange(changes);
        if (!allowed) return;
      }
      setGrid((current) => {
        const next = applyChangesToGrid(current, changes);
        setAnnouncement(announceChanges(changes, next, permissions, roles));
        return next;
      });
      if (recordUndo) undoStackRef.current = [...undoStackRef.current, [...changes]];
      onCellsChange?.(changes);
    },
    [readOnly, confirmChange, onCellsChange, permissions, roles],
  );

  /** Toggles an arbitrary cell by id, independent of the focused position — the ≤820px `Switch`-per-role card view has no grid/focus concept at all ("grid semantics are dropped entirely at that width, not compressed"), and a mouse click on any desktop cell targets its own cell directly rather than requiring the virtual focus to already be there. */
  const toggleCellAt = React.useCallback(
    (permissionId: string, roleId: string) => {
      if (isCellLocked(permissionId, roleId)) return;
      const granted = readGranted(grid, permissionId, roleId);
      void applyChanges([{ permissionId, roleId, granted: !granted }], true);
    },
    [applyChanges, grid, isCellLocked],
  );

  const setFocusPosition = React.useCallback((row: number, col: number) => {
    setFocus({ row, col });
  }, []);

  const toggleFocusedCell = React.useCallback(() => {
    const permission = permissions[focus.row];
    const role = roles[focus.col];
    if (!permission || !role || isCellLocked(permission.id, role.id)) return;
    const granted = readGranted(grid, permission.id, role.id);
    void applyChanges([{ permissionId: permission.id, roleId: role.id, granted: !granted }], true);
  }, [applyChanges, focus.col, focus.row, grid, isCellLocked, permissions, roles]);

  const toggleFocusedRow = React.useCallback(() => {
    const permission = permissions[focus.row];
    if (!permission) return;
    const eligible = roles.filter((role) => !isCellLocked(permission.id, role.id));
    const allGranted = eligible.every((role) => readGranted(grid, permission.id, role.id));
    const target = !allGranted;
    const changes = eligible
      .filter((role) => readGranted(grid, permission.id, role.id) !== target)
      .map((role) => ({ permissionId: permission.id, roleId: role.id, granted: target }));
    void applyChanges(changes, true);
  }, [applyChanges, focus.row, grid, isCellLocked, permissions, roles]);

  const toggleFocusedColumn = React.useCallback(() => {
    const role = roles[focus.col];
    if (!role) return;
    const eligible = permissions.filter((permission) => !isCellLocked(permission.id, role.id));
    const allGranted = eligible.every((permission) => readGranted(grid, permission.id, role.id));
    const target = !allGranted;
    const changes = eligible
      .filter((permission) => readGranted(grid, permission.id, role.id) !== target)
      .map((permission) => ({ permissionId: permission.id, roleId: role.id, granted: target }));
    void applyChanges(changes, true);
  }, [applyChanges, focus.col, grid, isCellLocked, permissions, roles]);

  const undo = React.useCallback(() => {
    const stack = undoStackRef.current;
    const last = stack[stack.length - 1];
    if (!last) return;
    undoStackRef.current = stack.slice(0, -1);
    const inverse = last.map((change) => ({ ...change, granted: !change.granted }));
    void applyChanges(inverse, false);
  }, [applyChanges]);

  const canUndo = React.useCallback(() => undoStackRef.current.length > 0, []);

  const moveFocusBy = React.useCallback(
    (deltaRow: number, deltaCol: number) => {
      setFocus((pos) => ({ row: clampRow(pos.row + deltaRow), col: clampCol(pos.col + deltaCol) }));
    },
    [clampRow, clampCol],
  );

  const moveFocusToRowEdge = React.useCallback(
    (edge: "start" | "end") => {
      setFocus((pos) => ({ ...pos, col: edge === "start" ? 0 : roles.length - 1 }));
    },
    [roles.length],
  );

  const moveFocusToGridEdge = React.useCallback(
    (edge: "start" | "end") => {
      setFocus(
        edge === "start"
          ? { row: 0, col: 0 }
          : { row: permissions.length - 1, col: roles.length - 1 },
      );
    },
    [permissions.length, roles.length],
  );

  const movePage = React.useCallback(
    (direction: 1 | -1) => {
      setFocus((pos) => ({ ...pos, row: clampRow(pos.row + direction * 5) }));
    },
    [clampRow],
  );

  return {
    grid,
    getGranted,
    isCellLocked,
    focus,
    announcement,
    moveFocusBy,
    moveFocusToRowEdge,
    moveFocusToGridEdge,
    movePage,
    setFocusPosition,
    toggleFocusedCell,
    toggleFocusedRow,
    toggleFocusedColumn,
    toggleCellAt,
    undo,
    canUndo,
  };
}

export { gridKey };
