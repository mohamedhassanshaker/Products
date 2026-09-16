"use client";

import * as React from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/** See button.tsx for the full rationale. */
const FOCUS_VISIBLE_RING =
  "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

const TRIGGER_HEIGHT = {
  sm: "var(--control-height-sm)",
  default: "var(--input-height)",
} as const;

export interface SelectTriggerProps extends React.ComponentPropsWithoutRef<
  typeof SelectPrimitive.Trigger
> {
  size?: "sm" | "default";
  /** `mono` is for values that are themselves LTR-only content (an `mcp://` endpoint, a model id) — see input.tsx's identical rule (§11.3 rule 1). */
  variant?: "default" | "mono";
}

/**
 * Single choice from a short list (design-system.md §5.3 #5). Typeahead,
 * Home/End, Escape-to-close and focus-return are Radix's — not reimplemented
 * or overridden here.
 */
export const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  SelectTriggerProps
>(function SelectTrigger(
  { className, size = "default", variant = "default", style, children, ...props },
  ref,
) {
  const isMono = variant === "mono";

  return (
    <SelectPrimitive.Trigger
      ref={ref}
      data-slot="select-trigger"
      data-size={size}
      dir={isMono ? "ltr" : undefined}
      style={{
        borderRadius: "var(--input-radius)",
        height: TRIGGER_HEIGHT[size],
        paddingInline: "var(--space-3)",
        unicodeBidi: isMono ? "isolate" : undefined,
        ...style,
      }}
      className={cn(
        "flex w-fit items-center justify-between gap-2 border border-border-strong bg-input text-sm text-foreground",
        isMono && "font-mono",
        "transition-colors",
        "disabled:cursor-not-allowed disabled:border-border disabled:bg-disabled-surface disabled:text-disabled-foreground",
        "aria-invalid:border-destructive",
        FOCUS_VISIBLE_RING,
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

export const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent({ className, children, position = "popper", style, ...props }, ref) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        data-slot="select-content"
        position={position}
        style={{
          borderRadius: "var(--input-radius)",
          // §4.8/§12.2: named scale only, and no Tailwind v4 theme namespace
          // exists to bridge it (tailwind-theme.generated.css's own docstring
          // lists `--z-*` as unbridged), so it is consumed directly rather
          // than a hardcoded `z-50`. `--z-popover` (1400), not `--z-dropdown`
          // (1000): Radix portals this content to `document.body` regardless
          // of DOM nesting, so only the numeric z-index decides stacking —
          // `--z-dropdown` sits BELOW `Dialog`'s own overlay (`--z-overlay`,
          // 1200) and content (`--z-modal`, 1300), making a Select opened
          // from inside any Dialog genuinely rendered behind it and
          // unclickable, not just visually off (confirmed live: "Register
          // MCP server" dialog's Transport/Authentication selects). The
          // token scale's own `--z-popover` is exactly the semantic for
          // "must float above a modal, below toast/tooltip" — see
          // tasks/lessons.md's z-index-in-dialog entry.
          zIndex: "var(--z-popover)",
          ...style,
        }}
        className={cn(
          "max-h-(--radix-select-content-available-height) min-w-32 overflow-x-hidden overflow-y-auto",
          "border border-border bg-popover text-popover-foreground shadow-md",
          className,
        )}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-(--radix-select-trigger-height) w-full min-w-(--radix-select-trigger-width)",
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

export const SelectLabel = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(function SelectLabel({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Label
      ref={ref}
      data-slot="select-label"
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
});

export const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(function SelectItem({ className, disabled, children, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      // See checkbox.tsx's identical note: conditional spread avoids passing
      // an explicit `undefined` against Radix's `disabled?: boolean` under
      // `exactOptionalPropertyTypes`.
      {...(disabled !== undefined ? { disabled } : {})}
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 ps-2 pe-8 text-sm select-none",
        "focus:bg-accent focus:text-accent-foreground",
        disabled && "pointer-events-none text-disabled-foreground",
        className,
      )}
      {...props}
    >
      <span className="absolute end-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4" aria-hidden="true" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
});

export const SelectSeparator = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(function SelectSeparator({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Separator
      ref={ref}
      data-slot="select-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
});

export const SelectScrollUpButton = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(function SelectScrollUpButton({ className, ...props }, ref) {
  return (
    <SelectPrimitive.ScrollUpButton
      ref={ref}
      data-slot="select-scroll-up-button"
      className={cn("flex cursor-default items-center justify-center py-1", className)}
      {...props}
    >
      <ChevronUp className="size-4" aria-hidden="true" />
    </SelectPrimitive.ScrollUpButton>
  );
});

export const SelectScrollDownButton = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(function SelectScrollDownButton({ className, ...props }, ref) {
  return (
    <SelectPrimitive.ScrollDownButton
      ref={ref}
      data-slot="select-scroll-down-button"
      className={cn("flex cursor-default items-center justify-center py-1", className)}
      {...props}
    >
      <ChevronDown className="size-4" aria-hidden="true" />
    </SelectPrimitive.ScrollDownButton>
  );
});
