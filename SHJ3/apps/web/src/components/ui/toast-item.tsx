"use client";

import * as React from "react";
import { Toast as ToastPrimitive } from "radix-ui";
import { CircleCheck, Info, OctagonX, X } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";
import { IconButton } from "./icon-button";

export const ToastProvider = ToastPrimitive.Provider;

export const ToastViewport = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(function ToastViewport({ className, style, ...props }, ref) {
  return (
    <ToastPrimitive.Viewport
      ref={ref}
      data-slot="toast-viewport"
      style={{
        zIndex: "var(--z-toast)",
        insetBlockEnd: "var(--space-4)",
        insetInlineEnd: "var(--space-4)",
        // Caps the viewport at the surrounding viewport width minus a
        // gutter, on small screens — as a `style` calc() rather than a
        // Tailwind `max-w-[...]` arbitrary-value bracket (banned by the
        // token gate) or a bare `2rem` literal (also banned outside a
        // token). `--space-8` is the closest step on the real spacing scale
        // to a comfortable double-sided gutter.
        maxInlineSize: "calc(100vw - var(--space-8))",
        ...style,
      }}
      // No `outline-none`: Radix moves real keyboard focus onto this region
      // via the F6 hotkey specifically so it *can* be focused — stripping
      // its outline would remove the one visible cue that focus landed here,
      // and (per §10.3) there is no companion ring token to replace it with.
      className={cn("fixed flex w-80 flex-col gap-2", className)}
      {...props}
    />
  );
});

export type ToastItemVariant = "info" | "success" | "destructive" | "with-action";

const toastItemVariants = cva(
  "pointer-events-auto relative flex items-start gap-2 overflow-hidden rounded-md border p-3 shadow-md",
  {
    variants: {
      variant: {
        info: "border-border bg-popover text-popover-foreground",
        success: "border-success-strong bg-success-subtle text-success-strong",
        destructive: "border-destructive-strong bg-destructive-subtle text-destructive-strong",
        "with-action": "border-border bg-popover text-popover-foreground",
      },
    },
  },
);

const VARIANT_ICON: Readonly<Record<ToastItemVariant, typeof Info>> = {
  info: Info,
  success: CircleCheck,
  destructive: OctagonX,
  "with-action": Info,
};

/** Minimum time a toast stays visible before its own timer would dismiss it (design-system.md §5.4 #37). */
const MIN_VISIBLE_MS = 6000;
/** Extended duration under `prefers-reduced-motion` — a toast is transient motion by nature, so reduced-motion users get materially longer to read it, not just a slower fade. */
const REDUCED_MOTION_VISIBLE_MS = 12000;

/**
 * `window.matchMedia`-based, not the CSS-only mechanism `atom-motion.css`
 * documents for `Skeleton`/`Spinner` — deliberately a second mechanism, not
 * an inconsistency: Radix Toast's auto-dismiss timer is a JS millisecond
 * value passed to `setTimeout` internally (confirmed by reading
 * `@radix-ui/react-toast`'s compiled source), which a CSS media query has no
 * way to express. `atom-motion.css`'s media query still separately governs
 * this component's enter/exit *animation*; this hook only governs how long
 * the toast stays mounted before Radix's own close timer fires.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const handleChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return reduced;
}

interface ToastItemSharedProps
  extends
    Omit<React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root>, "asChild" | "children">,
    VariantProps<typeof toastItemVariants> {
  title: string;
  description?: string;
  closeLabel?: string;
}

export type ToastItemProps =
  | (ToastItemSharedProps & {
      variant?: "info" | "success" | "destructive";
      actionLabel?: undefined;
      onAction?: undefined;
    })
  | (ToastItemSharedProps & { variant: "with-action"; actionLabel: string; onAction: () => void });

/**
 * Async outcome notice (design-system.md §5.4 #37) — "Re-index started",
 * "Promotion approved". Radix `Toast.Root` at `--z-toast`.
 *
 * Never the only record of a destructive outcome — a caller-discipline note,
 * not something this component can enforce itself (there is no way for a
 * toast to know whether the action it is reporting was also written
 * somewhere durable). Stated here so a future reviewer sees the constraint
 * rather than re-discovering it.
 */
export const ToastItem = React.forwardRef<
  React.ComponentRef<typeof ToastPrimitive.Root>,
  ToastItemProps
>(function ToastItem(props, ref) {
  const reducedMotion = usePrefersReducedMotion();
  const minDuration = reducedMotion ? REDUCED_MOTION_VISIBLE_MS : MIN_VISIBLE_MS;

  // Destructured fresh from the narrowed `props` inside each branch —
  // matching progress-bar.tsx/summary-strip.tsx/kpi-tile.tsx's established
  // shape for this exact problem — rather than destructuring `variant`
  // once at the top: doing that would have discarded the discriminant
  // `props` needs to type-narrow `actionLabel`/`onAction` together, which
  // is what an earlier draft of this file worked around with an `as
  // Extract<...>` cast instead of fixing (and that draft also leaked
  // `actionLabel`/`onAction` into `...domProps`, spread onto
  // `Toast.Root`, exactly the class of bug kpi-tile.tsx's own render test
  // caught for a different component).
  if (props.variant === "with-action") {
    const {
      variant,
      title,
      description,
      closeLabel = "Dismiss",
      className,
      duration,
      actionLabel,
      onAction,
      ...domProps
    } = props;
    const resolvedDuration = duration === undefined ? minDuration : Math.max(duration, minDuration);

    return (
      <ToastPrimitive.Root
        ref={ref}
        duration={resolvedDuration}
        data-slot="toast-item"
        data-variant={variant}
        className={cn(toastItemVariants({ variant }), className)}
        {...domProps}
      >
        <Icon icon={VARIANT_ICON[variant]} size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <ToastPrimitive.Title className="text-sm font-medium">{title}</ToastPrimitive.Title>
          {description ? (
            <ToastPrimitive.Description className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </ToastPrimitive.Description>
          ) : null}
          <ToastPrimitive.Action altText={actionLabel} onClick={onAction} asChild>
            <button
              type="button"
              className="mt-2 text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              {actionLabel}
            </button>
          </ToastPrimitive.Action>
        </div>
        <ToastPrimitive.Close aria-label={closeLabel} asChild>
          <IconButton ariaLabel={closeLabel} variant="ghost" size="sm" className="shrink-0">
            <X aria-hidden="true" className="size-3.5" />
          </IconButton>
        </ToastPrimitive.Close>
      </ToastPrimitive.Root>
    );
  }

  const {
    variant = "info",
    title,
    description,
    closeLabel = "Dismiss",
    className,
    duration,
    ...domProps
  } = props;
  const resolvedDuration = duration === undefined ? minDuration : Math.max(duration, minDuration);

  return (
    <ToastPrimitive.Root
      ref={ref}
      duration={resolvedDuration}
      data-slot="toast-item"
      data-variant={variant}
      className={cn(toastItemVariants({ variant }), className)}
      {...domProps}
    >
      <Icon icon={VARIANT_ICON[variant]} size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <ToastPrimitive.Title className="text-sm font-medium">{title}</ToastPrimitive.Title>
        {description ? (
          <ToastPrimitive.Description className="mt-0.5 text-xs text-muted-foreground">
            {description}
          </ToastPrimitive.Description>
        ) : null}
      </div>
      <ToastPrimitive.Close aria-label={closeLabel} asChild>
        <IconButton ariaLabel={closeLabel} variant="ghost" size="sm" className="shrink-0">
          <X aria-hidden="true" className="size-3.5" />
        </IconButton>
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
});
