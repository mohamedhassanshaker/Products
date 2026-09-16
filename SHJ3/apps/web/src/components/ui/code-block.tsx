"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";

export type CodeBlockVariant = "snippet" | "json" | "trace";

const VARIANT_LABEL: Readonly<Record<CodeBlockVariant, string>> = {
  snippet: "Snippet",
  json: "JSON",
  trace: "Trace",
};

/** How long the "Copied" confirmation stays visible/announced before resetting — mono-sub-line-copy-button.tsx's identical precedent and value. */
const CONFIRMATION_VISIBLE_MS = 2000;

export interface CodeBlockProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  variant?: CodeBlockVariant;
  code: string;
  /** Overrides the variant's default header label, e.g. "get_bill_status.py" for a `snippet`. */
  language?: string;
  /** Wrap long lines instead of scrolling horizontally. Off by default: a trace/JSON payload's line breaks are usually meaningful. */
  wrap?: boolean;
  copyLabel?: string;
  copiedMessage?: string;
}

/**
 * Snippet/JSON/trace display (design-system.md §5.4 #34) — B10's embed
 * snippet, B3's sample JSON, B6's playground output.
 *
 * **Deliberately renders plain monospace text with no per-token colouring —
 * not an oversight.** Every general-purpose syntax highlighter hardcodes a
 * palette per token *type* (keyword colour, string colour, comment colour),
 * which is exactly what this project's token gate exists to prevent: none of
 * the 152 semantic tokens models "keyword" or "string" as a role, and a
 * highlighter's own colour table cannot repaint under a tenant skin the way
 * every other surface in this system does. `--code-surface`/
 * `--code-foreground` (packages/tokens/src/semantic.ts — confirmed present,
 * not assumed) are the only two roles this component needs, and they are
 * enough: a reader can read code without syntax colour, and a tenant
 * re-brand cannot silently break contrast on text this component never
 * gives a fixed colour to. A future contributor should not "fix" this by
 * adding a highlighting dependency — this is a real, considered scope
 * boundary, restated here so it reads as a decision rather than as laziness.
 *
 * Always `dir="ltr"` (§11.3: "every trace line stays `dir="ltr"` because it
 * is code") — unconditional in both locales, the same reasoning
 * `mono-sub-line.tsx` documents at length for the identical LTR-content-
 * inside-possibly-RTL-page problem.
 */
export const CodeBlock = React.forwardRef<HTMLDivElement, CodeBlockProps>(function CodeBlock(
  {
    variant = "snippet",
    code,
    language,
    wrap = false,
    copyLabel = "Copy code",
    copiedMessage = "Copied to clipboard",
    className,
    style,
    ...props
  },
  ref,
) {
  const [justCopied, setJustCopied] = React.useState(false);
  const resetTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(() => () => clearTimeout(resetTimer.current), []);

  function handleCopy() {
    void navigator.clipboard.writeText(code).then(() => {
      setJustCopied(true);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setJustCopied(false), CONFIRMATION_VISIBLE_MS);
    });
  }

  return (
    <div
      ref={ref}
      data-slot="code-block"
      data-variant={variant}
      style={{ borderRadius: "var(--radius-md)", ...style }}
      className={cn(
        "overflow-hidden border border-border bg-code-surface text-code-foreground",
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span
          dir="ltr"
          style={{ unicodeBidi: "isolate" }}
          className="font-mono text-2xs text-muted-foreground"
        >
          {language ?? VARIANT_LABEL[variant]}
        </span>
        <IconButton
          ariaLabel={copyLabel}
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="text-muted-foreground"
        >
          {justCopied ? (
            <Check aria-hidden="true" className="size-3.5" />
          ) : (
            <Copy aria-hidden="true" className="size-3.5" />
          )}
        </IconButton>
      </div>
      <pre
        dir="ltr"
        style={{ unicodeBidi: "isolate" }}
        className={cn(
          "overflow-x-auto p-3 font-mono text-2xs leading-relaxed",
          wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
        )}
      >
        <code>{code}</code>
      </pre>
      <span role="status" aria-live="polite" className="sr-only">
        {justCopied ? copiedMessage : ""}
      </span>
    </div>
  );
});
