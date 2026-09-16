"use client";

import * as React from "react";
import { Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";

export interface MonoSubLineCopyButtonProps {
  /** The exact string written to the clipboard. */
  value: string;
  // `| undefined` explicitly (not just `?:`): under this project's
  // `exactOptionalPropertyTypes`, `MonoSubLine` forwards its *own* optional
  // `copyLabel`/`copiedMessage` props here, which are `string | undefined`
  // values, not merely "present or absent" keys.
  copyLabel?: string | undefined;
  copiedMessage?: string | undefined;
  className?: string | undefined;
}

/** How long the "Copied" confirmation stays visible/announced before resetting. */
const CONFIRMATION_VISIBLE_MS = 2000;

/**
 * `MonoSubLine`'s `copyable` variant control, split into its own file so
 * `mono-sub-line.tsx` can stay a Server Component for its more common
 * `default`/`truncate` uses (this project's "'use client' only where
 * genuinely needed" convention) — everything here needs the clipboard API and
 * component state, neither of which exist on the server.
 *
 * A plain labelled `<button>`, deliberately not the sibling wave's
 * `IconButton`: that component is being built concurrently in a disjoint file
 * as part of the same effort, so depending on it here would be a build-order
 * hazard, not a real reuse win. `MonoSubLine`'s own spec calls for "a real
 * icon-button-*shaped* control" — this satisfies that shape (correct target
 * size, focus ring, aria-label) without the cross-file dependency.
 *
 * The confirmation is a polite live region, not only a visual icon swap, so
 * a screen-reader user gets the same "it worked" signal a sighted user gets.
 */
export function MonoSubLineCopyButton({
  value,
  copyLabel = "Copy to clipboard",
  copiedMessage = "Copied to clipboard",
  className,
}: MonoSubLineCopyButtonProps) {
  const [justCopied, setJustCopied] = React.useState(false);
  const resetTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Clears the pending reset if the button unmounts mid-confirmation, so it
  // never calls setState on an unmounted component.
  React.useEffect(() => () => clearTimeout(resetTimer.current), []);

  const handleCopy = React.useCallback(() => {
    void navigator.clipboard.writeText(value).then(() => {
      setJustCopied(true);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setJustCopied(false), CONFIRMATION_VISIBLE_MS);
    });
  }, [value]);

  return (
    <>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copyLabel}
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded-xs text-muted-foreground",
          // §10.3: :focus-visible only, never :focus, and never removed
          // without a replacement — outline-none here is always paired with
          // the focus-visible outline right next to it, never left bare.
          "outline-none focus-visible:outline focus-visible:outline-ring",
          className,
        )}
        // outline-width/-offset come from the two SKINNABLE_COMPONENT_TOKENS
        // (packages/tokens/src/components.ts) an Appearance admin can move —
        // Tailwind's own `outline-2` utility bakes in a literal 2px instead
        // of `var(--focus-ring-width)` (confirmed by compiling it directly:
        // it emits `outline-width: 2px`, not a var() reference), which would
        // quietly stop tracking that token. Set unconditionally rather than
        // only under focus-visible: harmless while `outline-style` is its
        // default `none`, and it keeps this to one style object instead of a
        // second mechanism just for the focus-visible case.
        style={{
          outlineWidth: "var(--focus-ring-width)",
          outlineOffset: "var(--focus-ring-offset)",
        }}
      >
        <Icon icon={Copy} size={14} />
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {justCopied ? copiedMessage : ""}
      </span>
    </>
  );
}
