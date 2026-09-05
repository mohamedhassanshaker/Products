import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@nextbot/ui/lib/utils"

function TooltipProvider({
  delay = 0,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  )
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

/**
 * QA fix pass (client-feedback-batch, retry 2 of Phases 1/2/4 verification) —
 * reproducible React hydration mismatch on this trigger's DOM `id`, captured
 * verbatim in a real browser console log: "id=base-ui-_R_3u9a9bn5ritu15r1b_ vs
 * id=base-ui-_R_fp595esnebnqknd1b_ on an element carrying
 * data-base-ui-tooltip-trigger". Root-caused by reading Base UI's own source
 * (`tooltip/trigger/TooltipTrigger.mjs`): the rendered `<button>`'s `id` attribute
 * is `thisTriggerId = useBaseUiId(idProp)`, which falls back to an internally
 * generated id (`@base-ui/utils/useId`, itself a thin wrapper over React's own
 * `useId()`) whenever the caller doesn't pass an explicit `id` prop.
 *
 * Unlike the already-fixed `Collapsible` case (`sidebar.tsx`'s `SidebarSection`,
 * a single call site with a stable ancestor tree), this codebase's actual pages
 * that host a `Tooltip` (Model Gateway, VersionEditor) render it beneath a
 * conditional `<Skeleton>`/data-dependent loading branch, so the surrounding tree
 * shape genuinely differs between the server render and the client's first
 * (hydration) render. That upstream tree-shape drift shifts EVERY React
 * `useId()`-based id downstream by the same amount — verified experimentally by
 * first trying a wrapper-local `React.useId()` fallback here, which reproduced the
 * *exact same* mismatch class (own id `_R_3u9a9bn...` vs `_R_fp595es...`), proving
 * this is not specific to Base UI's own internal hook chain. No `useId()`-based
 * default can be SSR-stable here, so this primitive does not attempt to synthesize
 * one: it forwards a caller-supplied `id` straight through to Base UI's
 * `Tooltip.Trigger` (already true of the plain prop spread below — Base UI treats
 * a supplied `idProp` as authoritative over its own generated fallback) and
 * otherwise leaves Base UI's default in place.
 *
 * Callers that put more than one `TooltipTrigger` on the same page — especially
 * inside a list, where every row's trigger content/children are structurally
 * identical (e.g. `RolesTable.tsx`'s per-row "why is Edit disabled" tooltip,
 * `ModelGateway.tsx`'s per-Provider-Chain-entry field hints) — MUST pass their own
 * explicit, unique `id` (derived from real caller-side context: a row/entry key, a
 * field name — never from trigger content/children, which can collide across rows)
 * to get a hydration-safe result. `FieldHint` (`field-hint.tsx`) is the fixed
 * reference implementation of this: it requires an `id` prop from its own callers
 * and forwards it here. The ~9 other pre-existing callers of this primitive
 * (`RolesTable.tsx`, `ToolCatalog.tsx`, etc.) are unchanged by this fix and keep
 * relying on Base UI's own generated id — they were not reported as exhibiting this
 * defect and are out of this fix's scope (see docs/plans/client-feedback-batch-
 * plan.md Phase 11 for their deferred rollout).
 */
function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-none bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pe-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-start-2 data-[side=inline-start]:slide-in-from-end-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-none data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-none bg-foreground fill-foreground data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-start-1 data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-end-1 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
