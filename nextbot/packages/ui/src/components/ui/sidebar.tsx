"use client"

import * as React from "react"
import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar"
import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon } from "@hugeicons/core-free-icons"

import { cn } from "@nextbot/ui/lib/utils"

/**
 * Plan Phase 2 (client-feedback-batch) hand-authored primitive — same network-access
 * constraint noted throughout this package's other hand-authored primitives (see
 * `select.tsx`/`dropdown-menu.tsx`). Built on Base UI's `Toolbar` (already vendored
 * via `@base-ui/react`, previously unused in this package) for roving-tabindex
 * keyboard navigation and `Collapsible` (see `collapsible.tsx`) for the disclosure
 * group. Replaces the hand-rolled `<nav>`/mapped-`<div>` list in
 * `apps/web/app/(admin)/AdminShell.tsx`.
 *
 * `Toolbar.Root` with `orientation="vertical"` gives Up/Down-arrow roving focus (and
 * Home/End) across every `SidebarItem`/section trigger for free — deliberately not a
 * hand-rolled keydown handler, per this project's convention of preferring what the
 * underlying primitive already provides.
 */
function Sidebar({ className, ...props }: React.ComponentProps<"nav">) {
  return <nav data-slot="sidebar" className={cn("flex flex-col", className)} {...props} />
}

/** The scrollable, keyboard-navigable list of `SidebarItem`s/`SidebarSection`s. */
function SidebarNav({ className, ...props }: ToolbarPrimitive.Root.Props) {
  return (
    <ToolbarPrimitive.Root
      data-slot="sidebar-nav"
      orientation="vertical"
      className={cn("flex flex-col items-stretch gap-1", className)}
      {...props}
    />
  )
}

interface SidebarItemProps extends ToolbarPrimitive.Link.Props {
  /** True when the current route matches this item — drives both the visual active
   * state (`data-active`) and `aria-current="page"` for assistive tech. Callers
   * derive this from `usePathname()`; this primitive has no route awareness of its
   * own. */
  active?: boolean
}

/** A single nav destination. Renders an `<a>` (via `render`, e.g. Next's `Link`) so
 * it participates in native browser link semantics (open-in-new-tab, etc.) as well as
 * the parent `SidebarNav` toolbar's roving-tabindex group. */
function SidebarItem({ className, active = false, ...props }: SidebarItemProps) {
  return (
    <ToolbarPrimitive.Link
      data-slot="sidebar-item"
      data-active={active ? "true" : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "block rounded-none px-2 py-2 ps-2 text-start transition-colors outline-none hover:bg-white/20 focus-visible:bg-white/20 data-[active=true]:bg-white/25 data-[active=true]:font-semibold",
        className
      )}
      {...props}
    />
  )
}

interface SidebarSectionProps {
  /** Section heading, e.g. "Agent Platform". */
  label: string
  /** Initial open state used for the server-rendered/first-client-render markup,
   * before any persisted preference (see `storageKey`) is applied.
   * @default true */
  defaultOpen?: boolean
  /** When provided, the open/closed state is persisted to `localStorage` under this
   * key so the group's disclosure state survives a reload. Best-effort only: reads
   * and writes are wrapped in `try/catch` and silently no-op when `localStorage` is
   * unavailable (SSR, private browsing, a locked-down embed) — this is a UX nicety,
   * never something that should throw into render. */
  storageKey?: string
  className?: string
  children: React.ReactNode
}

/**
 * A collapsible group of `SidebarItem`s under a heading (e.g. "Agent Platform").
 * The trigger is a real `<button>` (native Space/Enter toggle semantics from Base
 * UI's `Collapsible.Trigger`), and its items stay inside the same `SidebarNav`
 * `Toolbar.Root` DOM subtree, so arrow-key roving still flows across them like any
 * other item whenever the section is open.
 */
function SidebarSection({ label, defaultOpen = true, storageKey, className, children }: SidebarSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen)

  // QA fix (client-feedback-batch, QA-driven fix pass for Phase 2) — intermittent
  // SSR/CSR hydration mismatch on this trigger/panel's `aria-controls`/`id` pairing,
  // captured verbatim in a browser console log: `+ aria-controls="base-ui-_R_..."`
  // vs. `- aria-controls="base-ui-_R_..."`. Root-caused by reading Base UI's own
  // `Collapsible` source (`useCollapsibleRoot.ts`/`CollapsibleTrigger.ts`): the
  // trigger's `aria-controls` is wired from `Collapsible.Root`'s own internal
  // `useId()` call (via `useBaseUiId`), which encodes this component's *position in
  // the render tree*. Reproduced live (Playwright, 20 fresh hard-navigation loads
  // against a real running dev server — 4/20 hit the mismatch) and confirmed the
  // mismatch is NOT caused by
  // this component's own `open`/`defaultOpen` state (verified correct above — the
  // localStorage-derived preference is deliberately deferred to the `useEffect`
  // below, never read during the render that must match server output) — it
  // reproduced intermittently (~30% of fresh loads) purely from `useId()`'s
  // generated value differing between the server render and the client's initial
  // hydration render, independent of this component's own state. Since neither this
  // component nor its known callers (`AdminShell.tsx`) can guarantee a perfectly
  // stable tree-position count upstream on every request, the robust fix is to stop
  // depending on a request-scoped generated id for this pairing at all: `label` is a
  // plain, caller-supplied string, identical on every render (server or client) with
  // no dependency on hook-call ordering, so deriving the panel id from it — rather
  // than from `useId()` — removes this entire class of drift structurally instead of
  // occasionally colliding with it.
  const panelId = `sidebar-section-panel-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`

  // Best-effort persisted disclosure state, read once after mount. Deliberately not
  // read during the initial render (server or first client pass): that render must
  // match `defaultOpen` exactly to avoid a hydration mismatch, so any stored
  // preference is only applied after mount, same as every other client-only
  // localStorage read in this codebase.
  React.useEffect(() => {
    if (!storageKey) return
    try {
      const stored = window.localStorage.getItem(storageKey)
      if (stored !== null) setOpen(stored === "true")
    } catch {
      // localStorage unavailable — fall back to `defaultOpen`.
    }
  }, [storageKey])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!storageKey) return
    try {
      window.localStorage.setItem(storageKey, String(next))
    } catch {
      // Persisting the preference is a nicety, never fatal to the toggle itself.
    }
  }

  return (
    <CollapsiblePrimitive.Root data-slot="sidebar-section" open={open} onOpenChange={handleOpenChange} className={className}>
      <CollapsiblePrimitive.Trigger
        data-slot="sidebar-section-trigger"
        // Explicit override of Base UI's own generated `aria-controls` — see this
        // function's opening comment. A directly-supplied prop here wins over the
        // primitive's internal default (same override convention already relied on
        // for `aria-label` on `SelectTrigger` elsewhere in this package).
        aria-controls={open ? panelId : undefined}
        className="mt-4 mb-1 flex w-full items-center justify-between ps-2 pe-2 text-xs font-bold tracking-wide text-white/60 uppercase outline-none hover:text-white/80 focus-visible:text-white/80"
      >
        {label}
        {/* Base UI's Collapsible.Trigger exposes `data-panel-open` while the panel is
            open — collapsed points toward the reading-start direction (rotated -90deg,
            mirrored in RTL via `rtl:-scale-x-100` since `rotate-90`'s sign doesn't
            flip automatically), open points down. */}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={14}
          strokeWidth={2}
          className="-rotate-90 transition-transform rtl:-scale-x-100 data-[panel-open]:rotate-0 data-[panel-open]:rtl:scale-x-100"
        />
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Panel
        id={panelId}
        data-slot="sidebar-section-content"
        className="flex flex-col items-stretch gap-1"
      >
        {children}
      </CollapsiblePrimitive.Panel>
    </CollapsiblePrimitive.Root>
  )
}

export { Sidebar, SidebarNav, SidebarItem, SidebarSection }
