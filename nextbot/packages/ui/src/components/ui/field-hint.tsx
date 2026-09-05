import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { InformationCircleIcon } from "@hugeicons/core-free-icons"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@nextbot/ui/components/ui/tooltip"

/**
 * `FieldHint` — a small "?"-style info affordance meant to sit inline next to a form
 * `Label`, surfacing one sentence of field-level help on hover/focus.
 *
 * This is a *different* usage of the underlying `Tooltip` primitive than the rest of
 * the codebase's existing tooltip usages (which explain a disabled/complex row state,
 * e.g. `RolesTable.tsx`'s "why is Edit disabled" tooltip): `FieldHint` establishes the
 * systematic field-level-help pattern described in
 * `docs/design/UX_GUIDELINES.md` §1.c, and is the primitive every form field should
 * eventually adopt.
 *
 * Accessibility: verified against this project's actual installed
 * `@base-ui/react@1.7.0` — its `Tooltip.Root`/`Tooltip.Popup` do **not** wire
 * `aria-describedby` or a `role="tooltip"` automatically (unlike some other
 * Base-UI-family primitives); assuming otherwise would leave the tooltip content
 * invisible to assistive tech even though it's visually present. `FieldHint` therefore
 * runs the tooltip as a controlled component and wires `aria-describedby` on the
 * trigger to the popup's `id` itself, only while the tooltip is actually open (an
 * `aria-describedby` left pointing at an unmounted popup would be a dangling ARIA
 * IDREF — the same defect class already fixed once in this codebase for
 * `FormControl`, see `form.test.tsx`). The trigger itself is a real
 * `<button type="button">` (Base UI's default render element) so it is independently
 * focusable/reachable by keyboard, and carries an explicit `aria-label` (defaulting to
 * "More information") so screen readers announce a meaningful accessible name distinct
 * from the `Label` it sits beside.
 *
 * QA fix pass (client-feedback-batch, retry 2 of Phases 1/2/4 verification) — `id` is
 * a REQUIRED prop, not optional/auto-generated. Base UI's `Tooltip.Trigger` always
 * writes a DOM `id` attribute (its own internally-generated one if the caller doesn't
 * supply one), and on the pages this component actually renders on (Model Gateway,
 * VersionEditor) that internal id genuinely drifts between the server render and the
 * client's hydration pass — both pages render `FieldHint` beneath a conditional
 * `<Skeleton>`/data-loading branch, so the ancestor tree shape differs between the two
 * renders, which shifts every `React.useId()`-based id downstream (confirmed
 * experimentally: even a `React.useId()` call added directly in `tooltip.tsx`
 * reproduced the identical mismatch). No hook-generated default can be SSR-stable
 * here, so this component takes the id from its caller instead, who has the one
 * thing a shared primitive can't: real, stable, non-content-derived uniqueness (e.g.
 * a field's own `htmlFor` id, or `` `${entryKey}-provider-hint` `` inside a mapped
 * list). Deriving it from `content` instead (the tooltip text) was considered and
 * rejected — `ModelGateway.tsx`'s Provider Chain entries render several `FieldHint`s
 * with byte-identical `content` once per row, so a content-derived id would collide
 * across rows and silently misdirect `aria-describedby` to the wrong row's popup.
 */
export function FieldHint({
  id,
  content,
  label = "More information",
}: {
  /** Caller-supplied, unique, deterministic id for this hint's trigger — required
   * (see this function's doc comment for why). Must be unique across every
   * `FieldHint` rendered on the same page at once, including repeated instances
   * inside a mapped list (derive it from the row/entry's own key, not from
   * `content`, which may repeat across rows). */
  id: string
  /** One sentence explaining what the field actually does — not a restatement of its
   * label. Rendered as the tooltip's popup content. */
  content: string
  /** Accessible name for the trigger button. Defaults to a generic "More information"
   * — override only if a field needs a more specific announced name (rare). */
  label?: string
}) {
  const [open, setOpen] = React.useState(false)
  // The popup's own id is scoped off the caller-supplied trigger id (not a separate
  // `React.useId()`) so it inherits the same SSR-stability guarantee — see this
  // function's doc comment. This popup is never present in the initial server-
  // rendered HTML (it only mounts once `open` flips true, purely client-side), so it
  // was never actually part of the reported hydration-mismatch defect, but deriving
  // it from `id` rather than from its own `useId()` keeps both of this component's
  // generated DOM ids on the same stable footing rather than mixing strategies.
  const contentId = `${id}-content`

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        id={id}
        data-slot="field-hint-trigger"
        type="button"
        aria-label={label}
        aria-describedby={open ? contentId : undefined}
        className="inline-flex size-3.5 items-center justify-center rounded-full text-muted-foreground align-middle focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        <HugeiconsIcon icon={InformationCircleIcon} size={14} strokeWidth={1.8} />
      </TooltipTrigger>
      <TooltipContent id={contentId}>{content}</TooltipContent>
    </Tooltip>
  )
}
