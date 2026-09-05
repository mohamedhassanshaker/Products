"use client"

import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { HugeiconsIcon } from "@hugeicons/react"
import { Tick02Icon } from "@hugeicons/core-free-icons"

import { cn } from "@nextbot/ui/lib/utils"

/**
 * Batch D hand-authored primitive (same network-access constraint noted in every
 * other hand-authored primitive's doc comment this migration — see `select.tsx`).
 * Built on Base UI's `Menu`. Replaces Chakra's `Menu`/`MenuButton`/`MenuList`/
 * `MenuItem` family — first consumer is `DefinitionDetail.tsx`'s "Promote to…"
 * action menu (Agent Platform).
 */
function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  align = "start",
  children,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<MenuPrimitive.Positioner.Props, "sideOffset" | "align" | "side">) {
  return (
    <DropdownMenuPortal>
      <MenuPrimitive.Positioner
        sideOffset={sideOffset}
        align={align}
        className="isolate z-50"
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "max-h-(--available-height) min-w-[10rem] origin-(--transform-origin) overflow-y-auto rounded-none border bg-popover p-1 text-popover-foreground shadow-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </DropdownMenuPortal>
  )
}

function DropdownMenuItem({
  className,
  ...props
}: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-none px-2 py-1.5 text-xs outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuGroupLabel({
  className,
  ...props
}: MenuPrimitive.GroupLabel.Props) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-group-label"
      className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  )
}

/** Optional check-mark indicator, for a menu item representing the currently
 * selected value (not needed by every consumer — `DefinitionDetail.tsx`'s
 * "Promote to…" menu doesn't use it, since every listed target is always a
 * forward transition, never "currently selected"). */
function DropdownMenuItemIndicator({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span className={cn("ms-auto flex items-center", className)} {...props}>
      <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} />
    </span>
  )
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroupLabel,
  DropdownMenuItemIndicator,
}
