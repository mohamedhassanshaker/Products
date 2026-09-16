import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { MonoSubLineCopyButton } from "./mono-sub-line-copy-button";

const monoSubLineVariants = cva("font-mono text-2xs text-muted-foreground", {
  variants: {
    variant: {
      default: "",
      truncate: "block max-w-full overflow-hidden text-ellipsis whitespace-nowrap",
      copyable: "inline-flex max-w-full items-center gap-1",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface MonoSubLineProps
  extends
    Omit<React.HTMLAttributes<HTMLSpanElement>, "dir">,
    VariantProps<typeof monoSubLineVariants> {
  /**
   * The exact value written to the clipboard for `variant="copyable"`.
   * Defaults to `children` when `children` is a plain string — pass this
   * explicitly when `children` carries formatting (e.g. a highlighted
   * substring) so the copied text stays the raw value.
   */
  value?: string;
  copyLabel?: string;
  copiedMessage?: string;
}

/**
 * Small monospace grey metadata line — design-system.md §5.3 #11, the
 * wireframe's own named component (e.g. `v1.4 · SEWA · 412/day`,
 * `mcp://customs.shj.ae`, `TXN-88213`). No shadcn base; built from scratch.
 *
 * **Why `dir="ltr"` + `unicode-bidi: isolate`, unconditionally, in both
 * locales (§11.3 rule 1) — the single most load-bearing detail in this
 * file.** The backoffice mixes Arabic prose with LTR-only tokens: IDs,
 * endpoints, versions, emails, tool signatures. The Unicode bidi algorithm
 * treats punctuation like `.`/`:`/`/` as direction-neutral, taking its
 * direction from surrounding context — so `mcp://customs.shj.ae` sitting
 * inside an Arabic sentence can have its dot-separated segments visually
 * reordered, silently turning a real endpoint into a wrong-looking one on
 * screen while the underlying string stays correct. `dir="ltr"` fixes this
 * run's *base* direction; `unicode-bidi: isolate` is what actually opens an
 * independent bidi context so the surrounding paragraph's direction cannot
 * reach in and reorder it — `dir` alone, without `isolate`, does not fully
 * prevent that. Both are unconditional (not "only when locale is ar")
 * because the content itself — a version string, a UUID — is always
 * LTR-shaped regardless of which locale is rendering the surrounding page.
 *
 * Not `"use client"`: nothing in the `default`/`truncate` path needs a
 * browser API or component state. Only the `copyable` variant does, which is
 * exactly why that piece lives in its own client component
 * (`mono-sub-line-copy-button.tsx`) instead of making this whole file
 * client-only for one variant out of three.
 */
export const MonoSubLine = React.forwardRef<HTMLSpanElement, MonoSubLineProps>(function MonoSubLine(
  { variant = "default", className, children, value, copyLabel, copiedMessage, ...props },
  ref,
) {
  const copyValue = value ?? (typeof children === "string" ? children : undefined);

  return (
    <span
      ref={ref}
      data-slot="mono-sub-line"
      dir="ltr"
      style={{ unicodeBidi: "isolate" }}
      className={cn(monoSubLineVariants({ variant }), className)}
      {...props}
    >
      {variant === "copyable" ? (
        <>
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
            {children}
          </span>
          {copyValue !== undefined && (
            <MonoSubLineCopyButton
              value={copyValue}
              copyLabel={copyLabel}
              copiedMessage={copiedMessage}
            />
          )}
        </>
      ) : (
        children
      )}
    </span>
  );
});
