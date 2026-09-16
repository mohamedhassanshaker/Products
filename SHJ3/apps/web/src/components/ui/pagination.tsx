import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";
import { Icon } from "./icon";
import { Button } from "./button";

interface PaginationBaseProps {
  /** Accessible name for the `<nav>` landmark. Default matches §5.4's own example text verbatim; pass a translated string in real feature code. */
  "aria-label"?: string;
  /** Default is English; pass a translated string in real feature code — mirrors label.tsx's `requiredText`/`optionalText` pattern. */
  previousLabel?: string;
  nextLabel?: string;
  className?: string;
}

export interface PaginationNumberedProps extends PaginationBaseProps {
  variant?: "numbered";
  /** 1-indexed. */
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** How many page numbers to show on each side of the current page before collapsing the rest behind an ellipsis. */
  siblingCount?: number;
}

export interface PaginationCursorProps extends PaginationBaseProps {
  variant: "cursor";
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

export interface PaginationLoadMoreProps extends PaginationBaseProps {
  variant: "load-more";
  hasMore: boolean;
  onLoadMore: () => void;
  loading?: boolean;
  /** Default is English; pass a translated string in real feature code. */
  loadMoreLabel?: string;
}

export type PaginationProps =
  PaginationNumberedProps | PaginationCursorProps | PaginationLoadMoreProps;

type PageItem = number | "ellipsis";

/**
 * Standard sibling-window truncation: always the first and last page, the
 * current page plus `siblingCount` neighbours on each side, and an ellipsis
 * wherever that leaves a gap. Below the window's own size, every page number
 * renders — never a fake ellipsis over a gap of one.
 */
function buildPageItems(current: number, total: number, siblingCount: number): PageItem[] {
  const windowSize = siblingCount * 2 + 5; // first + last + current + 2 ellipses' worth of slack
  if (total <= windowSize) {
    // Not `Array.from({ length: total }, (_, index) => ...)`: this project's
    // lint config rejects any named unused callback parameter, so the
    // conventional unused-element placeholder isn't available here.
    const allPages: PageItem[] = [];
    for (let page = 1; page <= total; page++) allPages.push(page);
    return allPages;
  }

  const leftSibling = Math.max(current - siblingCount, 1);
  const rightSibling = Math.min(current + siblingCount, total);
  const showLeftEllipsis = leftSibling > 2;
  const showRightEllipsis = rightSibling < total - 1;

  const items: PageItem[] = [1];
  if (showLeftEllipsis) items.push("ellipsis");
  for (let page = Math.max(leftSibling, 2); page <= Math.min(rightSibling, total - 1); page++) {
    items.push(page);
  }
  if (showRightEllipsis) items.push("ellipsis");
  if (total > 1) items.push(total);
  return items;
}

const CHEVRON_BUTTON_CLASS = "shrink-0";

/**
 * `DataTable` footer pagination (design-system.md §5.4 #33). Built standalone
 * — the organism that actually embeds it is a later wave's job — so this
 * component's API takes plain primitives (`currentPage`/`totalPages`,
 * `hasPrevious`/`hasNext`, `hasMore`) rather than anything shaped around
 * TanStack Table or any other specific table implementation, per the brief's
 * "plausible footer component" bar.
 *
 * Chevrons mirror under RTL for free: `ChevronLeft`/`ChevronRight` are
 * already on `icon.tsx`'s `MIRROR_IN_RTL_ICONS` allowlist, so using them for
 * their LTR-natural meaning ("previous" = pointing toward the reading start,
 * "next" = pointing toward the reading end) is all that's needed — `Icon`'s
 * own `rtl:-scale-x-100` mechanism does the rest, with no direction-reading
 * logic duplicated here the way `sub-tab-bar.tsx`/`toggle-row.tsx`/`slider.tsx`
 * had to add for their own, unrelated RTL gap.
 */
export const Pagination = React.forwardRef<HTMLElement, PaginationProps>(
  function Pagination(props, ref) {
    const {
      "aria-label": ariaLabel = "pagination",
      previousLabel = "Previous page",
      nextLabel = "Next page",
      className,
    } = props;

    return (
      <nav
        ref={ref}
        aria-label={ariaLabel}
        className={cn("flex items-center", className)}
        style={{ gap: "var(--space-1)" }}
      >
        {props.variant === "cursor" ? (
          <>
            <IconButton
              variant="ghost"
              ariaLabel={previousLabel}
              disabled={!props.hasPrevious}
              onClick={props.onPrevious}
              className={CHEVRON_BUTTON_CLASS}
            >
              <Icon icon={ChevronLeft} size={16} />
            </IconButton>
            <IconButton
              variant="ghost"
              ariaLabel={nextLabel}
              disabled={!props.hasNext}
              onClick={props.onNext}
              className={CHEVRON_BUTTON_CLASS}
            >
              <Icon icon={ChevronRight} size={16} />
            </IconButton>
          </>
        ) : props.variant === "load-more" ? (
          <Button
            variant="outline"
            disabled={!props.hasMore}
            {...(props.loading !== undefined ? { loading: props.loading } : {})}
            onClick={props.onLoadMore}
          >
            {props.loadMoreLabel ?? "Load more"}
          </Button>
        ) : (
          <NumberedPages {...props} previousLabel={previousLabel} nextLabel={nextLabel} />
        )}
      </nav>
    );
  },
);

function NumberedPages({
  currentPage,
  totalPages,
  onPageChange,
  siblingCount = 1,
  previousLabel,
  nextLabel,
}: PaginationNumberedProps & { previousLabel: string; nextLabel: string }): React.ReactElement {
  const items = buildPageItems(currentPage, totalPages, siblingCount);

  return (
    <>
      <IconButton
        variant="ghost"
        ariaLabel={previousLabel}
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
        className={CHEVRON_BUTTON_CLASS}
      >
        <Icon icon={ChevronLeft} size={16} />
      </IconButton>
      {items.map((item, index) =>
        item === "ellipsis" ? (
          // Index-based key is fine here (no `react/no-array-index-key` rule
          // is even configured in this project — checked before assuming a
          // suppression comment was needed): ellipses are non-interactive
          // filler with no identity of their own, at most two, in fixed
          // positions either side of the sibling window.
          <span key={`ellipsis-${index}`} aria-hidden="true" className="px-1 text-muted-foreground">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            aria-current={item === currentPage ? "page" : undefined}
            onClick={() => onPageChange(item)}
            className={cn(
              "inline-flex items-center justify-center rounded-md text-sm transition-colors",
              "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]",
              item === currentPage
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-accent hover:text-accent-foreground",
            )}
            style={{
              inlineSize: "var(--control-height-sm)",
              blockSize: "var(--control-height-sm)",
            }}
          >
            {item}
          </button>
        ),
      )}
      <IconButton
        variant="ghost"
        ariaLabel={nextLabel}
        disabled={currentPage >= totalPages}
        onClick={() => onPageChange(currentPage + 1)}
        className={CHEVRON_BUTTON_CLASS}
      >
        <Icon icon={ChevronRight} size={16} />
      </IconButton>
    </>
  );
}
