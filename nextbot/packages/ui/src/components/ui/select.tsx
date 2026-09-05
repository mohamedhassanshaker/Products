"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons"

import { cn } from "@nextbot/ui/lib/utils"

/**
 * Batch A hand-authored primitive (network access to the shadcn registry was
 * unavailable during this dispatch — see `docs/plans/chakra-to-shadcn-plan.md`'s
 * Batch A entry). Built directly on Base UI's `Select` (this project's already-
 * adopted primitive library, per Phase 0's preset resolution), matching this
 * package's existing generated components' conventions (rounded-none, the
 * project's strengthened 2px focus ring, `cn`/`data-slot`).
 *
 * QA fix (Batch C retry 1, Defect 1 — BLOCKING): Base UI's `Select.Value` only
 * resolves a human label for the current value when `Select.Root` is given an
 * `items` map; without it, any value set outside a direct user click on an item
 * (a `defaultValue`, or a value populated from a fetch — e.g. `TakeoverPanel`'s
 * "Transfer to queue" after claiming an escalation, or `ConnectorWizard`'s
 * `transport`/`environment`/`authMethod` fields on initial load) renders the
 * raw underlying value instead of its label. Rather than requiring every call
 * site to hand-build and pass an `items` map itself (easy to forget, and the
 * exact bug this fix closes), this component derives that map once, here,
 * by walking its own `children` for `SelectItem` elements and reading each
 * one's `value`/label back out — so every consumer of this shared primitive
 * gets correct label resolution for free, regardless of how the value was set.
 */
function Select({ children, ...props }: SelectPrimitive.Root.Props<string>) {
  const items = React.useMemo(() => collectSelectItems(children), [children])
  return (
    <SelectPrimitive.Root data-slot="select" items={items.length > 0 ? items : undefined} {...props}>
      {children}
    </SelectPrimitive.Root>
  )
}

/**
 * Recursively walks a `Select`'s `children` tree (which may nest `SelectItem`s
 * inside `SelectContent`/`SelectList`/mapped arrays/fragments/`FormControl`
 * wrappers, etc.) collecting `{ value, label }` pairs for every `SelectItem`
 * found. Used to build the `items` map Base UI's `Select.Root` needs to
 * resolve a display label for the current value (see this file's top doc
 * comment for why this matters — Defect 1).
 */
function collectSelectItems(node: React.ReactNode): Array<{ value: string; label: React.ReactNode }> {
  const items: Array<{ value: string; label: React.ReactNode }> = []
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return
    const childProps = child.props as { value?: string; children?: React.ReactNode }
    if (child.type === SelectItem) {
      items.push({ value: childProps.value as string, label: childProps.children })
      return
    }
    if (childProps && childProps.children !== undefined) {
      items.push(...collectSelectItems(childProps.children))
    }
  })
  return items
}

function SelectTrigger({
  className,
  children,
  ...props
}: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex h-8 w-full items-center justify-between gap-2 rounded-none border border-input bg-transparent px-2.5 py-1 text-xs whitespace-nowrap outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 data-[popup-open]:border-ring data-[popup-open]:ring-2 data-[popup-open]:ring-ring dark:bg-input/30",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={2} className="shrink-0 opacity-60" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectValue({ ...props }: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectContent({
  className,
  children,
  sideOffset = 4,
  ...props
}: SelectPrimitive.Popup.Props & Pick<SelectPrimitive.Positioner.Props, "sideOffset">) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner sideOffset={sideOffset} className="isolate z-50">
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "max-h-(--available-height) min-w-[8rem] origin-(--transform-origin) overflow-y-auto rounded-none border bg-popover text-popover-foreground shadow-md data-[side=none]:scroll-py-1 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          <SelectPrimitive.List className="p-1">{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-none py-1.5 ps-2 pe-8 text-xs outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute end-2 flex items-center">
        <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }
