import * as React from "react";
import { AlertTriangle, Lock, SearchX, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";
import { Button } from "./button";

interface EmptyStateSharedProps {
  headline: React.ReactNode;
  /** The single action that resolves this state. Omit only when there genuinely is none — `no-permission` typically has no self-service resolution. */
  action?: { label: string; onClick: () => void };
  /** Overrides the variant's default decorative glyph. */
  icon?: LucideIcon;
  className?: string;
}

export interface EmptyStateFirstRunProps extends EmptyStateSharedProps {
  variant?: "first-run";
  /** One-line explanation of why this is empty. */
  cause: React.ReactNode;
}

export interface EmptyStateNoResultsProps extends EmptyStateSharedProps {
  variant: "no-results";
  cause: React.ReactNode;
}

export interface EmptyStateErrorProps extends EmptyStateSharedProps {
  variant: "error";
  cause: React.ReactNode;
}

export interface EmptyStateNoPermissionProps extends EmptyStateSharedProps {
  variant: "no-permission";
  /** The role required to see this content — B9's permission matrix is the source of truth (design-system.md §5.4 #35). Real role data does not exist yet in this wave; accepted as a plain prop. */
  requiredRole: string;
  /**
   * Builds the cause text from `requiredRole` — structured input, not a
   * freeform `cause`, the same reasoning `summary-strip.tsx`'s `blocking`
   * variant follows for RISK-007 (§11.3 rule 4: never build a sentence by
   * concatenation across a translated boundary; the template owns the
   * ordering). Default is English; pass a translated template in real
   * feature code.
   */
  causeTemplate?: (role: string) => React.ReactNode;
}

export type EmptyStateProps =
  | EmptyStateFirstRunProps
  | EmptyStateNoResultsProps
  | EmptyStateErrorProps
  | EmptyStateNoPermissionProps;

const DEFAULT_ICON_BY_VARIANT: Record<NonNullable<EmptyStateProps["variant"]>, LucideIcon> = {
  "first-run": Sparkles,
  "no-results": SearchX,
  error: AlertTriangle,
  "no-permission": Lock,
};

function defaultCauseTemplate(role: string): string {
  return `You need the ${role} role to view this.`;
}

/**
 * Headline, one-line cause, and the single action that resolves it
 * (design-system.md §5.4 #35 — "every list/canvas in this system uses this").
 * §5.2's own note: this *is* the empty state referenced by every other
 * component's eight-state model, not a state any of them render themselves.
 *
 * `no-permission` takes a structured `requiredRole` rather than a freeform
 * `cause` — see `EmptyStateNoPermissionProps`'s doc comment for why —
 * mechanically guaranteeing the role is always named, the same way
 * `SummaryStrip`'s `blocking` variant mechanically guarantees every failing
 * condition is named (§11.7).
 */
export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  function EmptyState(props, ref) {
    const variant = props.variant ?? "first-run";
    const ResolvedIcon = props.icon ?? DEFAULT_ICON_BY_VARIANT[variant];
    const cause =
      props.variant === "no-permission"
        ? (props.causeTemplate ?? defaultCauseTemplate)(props.requiredRole)
        : props.cause;

    return (
      <div
        ref={ref}
        data-slot="empty-state"
        role={variant === "error" ? "alert" : undefined}
        className={cn("flex flex-col items-center text-center", props.className)}
        style={{ gap: "var(--space-2)", padding: "var(--space-8)" }}
      >
        <Icon icon={ResolvedIcon} size={24} className="text-muted-foreground" />
        <p className="text-sm font-semibold text-foreground">{props.headline}</p>
        {
          // `max-w-sm` was a dead class: this bridge's `--container-*` reset is never
          // re-mapped (tailwind-theme.ts, ADR-0007 "replace, not extend"), so no
          // `max-w-*` utility compiles — the same confirmed-empty gap already fixed at
          // `sign-in-form.tsx`. Reproduced here as the literal `rem` value `max-w-sm`
          // would have used (24rem), unaffected by the token gate's `px|pt|em`-only
          // length pattern — the sanctioned mechanism, not a gate workaround.
        }
        <p className="text-sm text-muted-foreground" style={{ maxWidth: "24rem" }}>
          {cause}
        </p>
        {props.action ? (
          <Button variant="primary" size="sm" onClick={props.action.onClick} className="mt-2">
            {props.action.label}
          </Button>
        ) : null}
      </div>
    );
  },
);
