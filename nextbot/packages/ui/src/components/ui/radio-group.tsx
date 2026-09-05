"use client"

import * as React from "react"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"
import { Radio as RadioPrimitive } from "@base-ui/react/radio"

import { cn } from "@nextbot/ui/lib/utils"

/**
 * Batch D hand-authored primitive (same network-access constraint noted in every
 * other hand-authored primitive's doc comment this migration — see `select.tsx`).
 * Built on Base UI's `RadioGroup`/`Radio`. First consumer is `ModelGateway.tsx`'s
 * "platform-registered provider" vs. "own endpoint" chain-entry mode picker
 * (previously Chakra's `RadioGroup`/`Radio`).
 */
function RadioGroup({
  className,
  ...props
}: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  ...props
}: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-transparent outline-none transition-shadow focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-checked:border-primary",
        className
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        className="flex items-center justify-center after:block after:size-2 after:rounded-full after:bg-primary data-unchecked:hidden"
      />
    </RadioPrimitive.Root>
  )
}

export { RadioGroup, RadioGroupItem }
