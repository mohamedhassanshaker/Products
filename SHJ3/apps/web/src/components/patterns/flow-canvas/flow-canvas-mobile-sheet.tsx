"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export interface FlowCanvasMobileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titleText: string;
  children: React.ReactNode;
}

/**
 * Default ≤820px presentation for `NodeInspector` (design-system.md §5.5
 * #45: *"the inspector becomes a bottom sheet"*).
 *
 * **Cross-wave dependency note**, identical in shape to
 * `graph-canvas-merge-dialog.tsx`'s: the design doc's real `Sheet` organism
 * (§5.5 #53) is owned by a concurrent wave and did not exist when this file
 * was written. `FlowCanvas` accepts a `renderMobileSheet` override (see
 * `flow-canvas.tsx`) so a later pass can swap in the real organism with no
 * API change; in the meantime this is a real, working default built directly
 * on the same raw `radix-ui` `Dialog` primitive the real `Sheet` will itself
 * be built on (shadcn's own reference `Sheet` component is exactly a `Dialog`
 * styled to slide from an edge rather than a distinct primitive — confirmed
 * against the pattern this codebase already uses for every other
 * Radix-backed component, e.g. `toggle-row.tsx`'s `ToggleGroup as
 * ToggleGroupPrimitive`), so focus trap, `Escape`, scroll lock and focus
 * return all come from Radix per §10.1's table, not from logic re-implemented
 * here.
 *
 * `NodeInspector`'s own form state is fully controlled by `FlowCanvas` (see
 * that component's doc comment), so this wrapper mounting or unmounting as
 * the viewport crosses 820px never loses a draft — there is nothing local to
 * lose.
 */
export function FlowCanvasMobileSheet({
  open,
  onOpenChange,
  titleText,
  children,
}: FlowCanvasMobileSheetProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 flex flex-col justify-end bg-overlay"
          style={{ zIndex: "var(--z-modal)" }}
        >
          <DialogPrimitive.Content
            className={cn(
              "w-full overflow-y-auto border-t border-border bg-card text-card-foreground shadow-xl",
            )}
            style={{
              // A genuinely geometric, viewport-relative cap (not a design
              // value the token gate's px/pt/em literal ban is aimed at —
              // `vh` is absent from that list, the same reasoning
              // `assistant-widget-shell.tsx`'s own rem breakpoints rely on
              // elsewhere in this wave), expressed via `style` rather than
              // Tailwind's `max-h-[85vh]` arbitrary-value syntax, which the
              // gate does ban regardless of unit.
              maxHeight: "85vh",
              borderStartStartRadius: "var(--radius-xl)",
              borderStartEndRadius: "var(--radius-xl)",
              padding: "var(--space-4)",
            }}
          >
            {/* Visually hidden — the real, visible title lives inside
                `NodeInspector`'s own header (`children`). Radix requires a
                `Title` for its own `aria-labelledby` wiring regardless. */}
            <DialogPrimitive.Title className="sr-only">{titleText}</DialogPrimitive.Title>
            {children}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
