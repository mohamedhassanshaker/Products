"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@nextbot/ui/lib/utils"

/**
 * Batch B hand-authored primitive (same network-access constraint noted in
 * `dialog.tsx`/Batch A's primitives). Built on Base UI's `Tabs`. Unlike Chakra's
 * `Tabs`, Base UI's `Tabs.Panel` unmounts inactive panels by default (`keepMounted`
 * is opt-in) — `RolesList.tsx`'s existing test comment ("both tab panels stay
 * mounted simultaneously") relied on Chakra's always-mounted default, so that test
 * was updated in this same dispatch to reflect the new (equally valid) behavior
 * rather than forcing `keepMounted` everywhere to preserve an incidental old
 * assumption.
 */
function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-9 w-fit items-center gap-1 border-b border-border",
        className
      )}
      {...props}
    />
  )
}

/**
 * QA fix pass (client-feedback-batch, proactive audit item 1 — reproduced live on
 * `/mcp-health` at 3/20 (15%) fresh-load repro rate). Same defect class already fixed
 * twice in this package (`sidebar.tsx`'s `SidebarSection`, `tooltip.tsx`/
 * `field-hint.tsx`'s `FieldHint`): Base UI's `Tabs.Tab` writes its rendered `<button>`'s
 * `id` from `useBaseUiId(idProp)` (`tabs/tab/TabsTab.mjs`) — an internally generated,
 * request-scoped id whenever the caller doesn't supply one, and that id is also what
 * `Tabs.Panel` reads back (via `getTabIdByPanelValue`) to set its own
 * `aria-labelledby`. `McpHealthPage`'s `Tabs` wraps `McpHealthDashboard`, which has its
 * own conditional `<Skeleton>`/data-loading branch nested inside `TabsContent` — that
 * branch's tree-shape genuinely differs between the server render and the client's
 * first (hydration) render, which shifts every `React.useId()`-based id downstream
 * (the same root cause already documented in `tooltip.tsx`'s doc comment). No
 * `useId()`-based default can be SSR-stable here, so `TabsTrigger`/`TabsContent` take a
 * **required** caller-supplied `id` instead of relying on Base UI's internal default
 * (already treated as authoritative over the generated fallback — no change needed to
 * the plain prop spread below). Required, not optional-with-fallback, because `Tabs`
 * is a general-purpose primitive with no way for this shared component to know whether
 * a given call site nests a data-loading branch beneath it.
 *
 * QA fix pass (client-feedback-batch, hydration-bug-class audit — final item, axe-core
 * `aria-valid-attr-value` CRITICAL on `/mcp-health` and `/roles`): the `id` override
 * above fixed the hydration mismatch but broke `aria-controls`. `Tabs.Tab` computes its
 * rendered `aria-controls` from `getTabPanelIdByValue(value)` (`tabs/tab/TabsTab.mjs`),
 * which reads Base UI's own internal panel-id registry — populated by `Tabs.Panel` with
 * the *internally generated* id it captured from `useBaseUiId()` before our `id` prop
 * override is applied downstream via `mergeProps` (`tabs/panel/TabsPanel.mjs`). That
 * registry has no visibility into our DOM-level override, so `aria-controls` kept
 * pointing at an id that's never actually rendered — a nonexistent-id violation.
 * There's no way to fix the registry's contents without patching Base UI, but the same
 * override technique used for `id` also works for `aria-controls`: it's just another
 * attribute resolved through `useRenderElement`'s prop merge, where our explicitly
 * passed value in the trailing `elementProps` object wins over the internally
 * computed one (confirmed by reading `tabs/tab/TabsTab.mjs`'s `props: [...]` array —
 * `aria-controls` is set from the internal registry earlier in that array, and
 * `elementProps` — which is where our own JSX attributes land — comes later, so
 * rightmost-wins semantics apply the same way they do for `id` on `TabsPanel`).
 * `panelId` is a new required prop rather than a derived transform of `value`/`id`
 * because there's no structural guarantee a caller's naming convention (e.g. this
 * package's own `-tab-`/`-panel-` suffix convention) holds — deriving it by string
 * transform would silently break for any caller that names differently. Requiring it
 * explicitly costs one extra attribute per trigger, but it's a value the caller already
 * has in hand (it's the exact same string passed to the matching `TabsContent`'s `id`),
 * so it's not new information to invent, just to pass through.
 */
function TabsTrigger({
  className,
  id,
  panelId,
  ...props
}: Omit<TabsPrimitive.Tab.Props, "id" | "aria-controls"> & {
  /** Caller-supplied, unique, deterministic id for this tab's trigger button —
   * required (see this function's doc comment for why). Must be unique across every
   * `TabsTrigger` rendered on the same page at once, including sibling `Tabs`
   * instances — derive it from the tab's own `value` plus a page/instance-scoped
   * prefix (e.g. `` `mcp-health-tab-${value}` ``), never left to default. */
  id: string
  /** The `id` of this trigger's corresponding `TabsContent` panel — must be exactly
   * the same string passed as that `TabsContent`'s `id` prop. Used to set this
   * trigger's rendered `aria-controls` explicitly, since Base UI's own internal
   * `aria-controls` computation doesn't know about the `id` override `TabsContent`
   * applies (see this function's doc comment for the full root-cause writeup). */
  panelId: string
}) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      id={id}
      aria-controls={panelId}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 border-b-2 border-transparent px-3 text-xs font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-selected:border-primary data-selected:text-foreground disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

/**
 * See `TabsTrigger`'s doc comment for the full root-cause writeup. Base UI's
 * `Tabs.Panel` doesn't accept an `idProp` override in its own `useBaseUiId()` call
 * (`tabs/panel/TabsPanel.mjs`), but its rendered `id` attribute still resolves through
 * `useRenderElement`'s prop merge, where an explicitly-passed `id` in the trailing
 * `elementProps` object overrides the internally-generated one (`mergeProps`'s
 * rightmost-wins semantics, confirmed by reading
 * `internals/useRenderElement.mjs`/`merge-props/mergeProps.mjs`) — so passing `id`
 * here is sufficient without needing a Base UI code change.
 */
function TabsContent({
  className,
  id,
  ...props
}: Omit<TabsPrimitive.Panel.Props, "id"> & {
  /** Caller-supplied, unique, deterministic id for this tab's panel — required, same
   * contract as `TabsTrigger`'s `id` (see that component's doc comment). */
  id: string
}) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      id={id}
      className={cn("outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
