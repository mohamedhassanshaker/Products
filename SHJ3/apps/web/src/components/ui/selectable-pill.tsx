import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** See button.tsx for the full rationale — applied to the *visual* sibling via `peer-`, since the real focusable element is the hidden input. */
const PEER_FOCUS_VISIBLE_RING =
  "peer-focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] peer-focus-visible:[outline-offset:var(--focus-ring-offset)]";

export interface SelectablePillProps {
  /** `single` gives radio semantics (mutually exclusive within a shared `name`); `multi` gives checkbox semantics (independent). */
  variant: "single" | "multi";
  /** Controlled — this atom holds no state of its own, since callers (tone pills, team/role pills, MCP tool-binding pills) each own their own selection model. */
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Required for `single` pills sharing a group — the browser's own native radio grouping is what gives arrow-key cycling for free. Unused for `multi`. */
  name?: string;
  value?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** The pill's content — no opinionated shape, per the brief (a label string, an icon+label pair, whatever the caller's pill family needs). */
  children: React.ReactNode;
}

/**
 * Rounded, outline-by-default, filled-when-selected pill (design-system.md
 * §5.3 #9 — the wireframe's own "rounded outline, green fill when
 * selected"). No shadcn base exists for this; built directly on a real
 * `<input type="radio">`/`<input type="checkbox">`.
 *
 * The input is visually hidden with Tailwind's `sr-only` pattern (absolute
 * position, 1px clip) rather than `display:none`/`visibility:hidden` —
 * either of those would remove it from the accessibility tree *and* the tab
 * order, which would silently break keyboard selection entirely. `sr-only`
 * keeps it real, focusable and checkable, driven by the input's own state.
 *
 * Only the check *glyph* is `aria-hidden` — the pill's content (the caller's
 * `children`) deliberately is not. A native `<label>` wrapping a control
 * derives that control's accessible name from the label's own text content,
 * and an `aria-hidden` ancestor around that text would remove it from the
 * accessible-name computation entirely, leaving the control unnamed. Easy to
 * miss because it still *looks* right — confirmed by testing the actual
 * computed accessible name, not just the visible label.
 *
 * Checked/unchecked colour and the check glyph both read the `checked` prop
 * directly (this component is controlled, so that value is already in
 * hand) rather than a `peer-checked:` selector — kept consistent with the
 * rest of this batch's approach, and it sidesteps `no-hardcoded-design-values.mjs`'s
 * arbitrary-variant-bracket ban entirely for that part. `peer-focus-visible:`
 * (a *named*, non-bracket Tailwind variant) is still used for the ring, since
 * that state has no equivalent prop to read.
 */
export const SelectablePill = React.forwardRef<HTMLInputElement, SelectablePillProps>(
  function SelectablePill(
    { variant, checked, onCheckedChange, name, value, disabled, id, className, children },
    ref,
  ) {
    return (
      <label
        className={cn(
          "relative inline-flex cursor-pointer items-center",
          disabled && "cursor-not-allowed",
        )}
      >
        <input
          ref={ref}
          id={id}
          type={variant === "single" ? "radio" : "checkbox"}
          name={name}
          value={value}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onCheckedChange(event.target.checked)}
          className="peer sr-only"
        />
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border text-sm transition-colors",
            checked
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border-strong bg-transparent text-foreground",
            !disabled && !checked && "peer-hover:bg-accent peer-hover:text-accent-foreground",
            disabled && "border-border bg-disabled-surface text-disabled-foreground",
            PEER_FOCUS_VISIBLE_RING,
            className,
          )}
          style={{ paddingInline: "var(--space-3)", paddingBlock: "var(--space-1)" }}
        >
          {checked ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : null}
          {children}
        </span>
      </label>
    );
  },
);
