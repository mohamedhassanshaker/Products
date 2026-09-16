"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";
import { Icon } from "./icon";

/** See button.tsx for the full rationale. */
const FOCUS_VISIBLE_RING =
  "outline-none focus-within:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-within:[outline-offset:var(--focus-ring-offset)]";

export interface ChipInputProps {
  /** Fully controlled — the caller owns the committed chip list (React Hook Form + Zod per `architecture.md` §9), the same way `FilterBar`'s `activeFilters` is controlled rather than internally tracked. */
  chips: readonly string[];
  onChipsChange: (chips: string[]) => void;
  "aria-label": string;
  placeholder?: string;
  variant?: "default" | "validated";
  /**
   * `validated` variant only. Runs before a candidate is committed; return an
   * error message to reject it (shown inline, input retained so the user can
   * fix it) or `undefined` to accept.
   */
  validate?: (candidate: string) => string | undefined;
  /** Additional keys (besides `Enter`, always active) that commit the current text as a chip — `","` is the common case for a tag input. */
  delimiterKeys?: readonly string[];
  /** Builds each chip's remove-button accessible name. Default is English; pass a translated template in real feature code — mirrors filter-bar.tsx's `removeFilterLabel`. */
  removeChipLabel?: (chip: string) => string;
  /** Shown inline when a candidate exactly duplicates an existing chip. Default is English; pass a translated string in real feature code. */
  duplicateMessage?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

function defaultRemoveChipLabel(chip: string): string {
  return `Remove ${chip}`;
}

/**
 * Tag-style input (design-system.md §5.4 #32 — B10 tab 2's allowed domains,
 * tags). No existing atom models "N chips plus a live text field, wrapping
 * across lines as a single bordered control" (the closest, `Input`, owns a
 * single text value and an absolutely-positioned adornment slot, not
 * arbitrary inline content before the caret), so the bordered container here
 * is a deliberate, minimal composition — mirroring `Input`'s own token
 * recipe (border, radius, focus ring) for visual consistency rather than
 * inventing a new one, but not literally rendering `<Input>`.
 *
 * Each chip's remove button is a real `IconButton` — independently
 * focusable and labelled, never a bare glyph — and `Backspace` on an empty
 * text field removes the *last* chip, both per §5.4's own stated contract.
 * `focus-within` (not `focus-visible` on the container) carries the ring,
 * since the actually-focused element is always the inner `<input>`, not this
 * wrapper.
 */
export const ChipInput = React.forwardRef<HTMLInputElement, ChipInputProps>(function ChipInput(
  {
    chips,
    onChipsChange,
    "aria-label": ariaLabel,
    placeholder,
    variant = "default",
    validate,
    delimiterKeys = [],
    removeChipLabel = defaultRemoveChipLabel,
    duplicateMessage = "This value has already been added.",
    disabled = false,
    className,
    id,
  },
  ref,
) {
  const [inputValue, setInputValue] = React.useState("");
  const [error, setError] = React.useState<string | undefined>(undefined);
  const errorId = React.useId();

  const commitChip = () => {
    const candidate = inputValue.trim();
    if (candidate === "") return;

    if (chips.includes(candidate)) {
      setError(duplicateMessage);
      return;
    }

    if (variant === "validated" && validate) {
      const validationError = validate(candidate);
      if (validationError !== undefined) {
        setError(validationError);
        return;
      }
    }

    onChipsChange([...chips, candidate]);
    setInputValue("");
    setError(undefined);
  };

  const removeChipAt = (index: number) => {
    // Not `.filter((_, i) => ...)`: this project's lint config rejects any
    // named unused callback parameter (`args` must match an empty string),
    // so an unused "value" placeholder ahead of the index we actually care
    // about isn't available here.
    const next = chips.slice();
    next.splice(index, 1);
    onChipsChange(next);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || delimiterKeys.includes(event.key)) {
      event.preventDefault();
      commitChip();
      return;
    }
    // §5.4: Backspace on an *empty* input removes the last chip. Guarded to
    // the empty-input case only, so a user deleting normal text never loses
    // a chip by surprise.
    if (event.key === "Backspace" && inputValue === "" && chips.length > 0) {
      removeChipAt(chips.length - 1);
    }
  };

  return (
    <div className={cn("flex w-full flex-col", className)} style={{ gap: "var(--space-1)" }}>
      <div
        data-slot="chip-input"
        aria-disabled={disabled ? true : undefined}
        className={cn(
          "flex w-full flex-wrap items-center border border-border-strong bg-input transition-colors",
          disabled && "cursor-not-allowed border-border bg-disabled-surface",
          FOCUS_VISIBLE_RING,
        )}
        style={{
          borderRadius: "var(--input-radius)",
          padding: "var(--space-1)",
          gap: "var(--space-1)",
          minBlockSize: "var(--input-height)",
        }}
      >
        {chips.map((chip, index) => (
          <span
            key={chip}
            className="inline-flex items-center rounded-full bg-accent text-xs text-accent-foreground"
            style={{
              paddingInlineStart: "var(--space-2)",
              paddingInlineEnd: "var(--space-1)",
              paddingBlock: "var(--space-0)",
              gap: "var(--space-1)",
            }}
          >
            {chip}
            <IconButton
              variant="ghost"
              size="sm"
              ariaLabel={removeChipLabel(chip)}
              disabled={disabled}
              onClick={() => removeChipAt(index)}
            >
              <Icon icon={X} size={14} />
            </IconButton>
          </span>
        ))}
        <input
          ref={ref}
          id={id}
          type="text"
          value={inputValue}
          onChange={(event) => {
            setInputValue(event.target.value);
            if (error !== undefined) setError(undefined);
          }}
          onKeyDown={handleKeyDown}
          onBlur={commitChip}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={error !== undefined ? true : undefined}
          aria-describedby={error !== undefined ? errorId : undefined}
          placeholder={chips.length === 0 ? placeholder : undefined}
          className={cn(
            "min-w-24 flex-1 border-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground",
            "disabled:cursor-not-allowed",
            // The replacement ring is real but lives on the ancestor container
            // (FOCUS_VISIBLE_RING above, via `focus-within:`), not on this
            // input itself — the visible indicator WCAG 2.4.7 requires is
            // genuinely present the moment this input is focused.
            "outline-none", // design-gate-allow: ring is on the ancestor via focus-within, see comment above
          )}
          style={{ paddingInline: "var(--space-1)" }}
        />
      </div>
      {error !== undefined ? (
        <p id={errorId} role="alert" className="text-xs text-destructive-strong">
          {error}
        </p>
      ) : null}
    </div>
  );
});
