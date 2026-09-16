import * as React from "react";
import { cn } from "@/lib/utils";
import { Badge, type BadgeProps } from "./badge";
import { MonoSubLine } from "./mono-sub-line";

/** The status families §6.2's vocabulary table actually uses — mirrors `Badge`'s own `variant` union, minus `outline` (a visual treatment, not a status family). */
export type StatusFamily = Extract<
  BadgeProps["variant"],
  "success" | "warning" | "destructive" | "info" | "neutral"
>;

interface StatusCellSharedProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** The status word, e.g. "Failed" — §6.1: the label is what survives a re-brand, never inferred from `family` alone. */
  label: string;
  family: StatusFamily;
  /**
   * Sort rank, supplied by the caller — this component hardcodes no
   * product's status ordering (design-system.md §5.4 #39: "sortable by
   * status rank, not alphabetically"). Use `compareStatusCellRank` below in
   * a `DataTable` column sort, keyed off whatever rank scheme the calling
   * screen defines (B13's `Failed` sorting to the top is that screen's
   * decision, not this component's).
   */
  rank: number;
}

interface BadgeVariantProps extends StatusCellSharedProps {
  variant?: "badge";
}

interface BadgeWithDetailProps extends StatusCellSharedProps {
  variant: "badge-with-detail";
  /** Rendered as a real `MonoSubLine` beneath the badge, e.g. a timestamp or error code. */
  detail: string;
}

interface DotWithLabelProps extends StatusCellSharedProps {
  variant: "dot-with-label";
}

export type StatusCellProps = BadgeVariantProps | BadgeWithDetailProps | DotWithLabelProps;

/** `--<family>-strong` background for the `dot-with-label` variant's dot — the same family tokens `Badge` itself consumes, so a dot and a badge for the same status always agree. */
const DOT_TONE_CLASS_NAME: Readonly<Record<StatusFamily, string>> = {
  success: "bg-success-strong",
  warning: "bg-warning-strong",
  destructive: "bg-destructive-strong",
  info: "bg-info-strong",
  neutral: "bg-muted-foreground",
};

/**
 * Data an object needs to be ordered by `StatusCell`'s rank rather than
 * alphabetically — the object itself, not just a bare number, so a caller
 * can sort the real rows it already has (`Array.prototype.sort` needs the
 * row, not an isolated rank) while still comparing by rank underneath.
 */
export interface RankedStatus {
  rank: number;
}

/**
 * Comparator for exactly the sort §5.4 #39 requires: rank order, never
 * `Intl.Collator`/alphabetical (design-system.md §11.5's sorting rule is
 * about *string* columns — a status column is explicitly the documented
 * exception, since "Failed" must be able to outrank "Active" regardless of
 * alphabetical order). Exported rather than hidden, so a `DataTable` column
 * definition can pass it straight to its own sort function.
 */
export function compareStatusCellRank(a: RankedStatus, b: RankedStatus): number {
  return a.rank - b.rank;
}

/**
 * The table-cell form of `Badge` + `MonoSubLine` (design-system.md §5.4
 * #39) — composes the real atoms rather than reimplementing either.
 */
export const StatusCell = React.forwardRef<HTMLDivElement, StatusCellProps>(
  function StatusCell(props, ref) {
    if (props.variant === "dot-with-label") {
      const { variant, label, family, rank, className, ...domProps } = props;
      void variant;
      void rank;
      return (
        <div
          ref={ref}
          data-slot="status-cell"
          data-variant="dot-with-label"
          className={cn("flex items-center gap-1.5", className)}
          {...domProps}
        >
          <span
            aria-hidden="true"
            className={cn("size-2 shrink-0 rounded-full", DOT_TONE_CLASS_NAME[family])}
          />
          <span className="text-sm text-foreground">{label}</span>
        </div>
      );
    }

    if (props.variant === "badge-with-detail") {
      const { variant, label, family, rank, detail, className, ...domProps } = props;
      void variant;
      void rank;
      return (
        <div
          ref={ref}
          data-slot="status-cell"
          data-variant="badge-with-detail"
          className={cn("flex flex-col items-start gap-0.5", className)}
          {...domProps}
        >
          <Badge variant={family} label={label} />
          <MonoSubLine>{detail}</MonoSubLine>
        </div>
      );
    }

    const { variant = "badge", label, family, rank, className, ...domProps } = props;
    void variant;
    void rank;
    return (
      <div
        ref={ref}
        data-slot="status-cell"
        data-variant="badge"
        className={className}
        {...domProps}
      >
        <Badge variant={family} label={label} />
      </div>
    );
  },
);
