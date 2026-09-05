import * as React from "react"

import { cn } from "@nextbot/ui/lib/utils"

/**
 * Batch C hand-authored primitive (same network-access constraint noted in
 * `select.tsx`/`dialog.tsx`'s doc comments — no registry access this dispatch
 * either). Base UI has no dedicated `Textarea` part (only its `Input`, which
 * renders a native `<input>`), so this is a plain `<textarea>` styled to match
 * `input.tsx`'s conventions (same border/focus-ring/disabled treatment) rather
 * than a headless-primitive wrapper — there's no interaction behavior beyond
 * what the native element already provides.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full rounded-none border border-input bg-transparent px-2.5 py-1.5 text-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 md:text-xs dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
