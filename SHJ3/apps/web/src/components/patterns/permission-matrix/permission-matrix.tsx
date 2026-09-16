"use client";

import * as React from "react";
import { Check, Lock, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useResolvedDir } from "@/components/ui/use-resolved-dir";
import { useIsBelowBreakpoint } from "@/components/ui/use-media-query";
import {
  usePermissionMatrixGrid,
  type PermissionMatrixChange,
  type PermissionMatrixEntity,
  type PermissionMatrixGrid,
} from "./use-permission-matrix-grid";

export type { PermissionMatrixChange, PermissionMatrixEntity, PermissionMatrixGrid };

export interface PermissionMatrixProps {
  /** Row headers — 8 in B9. */
  permissions: readonly PermissionMatrixEntity[];
  /** Column headers — 7 in B9. */
  roles: readonly PermissionMatrixEntity[];
  defaultValue: PermissionMatrixGrid;
  onCellsChange?: (changes: readonly PermissionMatrixChange[]) => void;
  /** B9's separation-of-duties confirmation ("Agent Designer can build but not publish") and any other domain rule a caller wants enforced before a change lands — see `use-permission-matrix-grid.ts`'s identical doc comment on why this hook stays generic rather than hardcoding role/permission names. */
  confirmChange?: (changes: readonly PermissionMatrixChange[]) => boolean | Promise<boolean>;
  /** A role structurally cannot hold a permission — `with-locked-cells`. */
  isLocked?: (permissionId: string, roleId: string) => boolean;
  /** The current viewer lacks edit rights on this matrix at all — `read-only`: cells render as check/dash glyphs instead of disabled checkboxes ("56 disabled controls is 56 pointless tab stops"), and every toggle key becomes a no-op. */
  readOnly?: boolean;
  onAddCustomRole?: () => void;
  addCustomRoleLabel?: string;
  /** A `<SummaryStrip variant="rule">` (or similar) rendered beneath the grid — B9's "Agent Designer can build but not publish" statement. Left as a slot: only the caller knows the real rule text for its own role/permission data. */
  ruleSummary?: React.ReactNode;
  /** Accessible name / visible `<caption>` for the grid. */
  caption: React.ReactNode;
  captionVisuallyHidden?: boolean;
  cardTitleLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Visually hidden accessible name for the row-header column's own corner cell — see the component body for why it needs one at all. */
  permissionColumnLabel?: string;
  className?: string;
}

/** See button.tsx for the full rationale. */
const FOCUS_VISIBLE_RING =
  "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]";

const DEFAULT_ADD_CUSTOM_ROLE_LABEL = "Add custom role";
const DEFAULT_PERMISSION_COLUMN_LABEL = "Permission";
const GRANTED_WORD = "granted";
const NOT_GRANTED_WORD = "not granted";
const LOCKED_WORD = "locked";

/**
 * `"Publish agents, Agent Designer, not granted"` — design-system.md §5.5
 * #43's own exact example, computed from live headers and state rather than
 * a static label (the same "real computed string" bar `wizard.tsx`'s
 * `composeStepAccessibleName` follows for its own chips).
 */
function composeCellAccessibleName(
  permission: PermissionMatrixEntity,
  role: PermissionMatrixEntity,
  granted: boolean,
  locked: boolean,
): string {
  const stateWord = locked ? LOCKED_WORD : granted ? GRANTED_WORD : NOT_GRANTED_WORD;
  return `${permission.label}, ${role.label}, ${stateWord}`;
}

function cellElementId(baseId: string, row: number, col: number): string {
  return `${baseId}-cell-${row}-${col}`;
}

/**
 * B9 tab 3's 7×8 permission grid (design-system.md §5.5 #43): *"This is the
 * hardest keyboard problem in the product and it gets an explicit model."*
 * The interaction/undo/focus state machine lives in `use-permission-matrix-
 * grid.ts`; this file is the `role="grid"` DOM, ARIA and keyboard-event
 * wiring around it.
 *
 * ## The keyboard model
 *
 * One tab stop for the whole grid (`tabIndex={0}` on the `<table>`'s
 * scrollable wrapper), `aria-activedescendant` tracking a *virtual* cursor —
 * real DOM focus never leaves the container, so the focused cell's ring is a
 * plain conditional style keyed off `focus.row`/`focus.col` matching the
 * cell being rendered, not `:focus-visible` (which cannot fire on an element
 * that is never actually focused). Every key in design-system.md §5.5 #43's
 * table is implemented — see `handleKeyDown` below — each with its own test
 * in `permission-matrix.test.tsx` asserting the real resulting
 * `aria-activedescendant`/`aria-checked`/announcement, not just that a
 * handler ran. `Tab`/`Shift+Tab` need no handler at all: with only one
 * focusable element inside the grid (the container itself), that is already
 * native browser behaviour.
 *
 * ## ≤820px
 *
 * Grid semantics are dropped entirely, not compressed (§5.5 #43): one `Card`
 * per role containing a real `Switch` per permission, each one its own,
 * independently focusable control — there is no virtual-focus/roving-cursor
 * model at this width at all, matching the spec's own "a 7-column grid on a
 * phone is unusable either way."
 */
export function PermissionMatrix({
  permissions,
  roles,
  defaultValue,
  onCellsChange,
  confirmChange,
  isLocked,
  readOnly = false,
  onAddCustomRole,
  addCustomRoleLabel = DEFAULT_ADD_CUSTOM_ROLE_LABEL,
  ruleSummary,
  caption,
  captionVisuallyHidden = false,
  cardTitleLevel = 3,
  permissionColumnLabel = DEFAULT_PERMISSION_COLUMN_LABEL,
  className,
}: PermissionMatrixProps): React.ReactElement {
  const dir = useResolvedDir();
  const isCompact = useIsBelowBreakpoint(820);
  const isRotated = !useIsBelowBreakpoint(1080);
  const baseId = React.useId();
  const [containerHasFocus, setContainerHasFocus] = React.useState(false);

  const grid = usePermissionMatrixGrid({
    permissions,
    roles,
    defaultValue,
    isLocked,
    onCellsChange,
    confirmChange,
    readOnly,
  });

  const focusedCellId = cellElementId(baseId, grid.focus.row, grid.focus.col);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const { key, shiftKey, ctrlKey, metaKey } = event;
      const modifier = ctrlKey || metaKey;

      switch (key) {
        case "ArrowUp":
          event.preventDefault();
          grid.moveFocusBy(-1, 0);
          return;
        case "ArrowDown":
          event.preventDefault();
          grid.moveFocusBy(1, 0);
          return;
        case "ArrowLeft":
          // §5.5 #43 RTL note: "horizontal arrow semantics reverse" — the
          // same `useResolvedDir()` mechanism every other Radix-adjacent
          // organism in this batch uses, applied to a hand-rolled grid.
          event.preventDefault();
          grid.moveFocusBy(0, dir === "rtl" ? 1 : -1);
          return;
        case "ArrowRight":
          event.preventDefault();
          grid.moveFocusBy(0, dir === "rtl" ? -1 : 1);
          return;
        case "Home":
          event.preventDefault();
          if (modifier) grid.moveFocusToGridEdge("start");
          else grid.moveFocusToRowEdge("start");
          return;
        case "End":
          event.preventDefault();
          if (modifier) grid.moveFocusToGridEdge("end");
          else grid.moveFocusToRowEdge("end");
          return;
        case "PageUp":
          event.preventDefault();
          grid.movePage(-1);
          return;
        case "PageDown":
          event.preventDefault();
          grid.movePage(1);
          return;
        case " ":
        case "Spacebar":
          event.preventDefault();
          if (ctrlKey) grid.toggleFocusedColumn();
          else if (shiftKey) grid.toggleFocusedRow();
          else grid.toggleFocusedCell();
          return;
        case "z":
        case "Z":
          if (modifier) {
            event.preventDefault();
            grid.undo();
          }
      }
    },
    [dir, grid],
  );

  if (isCompact) {
    return (
      <div data-slot="permission-matrix" data-variant="compact" className={className}>
        <p className="sr-only">{caption}</p>
        <LiveAnnouncement text={grid.announcement} />
        <div className="flex flex-col" style={{ gap: "var(--space-4)" }}>
          {roles.map((role) => (
            <Card key={role.id}>
              <CardHeader>
                <CardTitle level={cardTitleLevel}>{role.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
                  {permissions.map((permission) => {
                    const locked = grid.isCellLocked(permission.id, role.id);
                    const granted = grid.getGranted(permission.id, role.id);
                    const switchId = `${baseId}-switch-${permission.id}-${role.id}`;
                    return (
                      <div key={permission.id} className="flex items-center justify-between">
                        <Label htmlFor={switchId} className="min-w-0 flex-1">
                          {permission.label}
                          {locked ? (
                            <Icon
                              icon={Lock}
                              size={14}
                              className="ms-1 inline text-muted-foreground"
                            />
                          ) : null}
                        </Label>
                        <Switch
                          id={switchId}
                          checked={granted}
                          disabled={readOnly || locked}
                          onCheckedChange={() => grid.toggleCellAt(permission.id, role.id)}
                        />
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        {onAddCustomRole ? (
          <Button type="button" variant="outline" onClick={onAddCustomRole} className="mt-4">
            <Icon icon={Plus} size={16} className="me-1" />
            {addCustomRoleLabel}
          </Button>
        ) : null}
        {ruleSummary ? <div className="mt-4">{ruleSummary}</div> : null}
      </div>
    );
  }

  return (
    <div
      data-slot="permission-matrix"
      data-variant={readOnly ? "read-only" : "default"}
      className={className}
    >
      <LiveAnnouncement text={grid.announcement} />
      <div className="overflow-x-auto">
        {/* `role="grid"` (design-system.md §5.5 #43 — not `"application"`,
            which is `GraphCanvas`'s different model, §5.5 #44) lives on the
            `<table>` itself, alongside the single tab stop and the virtual
            `aria-activedescendant` cursor — the native `<th scope>`/`<td>`
            structure §5.5 #43's a11y paragraph also requires stays intact
            underneath the explicit grid role rather than living in a
            separate wrapper. */}
        <table
          role="grid"
          tabIndex={0}
          aria-activedescendant={focusedCellId}
          onKeyDown={handleKeyDown}
          onFocus={() => setContainerHasFocus(true)}
          onBlur={() => setContainerHasFocus(false)}
          className={cn("w-full border-collapse", FOCUS_VISIBLE_RING)}
        >
          <caption
            className={
              captionVisuallyHidden ? "sr-only" : "mb-2 text-start text-sm text-muted-foreground"
            }
          >
            {caption}
          </caption>
          <thead>
            <tr>
              {/* The row-header column's own corner cell — visually blank in
                  the wireframe, but axe's `empty-table-header` rule (WCAG
                  1.3.1: a header conveys structure, and structure with no
                  name conveys nothing) correctly rejects a `<th>` with
                  literally no accessible text, caught by this file's own
                  `jest-axe` run rather than assumed fine because it "looks"
                  like a normal empty corner cell. */}
              <th
                scope="col"
                className="sticky border-b border-border bg-surface-sunken text-start"
                style={{
                  insetInlineStart: 0,
                  inlineSize: "var(--matrix-header-inline-size)",
                  paddingInline: "var(--space-3)",
                  paddingBlock: "var(--space-2)",
                }}
              >
                <span className="sr-only">{permissionColumnLabel}</span>
              </th>
              {roles.map((role) => (
                <th
                  key={role.id}
                  scope="col"
                  className={cn(
                    "border-b border-border bg-surface-sunken text-sm font-semibold text-foreground",
                    isRotated && "whitespace-nowrap",
                  )}
                  style={{
                    inlineSize: "var(--matrix-cell-size)",
                    paddingInline: "var(--space-2)",
                    paddingBlock: "var(--space-2)",
                    writingMode: isRotated ? "vertical-rl" : "horizontal-tb",
                    transform: isRotated ? "rotate(180deg)" : undefined,
                  }}
                >
                  {role.label}
                </th>
              ))}
              {/* Rendered only when actually used — an unconditionally
                  present but usually-empty trailing `<th>` is the exact same
                  `empty-table-header` violation as the corner cell above,
                  and unlike the corner cell there is no structural row-
                  header column to visually-hide a label for: this column
                  exists *only* to hold the action. */}
              {onAddCustomRole ? (
                <th scope="col" className="border-b border-border bg-surface-sunken">
                  <Button type="button" variant="ghost" size="sm" onClick={onAddCustomRole}>
                    <Icon icon={Plus} size={14} className="me-1" />
                    {addCustomRoleLabel}
                  </Button>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {permissions.map((permission, row) => (
              <tr key={permission.id}>
                <th
                  scope="row"
                  className={cn(
                    "sticky border-b border-border bg-surface-sunken text-start text-sm font-medium text-foreground",
                    row === grid.focus.row && containerHasFocus && "bg-accent",
                  )}
                  style={{
                    insetInlineStart: 0,
                    inlineSize: "var(--matrix-header-inline-size)",
                    paddingInline: "var(--space-3)",
                    paddingBlock: "var(--space-2)",
                  }}
                >
                  {permission.label}
                </th>
                {roles.map((role, col) => {
                  const granted = grid.getGranted(permission.id, role.id);
                  const locked = grid.isCellLocked(permission.id, role.id);
                  const isFocused = row === grid.focus.row && col === grid.focus.col;
                  const inCrosshair = row === grid.focus.row || col === grid.focus.col;
                  return (
                    <td
                      key={role.id}
                      id={cellElementId(baseId, row, col)}
                      role="gridcell"
                      aria-label={composeCellAccessibleName(permission, role, granted, locked)}
                      onMouseDown={() => {
                        grid.setFocusPosition(row, col);
                        if (!readOnly) grid.toggleCellAt(permission.id, role.id);
                      }}
                      className={cn(
                        "border-b border-border text-center",
                        containerHasFocus && inCrosshair && "bg-accent",
                      )}
                      style={{
                        blockSize: "var(--matrix-cell-size)",
                        // Real DOM focus never leaves the `<table>` itself
                        // (the whole point of the single-tab-stop model), so
                        // this ring cannot be `:focus-visible` — it is a
                        // plain conditional style keyed off the *virtual*
                        // cursor matching this exact cell. No
                        // `outline-offset` override: this is a dense,
                        // `border-collapse` grid with cells flush against
                        // each other, so the *default* zero offset (drawing
                        // the ring flush with the cell's own edge) is what
                        // keeps it from bleeding into the neighbouring cell —
                        // unlike every other focus ring in this codebase,
                        // which has real margin around it and uses the
                        // standard positive `--focus-ring-offset`.
                        outline:
                          isFocused && containerHasFocus
                            ? "var(--focus-ring-width) solid var(--ring)"
                            : undefined,
                      }}
                    >
                      {readOnly ? (
                        <Icon
                          icon={locked ? Lock : granted ? Check : Minus}
                          size={16}
                          label={granted ? GRANTED_WORD : locked ? LOCKED_WORD : NOT_GRANTED_WORD}
                          className={
                            locked
                              ? "text-muted-foreground"
                              : granted
                                ? "text-success-strong"
                                : "text-muted-foreground"
                          }
                        />
                      ) : (
                        <Checkbox
                          checked={granted}
                          disabled={locked}
                          tabIndex={-1}
                          aria-hidden="true"
                          // Purely decorative here — the cell's own
                          // `aria-label` above is the real accessible name,
                          // and the toggle itself is driven by the grid's
                          // keyboard handler / this cell's `onMouseDown`, not
                          // by clicking the checkbox as its own control
                          // (which would give it a second, real tab stop —
                          // exactly what the virtual-focus model exists to
                          // avoid).
                          onCheckedChange={() => {}}
                        />
                      )}
                    </td>
                  );
                })}
                {/* Matches the header's own conditional column exactly — a
                    `<thead>` with N+1 columns and a `<tbody>` row with N+2
                    (or vice versa) is a real, if easy-to-miss, table
                    structure defect. */}
                {onAddCustomRole ? <td className="border-b border-border" /> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ruleSummary ? <div className="mt-4">{ruleSummary}</div> : null}
    </div>
  );
}

/** `role="status"`/`aria-live="polite"` — design-system.md §5.5 #43: "a polite live region announces the new value and the running total." */
function LiveAnnouncement({ text }: { text: string }): React.ReactElement {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {text}
    </span>
  );
}
