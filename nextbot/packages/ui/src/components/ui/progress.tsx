"use client"

import * as React from "react"
import { Progress as ProgressPrimitive } from "@base-ui/react/progress"

import { cn } from "@nextbot/ui/lib/utils"

/**
 * Batch C hand-authored primitive (same network-access constraint noted
 * throughout this package — see `select.tsx`'s doc comment). Built on Base
 * UI's `Progress` (already vendored via `@base-ui/react`), replacing Chakra's
 * `Progress` — used by the Conversation Trace Viewer's per-message confidence
 * gauge and conversation-level indicator (FR-AI-07's three-band confidence
 * convention lives in the *consumer*, this primitive is purely presentational).
 */
function Progress({
  className,
  value,
  ...props
}: ProgressPrimitive.Root.Props) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn("relative w-full", className)}
      {...props}
    >
      <ProgressPrimitive.Track
        data-slot="progress-track"
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className="h-full bg-primary transition-all duration-300 ease-out"
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  )
}

export { Progress }
