"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";

/** See button.tsx for the full rationale — identical recipe, kept local per component rather than shared. */
const FOCUS_VISIBLE_RING =
  "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]";

/**
 * Confirmations, `NodeInspector` on small screens, "+ Add" forms
 * (design-system.md §5.5 #53). Radix `Dialog`.
 *
 * **Focus trap, `Escape`, focus return — confirmed by reading
 * `@radix-ui/react-dialog`'s actual type surface, not assumed** (the same
 * discipline `tooltip.tsx`/`sub-tab-bar.tsx`/`use-resolved-dir.ts` all apply
 * to a claim about Radix behaviour before relying on it): `DialogContentImplProps`
 * carries `trapFocus` (backed by `@radix-ui/react-focus-scope`'s `FocusScope`)
 * and `onCloseAutoFocus` (which is what returns focus to the trigger once the
 * dialog unmounts) — both wired internally by `Dialog.Content`, not
 * reimplemented here. `Escape` and outside-pointer dismissal come from the
 * same internal `DismissableLayer` every Radix overlay in this codebase
 * already relies on (`DropdownMenu`, `Select`, `Combobox`).
 *
 * **`aria-labelledby`/`aria-describedby` — also confirmed, not assumed, and
 * with a real nuance**: reading `@radix-ui/react-dialog`'s compiled source
 * directly shows `Content` sets `aria-labelledby`/`aria-describedby`
 * *conditionally* — only once a `Dialog.Title`/`Dialog.Description` actually
 * mounts (tracked via a mounted-count in context), not unconditionally. So
 * `DialogTitle` is effectively mandatory for every real dialog in this
 * codebase (a title-less dialog silently drops `aria-labelledby` rather than
 * erroring), and `DialogDescription` should be supplied whenever there is
 * real explanatory text — both are exported here as thin, styled wrappers
 * around Radix's own `Title`/`Description`, never reimplemented.
 *
 * **Centering avoids the classic `inset-inline-start: 50%` +
 * `translateX(-50%)` RTL trap.** That combination is asymmetric under RTL —
 * `inset-inline-start: 50%` anchors the box's *inline-start* edge (the
 * right edge in RTL) at the midpoint, but a fixed `translateX(-50%)` always
 * shifts left regardless of direction, so the two cancel out correctly only
 * in LTR and land the box a full box-width off-centre in RTL. Verified by
 * working through the geometry by hand before writing any centering CSS at
 * all, rather than shipping the common inset+transform recipe and finding
 * out later. Centering here uses plain flexbox instead
 * (`items-center justify-center` on the fixed, full-viewport `Content` root,
 * with the visible dialog box as a normal in-flow flex child) — inherently
 * direction-symmetric, since `justify-content: center` needs no per-direction
 * math at all.
 *
 * `Sheet` (bottom/side variant) is exported from the same file as a set of
 * thin aliases over the identical Radix primitive — see the `Sheet*` exports
 * below — because a sheet *is* a `Dialog`, only positioned at a viewport edge
 * instead of centred (§5.5 #53's own framing). Its edge positioning
 * (`SheetContent`) uses real CSS logical properties
 * (`inset-inline-start`/`inset-inline-end`), so — unlike `Tooltip`/
 * `DropdownMenu`'s Popper-`side`, which is physical-only and needed a manual
 * `resolvePhysicalSide` translation (§10.1) — RTL correctness here comes from
 * the browser's own CSS engine with no JS direction-reading of any kind.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, style, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      data-slot="dialog-overlay"
      style={{ zIndex: "var(--z-modal)", ...style }}
      className={cn("fixed inset-0 bg-overlay", className)}
      {...props}
    />
  );
});

const DIALOG_MAX_INLINE_SIZE_BY_SIZE = { sm: "24rem", md: "32rem", lg: "40rem" } as const;
export type DialogSize = keyof typeof DIALOG_MAX_INLINE_SIZE_BY_SIZE;

export interface DialogContentProps extends Omit<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
  "className"
> {
  size?: DialogSize;
  /** Renders a labelled corner close affordance. Default `true` — omit only when the footer already supplies an equivalent, unambiguous dismiss action. */
  showCloseButton?: boolean;
  /** Accessible name for the corner close button. Default is English; pass a translated string in real feature code. */
  closeLabel?: string;
  className?: string;
  boxClassName?: string;
}

/**
 * The centred dialog box. Bundles `Portal` + `Overlay` internally (matching
 * `dropdown-menu.tsx`/`select.tsx`'s established "Content bundles its own
 * portal" shape) so a caller composes only `Dialog` → `DialogTrigger` →
 * `DialogContent`, never a separate manual `Portal`/`Overlay` assembly.
 */
export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(function DialogContent(
  {
    size = "md",
    showCloseButton = true,
    closeLabel = "Close",
    className,
    boxClassName,
    style,
    children,
    ...props
  },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="dialog-content"
        style={{ zIndex: "var(--z-modal)", padding: "var(--space-4)", ...style }}
        className={cn(
          "fixed inset-0 flex items-center justify-center overflow-y-auto",
          FOCUS_VISIBLE_RING,
          className,
        )}
        {...props}
      >
        <div
          className={cn(
            "relative w-full rounded-lg border border-border bg-card text-card-foreground shadow-xl",
            boxClassName,
          )}
          style={{
            maxInlineSize: DIALOG_MAX_INLINE_SIZE_BY_SIZE[size],
            maxBlockSize: "90vh",
            overflowY: "auto",
            padding: "var(--space-6)",
          }}
        >
          {children}
          {showCloseButton ? (
            <DialogPrimitive.Close asChild>
              <IconButton
                ariaLabel={closeLabel}
                variant="ghost"
                size="sm"
                className="absolute"
                style={{ insetBlockStart: "var(--space-3)", insetInlineEnd: "var(--space-3)" }}
              >
                <Icon icon={X} size={16} mirrorInRtl={false} />
              </IconButton>
            </DialogPrimitive.Close>
          ) : null}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export const DialogHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function DialogHeader({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="dialog-header"
        className={cn("flex flex-col", className)}
        style={{ gap: "var(--space-1)", paddingInlineEnd: "var(--space-6)" }}
        {...props}
      />
    );
  },
);

export const DialogFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function DialogFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="dialog-footer"
        className={cn("flex items-center justify-end", className)}
        style={{ gap: "var(--space-2)", marginBlockStart: "var(--space-5)" }}
        {...props}
      />
    );
  },
);

export const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      data-slot="dialog-title"
      className={cn("text-md font-semibold text-foreground", className)}
      {...props}
    />
  );
});

export const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
});

// ---------------------------------------------------------------------------
// Sheet — the identical Radix Dialog primitive, positioned at a viewport
// edge instead of centred (design-system.md §5.5 #53). `NodeInspector`'s
// later ≤820px bottom-sheet form is the concrete consumer this is built
// general enough to plausibly serve, per this wave's brief — not built here.
// ---------------------------------------------------------------------------

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetHeader = DialogHeader;
export const SheetFooter = DialogFooter;
export const SheetTitle = DialogTitle;
export const SheetDescription = DialogDescription;

export type SheetSide = "bottom" | "inline-start" | "inline-end";

/**
 * Edge/size geometry per side. Bottom is the phone/tablet form factor
 * (`NodeInspector`'s stated future use); the two inline sides are kept
 * general per the brief's "plausibly could serve" bar rather than dropped.
 * Real CSS logical properties throughout — `insetInlineStart`/
 * `insetInlineEnd` flip under `dir="rtl"` with no JS involved, unlike
 * Popper's `side` (see this file's module doc comment).
 */
const sheetContentVariants = cva("fixed border-border bg-card text-card-foreground shadow-xl", {
  variants: {
    side: {
      bottom: "border-t",
      "inline-start": "border-e",
      "inline-end": "border-s",
    },
  },
});

export interface SheetContentProps extends Omit<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
  "className"
> {
  side?: SheetSide;
  showCloseButton?: boolean;
  closeLabel?: string;
  className?: string;
}

/**
 * Built only from the individual logical-inset utilities this codebase has
 * already proven out (`start-*`/`end-*` in `dropdown-menu.tsx`/`select.tsx`,
 * `border-s`/`border-e` in `card.tsx`) rather than the combined
 * `inset-inline-*`/`inset-block-*` shorthand forms, which appear nowhere
 * else in this repository and have not been confirmed against a real
 * compiled build — "full inline width" is `start-0 end-0` together, "full
 * block height" is the direction-neutral `top-0 bottom-0` (block start/end
 * never reverses under RTL, so the plain physical utilities are correct
 * as-is, the same reasoning `border-b` gets elsewhere in this wave).
 */
const SHEET_GEOMETRY: Readonly<
  Record<SheetSide, { style: React.CSSProperties; className: string }>
> = {
  bottom: {
    style: { maxBlockSize: "85vh" },
    className: "start-0 end-0 bottom-0 w-full rounded-t-xl",
  },
  "inline-start": {
    style: { maxInlineSize: "24rem" },
    className: "top-0 bottom-0 start-0 h-full w-full",
  },
  "inline-end": {
    style: { maxInlineSize: "24rem" },
    className: "top-0 bottom-0 end-0 h-full w-full",
  },
};

export const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(function SheetContent(
  {
    side = "bottom",
    showCloseButton = true,
    closeLabel = "Close",
    className,
    style,
    children,
    ...props
  },
  ref,
) {
  const geometry = SHEET_GEOMETRY[side];

  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="sheet-content"
        data-side={side}
        style={{ zIndex: "var(--z-modal)", ...geometry.style, ...style }}
        className={cn(
          sheetContentVariants({ side }),
          geometry.className,
          "flex flex-col overflow-y-auto",
          FOCUS_VISIBLE_RING,
          className,
        )}
        {...props}
      >
        <div style={{ padding: "var(--space-6)" }} className="flex min-h-0 flex-1 flex-col">
          {children}
        </div>
        {showCloseButton ? (
          <DialogPrimitive.Close asChild>
            <IconButton
              ariaLabel={closeLabel}
              variant="ghost"
              size="sm"
              className="absolute"
              style={{ insetBlockStart: "var(--space-3)", insetInlineEnd: "var(--space-3)" }}
            >
              <Icon icon={X} size={16} mirrorInRtl={false} />
            </IconButton>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

// ---------------------------------------------------------------------------
// DestructiveConfirmDialog
// ---------------------------------------------------------------------------

function defaultDestructiveDescriptionTemplate(objectName: string): string {
  return `${objectName} will be affected by this action, and it cannot be undone.`;
}

export interface DestructiveConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** e.g. "Archive this agent?", "Remove team member?" */
  title: string;
  /**
   * The object's name, restated verbatim in the body copy — §5.5 #53:
   * *"Destructive confirmations restate the object by name … never a bare
   * 'OK'."* Required, with no default, mirroring exactly how
   * `dropdown-menu.tsx`'s destructive `DropdownMenuItem` variant requires
   * `confirmationDescription` — the same mechanism, applied one level up:
   * a caller cannot construct this dialog without supplying the name of the
   * thing it is about to affect.
   */
  objectName: string;
  /**
   * Renders the full body sentence from `objectName` — a template, not a
   * freeform `description`, for the same reason `EmptyState`'s
   * `causeTemplate` is a template: composing a sentence by string
   * concatenation across a translated boundary is exactly what §11.3 rule 4
   * warns against. Default is an English template; pass a translated one in
   * real feature code.
   */
  descriptionTemplate?: (objectName: string) => React.ReactNode;
  /**
   * The primary action's real verb — "Archive", "Remove", "Delete" —
   * required, with no default, so a bare "OK"/"Confirm" cannot happen by
   * omission; the button always renders exactly this text.
   */
  actionLabel: string;
  onConfirm: () => void;
  /** Default is English; pass a translated string in real feature code. */
  cancelLabel?: string;
  /** §5.2 loading: the primary action is busy (e.g. an in-flight delete request) — mirrors `Button`'s own `loading` contract. */
  confirming?: boolean;
}

/**
 * The one, structurally-enforced way to ask "are you sure?" before an
 * irreversible action in this codebase (design-system.md §5.5 #53). Composed
 * entirely from the primitives above and the real `Button` atom — never a
 * bespoke confirm affordance built ad hoc at a call site.
 */
export function DestructiveConfirmDialog({
  open,
  onOpenChange,
  title,
  objectName,
  descriptionTemplate = defaultDestructiveDescriptionTemplate,
  actionLabel,
  onConfirm,
  cancelLabel = "Cancel",
  confirming = false,
}: DestructiveConfirmDialogProps): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{descriptionTemplate(objectName)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" type="button" disabled={confirming}>
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button variant="destructive" type="button" loading={confirming} onClick={onConfirm}>
            {actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
