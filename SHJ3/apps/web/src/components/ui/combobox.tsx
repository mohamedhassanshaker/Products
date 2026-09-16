"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { Command } from "cmdk";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

/**
 * See dropdown-menu.tsx's identical note: Radix's `side` is physical screen
 * geometry with no direction translation, so a component that publishes its
 * own logical `side` translates it locally — kept per-component rather than
 * a shared import, matching button.tsx's `FOCUS_VISIBLE_RING` precedent for
 * small per-component recipes.
 */
type LogicalSide = "top" | "bottom" | "inline-start" | "inline-end";

function resolvePhysicalSide(side: LogicalSide): "top" | "bottom" | "left" | "right" {
  if (side === "top" || side === "bottom") return side;
  const isRtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  if (side === "inline-start") return isRtl ? "right" : "left";
  return isRtl ? "left" : "right";
}

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface ComboboxSharedProps {
  /** Accessible name for the whole control — becomes cmdk's own visually-hidden `<label>` (confirmed by reading `cmdk`'s compiled source: its root renders a real `<label htmlFor>` from this prop, associated with the search `<input>`). */
  label: string;
  options: readonly ComboboxOption[];
  /** Trigger text when nothing is selected. */
  placeholder?: string;
  searchPlaceholder?: string;
  /** "no-results" state text. */
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  /** "loading" state — async's results have not arrived yet. */
  loading?: boolean;
  /** "creating" state — offered as `Create "<search>"` when no option matches the current search. */
  onCreate?: (search: string) => void;
}

interface SingleProps extends ComboboxSharedProps {
  variant?: "single";
  value: string | null;
  onValueChange: (value: string | null) => void;
}

interface MultiProps extends ComboboxSharedProps {
  variant: "multi";
  value: readonly string[];
  onValueChange: (value: readonly string[]) => void;
}

interface AsyncProps extends ComboboxSharedProps {
  variant: "async";
  value: string | null;
  onValueChange: (value: string | null) => void;
  /** Caller owns the actual search (a debounced API call, typically) — `options` should already reflect the latest results. */
  onSearchChange: (search: string) => void;
}

export type ComboboxProps = SingleProps | MultiProps | AsyncProps;

function isSelected(props: ComboboxProps, value: string): boolean {
  return props.variant === "multi" ? props.value.includes(value) : props.value === value;
}

function triggerLabel(props: ComboboxProps): string | undefined {
  if (props.variant === "multi") {
    if (props.value.length === 0) return undefined;
    if (props.value.length === 1) {
      return (
        props.options.find((option) => option.value === props.value[0])?.label ?? props.value[0]
      );
    }
    return `${props.value.length} selected`;
  }
  if (props.value === null) return undefined;
  return props.options.find((option) => option.value === props.value)?.label ?? props.value;
}

/**
 * Long lists — agent picker, entity picker, node parent (design-system.md
 * §5.4 #31). Radix `Popover` for positioning/dismissal, `cmdk`'s `Command`
 * for the filterable listbox — `Command.Input` already renders
 * `aria-autocomplete="list"`, `role="combobox"` and a live
 * `aria-activedescendant` pointing at the highlighted option (confirmed by
 * reading `cmdk@1.1.1`'s compiled source directly rather than assuming;
 * nothing here re-implements what it already does correctly).
 */
export const Combobox = React.forwardRef<HTMLButtonElement, ComboboxProps>(
  function Combobox(props, ref) {
    const {
      label,
      options,
      placeholder = "Select…",
      searchPlaceholder = "Search…",
      emptyText = "No results",
      disabled = false,
      className,
      loading = false,
      onCreate,
    } = props;
    const [open, setOpen] = React.useState(false);
    const [search, setSearch] = React.useState("");

    // Plain functions, not `useCallback` — this project has no react-hooks
    // lint plugin wired (confirmed: referencing `react-hooks/exhaustive-deps`
    // in a disable comment itself fails eslint with "rule was not found"), and
    // a memoised identity buys nothing here since `Command.Input`/`Command.Item`
    // are not memoised children that would skip a re-render from it.
    function handleSearchChange(value: string) {
      setSearch(value);
      if (props.variant === "async") props.onSearchChange(value);
    }

    function handleSelect(value: string) {
      if (props.variant === "multi") {
        const next = props.value.includes(value)
          ? props.value.filter((existing) => existing !== value)
          : [...props.value, value];
        props.onValueChange(next);
        return;
      }
      props.onValueChange(value);
      setOpen(false);
    }

    const hasExactMatch = options.some(
      (option) => option.label.toLowerCase() === search.trim().toLowerCase(),
    );
    const showCreate = Boolean(onCreate) && search.trim().length > 0 && !hasExactMatch;

    return (
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger asChild>
          <button
            ref={ref}
            type="button"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            data-slot="combobox-trigger"
            style={{
              borderRadius: "var(--input-radius)",
              height: "var(--input-height)",
              paddingInline: "var(--space-3)",
            }}
            className={cn(
              "flex w-full items-center justify-between gap-2 border border-border-strong bg-input text-start text-sm text-foreground",
              "disabled:cursor-not-allowed disabled:border-border disabled:bg-disabled-surface disabled:text-disabled-foreground",
              "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]",
              className,
            )}
          >
            <span
              className={cn(
                "truncate",
                triggerLabel(props) === undefined && "text-muted-foreground",
              )}
            >
              {triggerLabel(props) ?? placeholder}
            </span>
            <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            data-slot="combobox-content"
            // Radix's `Popover.Content` renders `role="dialog"` by default,
            // which axe's `aria-dialog-name` rule (WCAG 4.1.2) correctly flags
            // with no accessible name of its own — a real finding from this
            // component's own `jest-axe` run, not a hypothetical (matching how
            // `ProgressBar`'s `aria-labelledby` gap was found the same way).
            // `label` is already this control's own accessible name (it names
            // `Command`'s hidden `<label>` too), so it names the popover as well.
            aria-label={label}
            side={resolvePhysicalSide("bottom")}
            align="start"
            sideOffset={4}
            // `--z-popover` (1400), not `--z-dropdown` (1000) — Radix portals this
            // content to `document.body` regardless of DOM nesting, so a Combobox
            // opened from inside a `Dialog` (`--z-modal`, 1300) needs to sit above
            // it, not below. See select.tsx's identical note and
            // tasks/lessons.md's z-index-in-dialog entry.
            style={{ zIndex: "var(--z-popover)" }}
            className="w-(--radix-popover-trigger-width) overflow-hidden rounded-md border border-border bg-popover p-0 text-popover-foreground shadow-md"
          >
            <Command
              label={label}
              shouldFilter={props.variant !== "async"}
              className="flex flex-col"
            >
              <Command.Input
                value={search}
                onValueChange={handleSearchChange}
                placeholder={searchPlaceholder}
                className={cn(
                  "border-b border-border bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground",
                  // Real text input, not a Radix collection item — the same
                  // ring recipe button.tsx/select.tsx use, not the "leave the
                  // native outline alone" precedent dropdown-menu.tsx's items
                  // use (those receive Radix-managed roving focus with their
                  // own highlight visual; this is a plain focusable `<input>`).
                  "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]",
                )}
                style={{ height: "var(--control-height-sm)" }}
              />
              <Command.List className="max-h-64 overflow-y-auto p-1">
                {loading ? (
                  <Command.Loading className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                    <Spinner size="xs" />
                    Loading…
                  </Command.Loading>
                ) : (
                  <>
                    {showCreate ? (
                      <Command.Item
                        value={`__create__:${search}`}
                        onSelect={() => onCreate?.(search)}
                        className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                      >
                        <Plus aria-hidden="true" className="size-4" />
                        Create “{search}”
                      </Command.Item>
                    ) : null}
                    <Command.Empty className="px-2 py-4 text-center text-sm text-muted-foreground">
                      {emptyText}
                    </Command.Empty>
                    {options.map((option) => {
                      const selected = isSelected(props, option.value);
                      return (
                        <Command.Item
                          key={option.value}
                          value={option.label}
                          // Conditional spread, not `disabled={option.disabled}`:
                          // under this project's `exactOptionalPropertyTypes`,
                          // cmdk's own `disabled?: boolean` (no `| undefined` in
                          // its declared type) rejects an explicit `undefined` —
                          // checkbox.tsx/select.tsx/dropdown-menu.tsx's identical note.
                          {...(option.disabled !== undefined ? { disabled: option.disabled } : {})}
                          onSelect={() => handleSelect(option.value)}
                          className={cn(
                            "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                            "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
                            "data-[disabled=true]:pointer-events-none data-[disabled=true]:text-disabled-foreground",
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center",
                              !selected && "invisible",
                            )}
                          >
                            <Check aria-hidden="true" className="size-4" />
                          </span>
                          {option.label}
                        </Command.Item>
                      );
                    })}
                  </>
                )}
              </Command.List>
            </Command>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    );
  },
);
