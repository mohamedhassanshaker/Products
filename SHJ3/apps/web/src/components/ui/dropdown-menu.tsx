"use client";

import * as React from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuLabel = DropdownMenuPrimitive.Label;

/**
 * The logical side vocabulary this component's own public API uses — see
 * `resolvePhysicalSide` below. Deliberately duplicated from tooltip.tsx
 * rather than imported from a shared module: this codebase's own convention
 * for a small per-component recipe is to keep it local (button.tsx's
 * `FOCUS_VISIBLE_RING` docstring states this explicitly — "kept local per
 * atom rather than shared"). Radix's `side` is physical screen geometry with
 * no direction translation anywhere in `@radix-ui/react-popper` (confirmed
 * by reading its compiled source while building `Tooltip`, design-system.md
 * §10.1's corrected row) — every Popper-positioned molecule in this batch
 * re-derives the same three-line translation rather than one shared import.
 */
type LogicalSide = "top" | "bottom" | "inline-start" | "inline-end";

function resolvePhysicalSide(side: LogicalSide): "top" | "bottom" | "left" | "right" {
  if (side === "top" || side === "bottom") return side;
  const isRtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  if (side === "inline-start") return isRtl ? "right" : "left";
  return isRtl ? "left" : "right";
}

export interface DropdownMenuContentProps extends Omit<
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>,
  "side"
> {
  side?: LogicalSide;
}

export const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  DropdownMenuContentProps
>(function DropdownMenuContent(
  { className, sideOffset = 4, side = "bottom", align = "start", style, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        data-slot="dropdown-menu-content"
        side={resolvePhysicalSide(side)}
        align={align}
        sideOffset={sideOffset}
        style={{
          // §12.2/§4.8: no Tailwind v4 theme namespace bridges `--z-*`
          // (tailwind-theme.generated.css's own docstring), consumed raw
          // here exactly as tooltip.tsx and select.tsx already do.
          // `--z-popover` (1400), not `--z-dropdown` (1000) — Radix portals
          // this content to `document.body` regardless of DOM nesting, so a
          // DropdownMenu opened from inside a `Dialog` (`--z-modal`, 1300)
          // needs to sit above it, not below. See select.tsx's identical
          // note and tasks/lessons.md's z-index-in-dialog entry.
          zIndex: "var(--z-popover)",
          ...style,
        }}
        className={cn(
          "min-w-40 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});

export const DropdownMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Separator
      ref={ref}
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
});

// A type alias, not an (empty) `interface extends` — this project's lint
// config flags an interface that declares no members beyond its supertype
// (kbd.tsx's identical note).
type DropdownMenuItemSharedProps = Omit<
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>,
  "asChild"
>;

/**
 * `variant: "destructive"` requires `confirmationDescription`, mechanically
 * — the mirror of `Card`'s `interactive`/`asChild` and `SummaryStrip`'s
 * non-empty-tuple recipe. Design-system.md §5.4's own instruction for this
 * component is explicit that it must not be trivial to wire a destructive
 * item straight to an irreversible action with no seam for a confirmation,
 * while *also* saying not to build a whole confirmation `Dialog` here (that
 * organism is later work). `confirmationDescription` is that seam: a plain
 * sentence naming the object the action affects (e.g. "Remove Fatima S. from
 * the Support team"), which is exactly the text a future confirmation
 * `Dialog` needs to *"restate the object by name"* (§5.5 #53) — so a
 * destructive item cannot be constructed without already having the string
 * that confirmation UI will require, even though this component renders no
 * dialog itself.
 */
export type DropdownMenuItemProps =
  | (DropdownMenuItemSharedProps & { variant?: "default"; confirmationDescription?: undefined })
  | (DropdownMenuItemSharedProps & { variant: "destructive"; confirmationDescription: string });

/**
 * Row actions (B2's Clone/Publish/Archive, B9's Suspend/Remove) —
 * design-system.md §5.4 #30. `data-[highlighted]:` is Radix's own attribute
 * variant, not a design value — the token gate's arbitrary-*value* pattern
 * excludes a bracket immediately followed by `:` (design-system.md §5.4's
 * changelog entry on the atoms wave), so it is used directly here rather
 * than mirroring `Checkbox`'s hand-rolled JS state (this item's highlight
 * has no JS-owned glyph decision the way Checkbox's check/dash choice did).
 */
export const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  DropdownMenuItemProps
>(function DropdownMenuItem(
  { className, variant = "default", confirmationDescription, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      data-slot="dropdown-menu-item"
      data-variant={variant}
      data-confirmation={confirmationDescription}
      className={cn(
        // No `outline-none` here — matching select.tsx's identical `SelectItem`
        // recipe: a Radix collection item genuinely receives browser focus as
        // the user arrows through it, so leaving the native outline in place
        // (rather than stripping it and needing a replacement ring per
        // §10.3) is the established, already-reviewed pattern for this exact
        // shape of component in this codebase.
        "relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm select-none",
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:text-disabled-foreground",
        variant === "destructive" &&
          "text-destructive-strong data-[highlighted]:bg-destructive-subtle data-[highlighted]:text-destructive-strong",
        className,
      )}
      {...props}
    />
  );
});

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(function DropdownMenuCheckboxItem({ className, children, checked, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      ref={ref}
      // Conditional spread, not `checked={checked}`: under this project's
      // `exactOptionalPropertyTypes`, Radix's own `checked?: CheckedState`
      // (no `| undefined` in its declared type) rejects an *explicit*
      // `undefined` — checkbox.tsx and select.tsx's identical note.
      {...(checked !== undefined ? { checked } : {})}
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 ps-8 pe-2 text-sm select-none",
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:text-disabled-foreground",
        className,
      )}
      {...props}
    >
      <span className="absolute start-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-4" aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
});
