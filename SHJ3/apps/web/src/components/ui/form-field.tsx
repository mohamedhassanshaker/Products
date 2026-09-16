"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "./label";
import { IconButton } from "./icon-button";
import { Icon } from "./icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

/** The four props `FormField` generates and hands to the control it wires up. */
export interface FormFieldControlProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
}

export interface FormFieldProps {
  label: React.ReactNode;
  labelVariant?: "default" | "required" | "optional";
  requiredText?: string;
  optionalText?: string;
  /** Help text, shown below the control while there is no error. */
  help?: React.ReactNode;
  /**
   * A compact `(i)` icon rendered beside the label, opening a `Tooltip` with this content on
   * hover/focus — additive to `help` (which stays visible), for guidance that would clutter
   * the field if always shown as a permanent line (e.g. "which of these ten fields do I
   * actually need to fill in, and why"). Never the *only* way to reach essential information
   * (`tooltip.tsx`'s own caution) — pair with `help`/inline copy for anything a field cannot
   * be used correctly without.
   */
  labelHelp?: React.ReactNode;
  /** The help icon's own accessible name — field-specific text is more useful to a screen reader than a generic "more info" repeated on every field, so callers are encouraged to supply one (e.g. `t("fieldSlotNameHelpAriaLabel")`); falls back to a generic default when omitted. */
  labelHelpAriaLabel?: string;
  /** Presence alone marks the field invalid (`aria-invalid`) — this is the *only* signal, there is no separate `invalid` boolean to fall out of sync with it. */
  error?: React.ReactNode;
  variant?: "stacked" | "inline" | "horizontal";
  /** Overrides the generated id — most callers should omit this and let `useId` supply one. */
  id?: string;
  className?: string;
  /**
   * Render-prop, not `React.cloneElement` over a single child: a control can
   * be a whole small tree (`Input` plus an adornment, a `Combobox`, a custom
   * composite), and `cloneElement` can only guess whether the thing it is
   * cloning actually forwards `id`/`aria-*` at all. A function that receives
   * the exact props to spread is correct by construction — the caller wires
   * them by hand once, and TypeScript enforces that all four are used.
   */
  children: (field: FormFieldControlProps) => React.ReactNode;
}

const CONTAINER_CLASS_BY_VARIANT: Record<NonNullable<FormFieldProps["variant"]>, string> = {
  stacked: "flex flex-col",
  inline: "flex flex-row flex-wrap items-baseline",
  horizontal: "flex flex-row items-baseline",
};

/**
 * Label + control + help + error, one wiring point (design-system.md §5.4
 * #26). This is **the only sanctioned way to render a labelled control** —
 * §12.3's `no-bare-input` rule exists precisely to catch a bare `Input` used
 * directly in feature code instead of through this component, the same
 * mechanical enforcement `Badge.label` gives §6.1.
 *
 * Generates `id` (via `useId`, unless the caller overrides it — e.g. to match
 * a server-validated field name), `aria-describedby` (pointing at whichever
 * *one* of the help/error text nodes is actually rendered — see below for why
 * it is never both), and `aria-invalid` (present, `true`, exactly when
 * `error` is present — there is no separate boolean to drift out of sync with
 * it) — and hands all three plus the id to the caller's render prop, which
 * applies them to the actual control. See `FormFieldControlProps` above for
 * why this is a render prop rather than `React.cloneElement`.
 *
 * **`error` replaces `help`, rather than both stacking at once.** A field is
 * in exactly one of its default/help or error state at a time (§5.2's state
 * model), and showing both simultaneously is redundant clutter that also
 * invites a dangling `aria-describedby` reference the moment either text node
 * is conditionally unmounted independently of the other.
 *
 * `horizontal`'s label column uses a modest default width
 * (`--space-24`, `shrink-0`) rather than none at all, but does **not**
 * attempt to align columns *across* multiple `FormField` instances — that is
 * a shared-grid concern for whatever screen composes several of them, not
 * something one field can solve alone without an external contract.
 */
export const FormField = React.forwardRef<HTMLDivElement, FormFieldProps>(function FormField(
  {
    label,
    labelVariant = "default",
    requiredText,
    optionalText,
    help,
    labelHelp,
    labelHelpAriaLabel,
    error,
    variant = "stacked",
    id,
    className,
    children,
  },
  ref,
) {
  const generatedId = React.useId();
  const fieldId = id ?? generatedId;
  // Error replaces help rather than stacking under it: both being visible
  // at once is redundant clutter, and a field is in exactly one of its
  // default/help or error state at a time (§5.2's model), never both. Only
  // whichever text node actually renders gets an id and is referenced by
  // `aria-describedby` — referencing an id that belongs to a paragraph this
  // render never mounts would be a dangling ARIA reference, a real (if
  // subtle) accessibility bug, not merely an unused variable.
  const showError = error !== undefined;
  const helpId = !showError && help !== undefined ? `${fieldId}-help` : undefined;
  const errorId = showError ? `${fieldId}-error` : undefined;
  const describedBy = errorId ?? helpId;

  return (
    <div
      ref={ref}
      data-slot="form-field"
      className={cn(CONTAINER_CLASS_BY_VARIANT[variant], className)}
      style={{ gap: variant === "stacked" ? "var(--space-1)" : "var(--space-3)" }}
    >
      <div
        className={cn("flex items-center", variant === "horizontal" ? "shrink-0" : undefined)}
        style={{
          gap: "var(--space-1)",
          ...(variant === "horizontal"
            ? { inlineSize: "var(--space-24)", paddingBlockStart: "var(--space-2)" }
            : {}),
        }}
      >
        <Label
          htmlFor={fieldId}
          variant={labelVariant}
          {...(requiredText !== undefined ? { requiredText } : {})}
          {...(optionalText !== undefined ? { optionalText } : {})}
        >
          {label}
        </Label>
        {labelHelp !== undefined ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <IconButton
                ariaLabel={labelHelpAriaLabel ?? "More information"}
                variant="ghost"
                size="sm"
                type="button"
              >
                <Icon icon={Info} size={14} />
              </IconButton>
            </TooltipTrigger>
            <TooltipContent>{labelHelp}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col" style={{ gap: "var(--space-1)" }}>
        {children({
          id: fieldId,
          "aria-describedby": describedBy,
          "aria-invalid": showError ? true : undefined,
        })}
        {showError ? (
          <p id={errorId} role="alert" className="text-xs text-destructive-strong">
            {error}
          </p>
        ) : help !== undefined ? (
          <p id={helpId} className="text-xs text-muted-foreground">
            {help}
          </p>
        ) : null}
      </div>
    </div>
  );
});
