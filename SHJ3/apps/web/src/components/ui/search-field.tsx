"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "./input";
import { IconButton } from "./icon-button";
import { Icon } from "./icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

interface SearchFieldBaseProps {
  value?: string;
  defaultValue?: string;
  /** Fires on every keystroke, undebounced — lets a controlled caller reflect what's typed immediately. */
  onValueChange?: (value: string) => void;
  /** The debounced "go search" signal — also fired immediately (bypassing the debounce) when `Escape` clears the field. */
  onSearch?: (value: string) => void;
  debounceMs?: number;
  "aria-label": string;
  placeholder?: string;
  /** §5.4's `searching` state — reuses `Input`'s own `loading` presentation rather than a second spinner mechanism. */
  searching?: boolean;
  /**
   * Fully-formatted, already-pluralized announcement text for the live
   * region, e.g. "12 results for 'sewa'" — this component does not compose
   * that sentence itself (no `resultCount: number` prop performing its own
   * pluralization), the same reasoning `progress-bar.tsx`'s `label` override
   * and this batch's `DateRangeToggle` follow: English pluralization rules
   * are themselves a localization decision, which belongs to the caller's
   * `next-intl` catalogue, not hardcoded here. Omit while no search has
   * completed yet.
   */
  resultsAnnouncement?: string;
  /** Accessible label for the clear button. Default is English; pass a translated string in real feature code — mirrors label.tsx's identical `requiredText`/`optionalText` pattern. */
  clearButtonLabel?: string;
  className?: string;
  id?: string;
}

export interface SearchFieldDefaultProps extends SearchFieldBaseProps {
  variant?: "default";
}

export interface SearchFieldWithScopeProps extends SearchFieldBaseProps {
  variant: "with-scope";
  scopeOptions: readonly { value: string; label: React.ReactNode }[];
  /** Accessible name for the scope selector — a second control needs its own name, distinct from the search field's. */
  scopeAriaLabel: string;
  scopeValue?: string;
  defaultScopeValue?: string;
  onScopeChange?: (value: string) => void;
}

export type SearchFieldProps = SearchFieldDefaultProps | SearchFieldWithScopeProps;

/**
 * Live, debounced search (design-system.md §5.4 #27 — B6 tab 2's entity
 * search, B1's transcript search). Composed from the real `Input` (leading
 * search icon, trailing clear button, and its own `loading` state reused
 * verbatim for `searching` rather than a second spinner mechanism) and, for
 * `with-scope`, the real `Select`.
 *
 * `Escape` clears the field immediately — cancelling any pending debounce and
 * firing `onSearch("")` right away rather than waiting it out, since a
 * deliberate clear is a decisive action, not a still-typing one. Escape only
 * acts (and only then calls `stopPropagation`, so it does not also swallow a
 * parent's own Escape handling, e.g. a dialog closing) when there is
 * something to clear; on an already-empty field it is left to bubble
 * normally.
 */
export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  function SearchField(props, ref) {
    const {
      value,
      defaultValue,
      onValueChange,
      onSearch,
      debounceMs = 300,
      "aria-label": ariaLabel,
      placeholder,
      searching = false,
      resultsAnnouncement,
      clearButtonLabel = "Clear search",
      className,
      id,
    } = props;

    const [internalValue, setInternalValue] = React.useState(defaultValue ?? "");
    const resolvedValue = value ?? internalValue;
    const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    React.useEffect(() => {
      const timer = setTimeout(() => {
        onSearch?.(resolvedValue);
      }, debounceMs);
      debounceTimerRef.current = timer;
      return () => clearTimeout(timer);
      // `onSearch` intentionally excluded from the dependency list (no
      // `react-hooks/exhaustive-deps` rule is configured in this project —
      // checked before assuming a suppression comment was needed): including
      // it would re-arm the debounce timer on every render of a caller that
      // passes a fresh inline function, defeating debouncing entirely.
    }, [resolvedValue, debounceMs]);

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      setInternalValue(next);
      onValueChange?.(next);
    };

    const handleClear = () => {
      clearTimeout(debounceTimerRef.current);
      setInternalValue("");
      onValueChange?.("");
      onSearch?.("");
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape" && resolvedValue !== "") {
        event.stopPropagation();
        handleClear();
      }
    };

    const searchInput = (
      <Input
        ref={ref}
        id={id}
        type="search"
        value={resolvedValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel}
        placeholder={placeholder}
        loading={searching}
        startAdornment={<Icon icon={Search} size={16} />}
        endAdornment={
          !searching && resolvedValue !== "" ? (
            <IconButton
              variant="ghost"
              size="sm"
              ariaLabel={clearButtonLabel}
              onClick={handleClear}
            >
              <Icon icon={X} size={14} />
            </IconButton>
          ) : undefined
        }
      />
    );

    return (
      <div className={cn("flex w-full flex-col", className)} style={{ gap: "var(--space-1)" }}>
        <div className="flex items-center" style={{ gap: "var(--space-2)" }}>
          {props.variant === "with-scope" ? (
            <Select
              // Conditional spread, not `value={props.scopeValue}` — see
              // checkbox.tsx's identical note: `exactOptionalPropertyTypes`
              // rejects an explicit `undefined` against Radix's own
              // `value?: string` / `defaultValue?: string`.
              {...(props.scopeValue !== undefined ? { value: props.scopeValue } : {})}
              {...(props.defaultScopeValue !== undefined
                ? { defaultValue: props.defaultScopeValue }
                : {})}
              {...(props.onScopeChange !== undefined ? { onValueChange: props.onScopeChange } : {})}
            >
              <SelectTrigger size="sm" aria-label={props.scopeAriaLabel} className="shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {props.scopeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <div className="min-w-0 flex-1">{searchInput}</div>
        </div>
        {resultsAnnouncement !== undefined ? (
          <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {resultsAnnouncement}
          </span>
        ) : null}
      </div>
    );
  },
);
