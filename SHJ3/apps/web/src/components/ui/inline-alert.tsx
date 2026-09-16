import * as React from "react";
import { CircleAlert, CircleCheck, Info, OctagonX, X } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";
import { IconButton } from "./icon-button";

export type InlineAlertVariant = "info" | "warning" | "destructive" | "success";

const inlineAlertVariants = cva("flex items-start gap-2 rounded-md border p-3 text-sm", {
  variants: {
    // Same fill/text family pairing §6.3 establishes for Badge — a `-subtle`
    // surface with the matching `-strong` text, never the base role alone.
    variant: {
      info: "border-info-strong bg-info-subtle text-info-strong",
      success: "border-success-strong bg-success-subtle text-success-strong",
      warning: "border-warning-strong bg-warning-subtle text-warning-strong",
      destructive: "border-destructive-strong bg-destructive-subtle text-destructive-strong",
    },
  },
});

const VARIANT_ICON: Readonly<Record<InlineAlertVariant, typeof Info>> = {
  info: Info,
  success: CircleCheck,
  warning: CircleAlert,
  destructive: OctagonX,
};

/** §6.1's rule made concrete for this component: a visible text prefix word, not colour alone — a colour-blind sighted reader needs this exactly as much as a screen-reader user does. */
const VARIANT_PREFIX_WORD: Readonly<Record<InlineAlertVariant, string>> = {
  info: "Info",
  success: "Success",
  warning: "Warning",
  destructive: "Error",
};

interface InlineAlertSharedProps
  extends
    Omit<React.HTMLAttributes<HTMLDivElement>, "role" | "children">,
    VariantProps<typeof inlineAlertVariants> {
  variant: InlineAlertVariant;
  children: React.ReactNode;
}

export type InlineAlertProps =
  | (InlineAlertSharedProps & {
      dismissible?: false;
      onDismiss?: undefined;
      dismissLabel?: undefined;
    })
  | (InlineAlertSharedProps & { dismissible: true; onDismiss: () => void; dismissLabel?: string });

/**
 * Non-blocking notice inside a pane (design-system.md §5.4 #36).
 * `role="status"` for `info`/`success` and `role="alert"` for
 * `warning`/`destructive` — not cosmetic: `alert` interrupts a screen
 * reader immediately (assertive, implicit `aria-live="assertive"`), `status`
 * waits for a pause (polite). A routine "saved" success notice does not
 * deserve to interrupt; a validation failure does.
 */
export const InlineAlert = React.forwardRef<HTMLDivElement, InlineAlertProps>(function InlineAlert(
  { variant, className, children, dismissible = false, onDismiss, dismissLabel, ...props },
  ref,
) {
  const role = variant === "warning" || variant === "destructive" ? "alert" : "status";
  const IconComponent = VARIANT_ICON[variant];

  return (
    <div
      ref={ref}
      data-slot="inline-alert"
      data-variant={variant}
      role={role}
      className={cn(inlineAlertVariants({ variant }), className)}
      {...props}
    >
      {
        // No `label` — Icon already defaults to `aria-hidden="true"` when
        // omitted (icon.tsx's own contract), which is correct here: the
        // visible "Warning:"/"Error:" prefix word right next to it is this
        // alert's real accessible name, so the icon stays decorative.
      }
      <Icon icon={IconComponent} size={16} className="mt-0.5 shrink-0" />
      {
        // `<div>`, not `<p>`: a `<p>` cannot legally contain block-level
        // content (`NodeFormDialog`/`EdgeFormDialog`/`skin-manager.tsx` all
        // pass a `<ul>` of validation errors as `children` here), which a
        // real browser silently reparents while logging a real "cannot be a
        // descendant of"/"cannot contain a nested" console error pair — a
        // genuine hydration-mismatch-shaped defect found live, not a style
        // nit (tasks/lessons.md: "Two shared design-system atoms carry real,
        // live-reproducible gaps"). A `<div>` has no such restriction and
        // renders identically for the common case (a plain text/string
        // child), so this is a pure widening, not a behaviour change for any
        // existing consumer.
      }
      <div className="min-w-0 flex-1">
        <strong>{VARIANT_PREFIX_WORD[variant]}:</strong> {children}
      </div>
      {dismissible ? (
        <IconButton
          ariaLabel={
            dismissLabel ?? `Dismiss ${VARIANT_PREFIX_WORD[variant].toLowerCase()} message`
          }
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          className="shrink-0"
        >
          <X aria-hidden="true" className="size-3.5" />
        </IconButton>
      ) : null}
    </div>
  );
});
