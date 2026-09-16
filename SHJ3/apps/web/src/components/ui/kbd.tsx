import * as React from "react";
import { cn } from "@/lib/utils";

// A type alias, not an (empty) `interface` — this project's lint config
// flags an interface that declares no members beyond its supertype.
export type KbdProps = Omit<React.HTMLAttributes<HTMLElement>, "dir">;

/**
 * Keyboard hint (design-system.md §5.3 #19), e.g. rendering "Ctrl+Enter". No
 * shadcn base — built from scratch on the native `<kbd>` element, which
 * already carries the correct semantic role with zero extra ARIA needed.
 *
 * Exists for two consumers neither built in this batch: the Phase F user
 * guide (documenting every keyboard shortcut a page supports) and the
 * graph/flow canvas's keyboard-help overlays (§10.4) — both need one
 * consistent way to render a shortcut, rather than each screen inventing its
 * own `<code>`/`<span>` styling.
 *
 * Not in the §5.2 eight-state table and that is not an oversight: a `Kbd` is
 * never itself interactive (it names a key a *different* control responds
 * to), so it has no hover/focus/active/disabled/loading/error state to
 * express — only `default`.
 *
 * Forces `dir="ltr"` with `unicode-bidi: isolate`, the same mechanism
 * `MonoSubLine` uses and for the same underlying reason (§11.3 rule 1) even
 * though this atom is not literally named in that rule's enumerated list:
 * a shortcut like "Ctrl+Enter" is exactly the same *shape* of content —
 * Latin symbols and punctuation that must not be allowed to reorder inside
 * Arabic prose — and it already shares `MonoSubLine`'s `--font-mono` token
 * per §5.3's own table. Treated here as a documented extrapolation of the
 * stated principle to a same-shaped, unlisted case, not a silent assumption.
 */
export const Kbd = React.forwardRef<HTMLElement, KbdProps>(function Kbd(
  { className, ...props },
  ref,
) {
  return (
    <kbd
      ref={ref}
      data-slot="kbd"
      dir="ltr"
      style={{ unicodeBidi: "isolate" }}
      className={cn(
        // The spacing scale has no fractional steps (§4.7 — 0, px, 1, 2, 3…),
        // so vertical padding uses `py-px` (1px) rather than a nonexistent
        // `py-0.5`; still visually correct for a compact "key" look.
        "inline-flex items-center justify-center rounded-xs bg-surface-sunken px-1 py-px",
        "font-mono text-2xs font-medium text-foreground",
        className,
      )}
      {...props}
    />
  );
});
