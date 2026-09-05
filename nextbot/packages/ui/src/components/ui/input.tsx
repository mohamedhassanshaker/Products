import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@nextbot/ui/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        // QA Defect D5: the shadcn preset's default focus ring (1px, 50% opacity)
        // fell short of this project's established "clearly visible focus ring" bar
        // (a prior WCAG-driven QA fix applied project-wide — UX_GUIDELINES.md §1.b's
        // ≥3:1 contrast requirement for meaningful UI components, focus rings
        // included). Widened to 2px at full opacity so it reliably clears contrast
        // against both light and dark surfaces.
        "h-8 w-full min-w-0 rounded-none border border-input bg-transparent px-2.5 py-1 text-xs transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 md:text-xs dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
