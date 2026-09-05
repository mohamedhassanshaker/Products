import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@nextbot/ui/lib/utils"

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-none border px-2.5 py-2 text-start text-xs has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pe-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current",
        // Locally-added variant (not shipped by the shadcn preset): QA Defect U9
        // requires a lockout condition to be *visually and behaviorally* distinct
        // from a wrong-password error — a lower-severity amber/warning tone here,
        // reserved for that "wrong but expected/recoverable" class of message,
        // never reused for a genuine failure (which stays `destructive`).
        warning:
          "border-amber-300 bg-amber-50 text-amber-900 *:data-[slot=alert-description]:text-amber-800 *:[svg]:text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100 *:data-[slot=alert-description]:dark:text-amber-200",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-xs/relaxed text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-2",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn(
        "absolute top-[calc(--spacing(1.25))] end-[calc(--spacing(1.25))]",
        className
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
