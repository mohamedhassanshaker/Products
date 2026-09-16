import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { MonoSubLine } from "@/components/ui/mono-sub-line";
import { IconButton } from "@/components/ui/icon-button";
import { Icon } from "@/components/ui/icon";

const DEFAULT_EXPAND_TOGGLE_LABEL = "Show details";

export interface DataTableCardRowProps {
  /** The identifying column's rendered value — becomes the card's title (design-system.md §5.5 #41's ≤560px collapse). */
  title: React.ReactNode;
  /** Every other column's rendered value, joined into one `MonoSubLine` — the card.tsx anatomy's own `v1.4 · SEWA · 412/day` shape. */
  secondaryFields: readonly React.ReactNode[];
  actions?: React.ReactNode;
  cardTitleLevel: 1 | 2 | 3 | 4 | 5 | 6;
  selectable?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  selectLabel?: string;
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  expandToggleLabel?: string;
  expandedContent?: React.ReactNode;
}

/**
 * One `DataTable` row, collapsed to a `Card` (design-system.md §5.5 #41's
 * ≤560px rule): *"each row becomes a real `Card` with the identifying
 * column as title and a `MonoSubLine` of secondary fields, and the action
 * slot in the footer."* Selection and expansion stay fully present at this
 * width (a real `Checkbox` in the header, a real expand toggle) — the
 * collapse changes *layout*, not capability.
 */
export function DataTableCardRow({
  title,
  secondaryFields,
  actions,
  cardTitleLevel,
  selectable = false,
  selected = false,
  onSelectedChange,
  selectLabel,
  expandable = false,
  expanded = false,
  onToggleExpanded,
  expandToggleLabel,
  expandedContent,
}: DataTableCardRowProps): React.ReactElement {
  return (
    <Card variant={selected ? "selected" : "default"}>
      <CardHeader>
        <div className="flex min-w-0 items-center" style={{ gap: "var(--space-2)" }}>
          {selectable ? (
            <Checkbox
              checked={selected}
              aria-label={selectLabel}
              onCheckedChange={(value) => onSelectedChange?.(value === true)}
            />
          ) : null}
          <CardTitle level={cardTitleLevel} className="min-w-0 truncate">
            {title}
          </CardTitle>
        </div>
        {expandable ? (
          <IconButton
            variant="ghost"
            size="sm"
            ariaLabel={expandToggleLabel ?? DEFAULT_EXPAND_TOGGLE_LABEL}
            aria-expanded={expanded}
            pressed={expanded}
            onClick={onToggleExpanded}
          >
            <Icon
              icon={ChevronDown}
              size={16}
              className={expanded ? "rotate-180" : undefined}
              mirrorInRtl={false}
            />
          </IconButton>
        ) : null}
      </CardHeader>
      <CardContent>
        {/* Not `secondaryFields.join(" · ")`: a cell's rendered value is
            `React.ReactNode`, not guaranteed to be a plain string (a custom
            cell renderer can return real JSX — a `Badge`, a formatted
            amount) — `Array.prototype.join` calls `.toString()` on each
            element, which for a JSX element produces the literal text
            "[object Object]", not its rendered output. Interleaving real
            separator nodes between real children renders correctly
            regardless of what each field actually is. */}
        <MonoSubLine variant="truncate">
          {secondaryFields
            .filter((field) => field !== undefined && field !== null)
            .map((field, index) => (
              // Index-based key is fine here (no `react/no-array-index-key`
              // rule is even configured in this project — checked before
              // assuming a suppression comment was needed, same as
              // `pagination.tsx`'s identical note): fields are positional
              // and never reordered independently of their row.
              <React.Fragment key={index}>
                {index > 0 ? " · " : null}
                {field}
              </React.Fragment>
            ))}
        </MonoSubLine>
        {expandable && expanded ? <div className="mt-3">{expandedContent}</div> : null}
      </CardContent>
      {actions ? <CardFooter>{actions}</CardFooter> : null}
    </Card>
  );
}
