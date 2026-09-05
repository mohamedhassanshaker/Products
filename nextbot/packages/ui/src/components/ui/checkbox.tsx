"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { HugeiconsIcon } from "@hugeicons/react"
import { Tick02Icon } from "@hugeicons/core-free-icons"

import { cn } from "@nextbot/ui/lib/utils"

/** Batch A hand-authored primitive — see `select.tsx`'s doc comment for why this
 * isn't CLI-generated this dispatch. Built on Base UI's `Checkbox`. */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-none border border-input bg-transparent outline-none transition-shadow focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current data-unchecked:hidden">
        <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
