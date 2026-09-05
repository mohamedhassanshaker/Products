import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@nextbot/ui/lib/utils"

const badgeVariants = cva(
  // QA Defect D5 audit: badges are only focusable when rendered as an interactive
  // element (e.g. `render={<a .../>}`) — brought the ring opacity in line with the
  // rest of the primitives' strengthened focus ring for consistency.
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-none border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        // Batch C axe-core scan (this dispatch): the original soft `bg-destructive/10
        // text-destructive` pairing measured ~4:1 against the destructive red at this
        // badge's 9pt/12px size — short of WCAG AA's 4.5:1 for normal text. Switched to
        // a solid background + explicit white text (same "solid, pre-verified pairing"
        // convention already established elsewhere in this codebase — e.g.
        // `TakeoverPanel.tsx`'s status Badge, `emerald-700`/white) rather than tuning
        // the tint further, since this project has no `--destructive-foreground` token
        // defined in `globals.css` to fall back on.
        destructive:
          "bg-destructive text-white focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/80",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
