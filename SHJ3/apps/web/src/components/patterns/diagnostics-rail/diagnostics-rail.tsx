"use client";

import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/** See button.tsx for the full rationale — identical recipe, kept local per component rather than shared. */
const FOCUS_VISIBLE_RING =
  "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]";

export type DiagnosticsRailTab = "trace" | "grounding";

export interface DiagnosticsRailProps {
  /**
   * The "Agent trace" panel — `DiffTraceViewer`'s `trace` variant (a
   * different agent's organism, not built yet in this wave; design-system.md
   * §5.5 #52/#47). Accepted as a slot rather than imported, per the brief:
   * this rail's own job is the responsive chrome and the tab/panel
   * structure, not trace rendering.
   */
  trace: React.ReactNode;
  /** The "Sources" panel — `DiffTraceViewer`'s `grounding` variant. */
  grounding: React.ReactNode;
  /** Default is English; pass a translated string in real feature code. */
  traceLabel?: string;
  groundingLabel?: string;
  /** Accessible name for the tablist itself. Default is English. */
  "aria-label"?: string;
  defaultTab?: DiagnosticsRailTab;
  value?: DiagnosticsRailTab;
  onValueChange?: (value: DiagnosticsRailTab) => void;
  className?: string;
}

/**
 * A2's right-hand rail (design-system.md §5.5 #52): `DiffTraceViewer`
 * (`trace` variant) + (`grounding` variant), collapsing *below* the thread
 * at `--bp-lg` (1080px) since it is context, not content.
 *
 * ## Layout contract with the parent screen
 *
 * This component does not render `ChatThread` — that is a different agent's
 * organism, and composing the two into A2's actual two-column screen is
 * later, screen-level work. What it *can* and does own is its own
 * responsive width, so that a parent laid out as
 * `<div className="flex flex-col lg:flex-row">{thread}<DiagnosticsRail
 * .../></div>` gets the right result at both sizes with no extra work: full
 * width when the parent stacks children in a column (≤1080px), a
 * comfortable fixed-feeling column once the parent switches to a row
 * (≥1080px). Rendering this rail *after* the thread in that JSX is what
 * satisfies "second in DOM order… needs no reorder" — a plain authoring
 * discipline for the caller, not something this component can enforce by
 * itself.
 *
 * Width intentionally avoids Tailwind's numeric `w-*`/`max-w-*` scale
 * altogether: this project's `--spacing-*` bridge only goes up to
 * `--spacing-24` (6rem, `packages/tokens/src/semantic.ts` §4.7), and
 * `max-w-*`'s `--container-*` namespace is one of the confirmed-empty
 * Tailwind v4 bridge gaps from the atoms wave (`tailwind-theme.ts`'s own
 * reset list, verified against a real compiled build in that wave — neither
 * fact re-verified a second time here, both already load-bearing knowledge
 * the token gate itself enforces). A fraction-based `lg:w-2/5` needs neither
 * namespace (Tailwind computes a plain percentage for fraction utilities),
 * capped with a literal `maxInlineSize` the same way `tooltip.tsx`/
 * `dialog.tsx` already use a raw `rem` value for an un-tokenised content
 * width — `rem` is unaffected by the gate's `px|pt|em`-only length pattern.
 *
 * ## Proving the root `DirectionProvider` (Task 1), not assuming it
 *
 * Deliberately built on the *raw* Radix `Tabs` primitive with **no `dir`
 * prop and no `useResolvedDir()`** — unlike `sub-tab-bar.tsx`'s `SubTabBar`,
 * which still needs its own manual resolution (see that file: `Tabs`'s
 * roving-focus group reads direction via `useDirection(dir)`, and
 * `SubTabBar` predates the root provider). This component's whole point,
 * beyond being a reasonable real UI choice for a narrow two-panel rail, is
 * to be the thing in this wave that exercises Radix's own `useDirection()`
 * reading real context with nothing else in the way — `diagnostics-rail.test.tsx`
 * wraps it in a real `<Direction.Provider dir="rtl">` (imported from
 * `radix-ui`, the same package the root layout now uses) and fires a real
 * `ArrowLeft` keydown, asserting the *reversed* tab actually receives focus.
 * That is the proof the provider is actually wired end-to-end, not merely
 * present in the JSX tree. Confirmed by reading `@radix-ui/react-tabs`'s
 * compiled source directly rather than assumed: `Tabs.Root` computes
 * `const direction = useDirection(dir)` once and threads that *exact* value
 * two places — as the real `dir` attribute on its own rendered DOM node, and
 * into `RovingFocusGroup.Root`'s own `dir` prop, which is what the arrow-key
 * handler actually reads. So the rendered `dir` attribute and the
 * behavioural outcome are provably the same variable, not two things that
 * could drift apart — the test asserts both.
 *
 * `loop={false}` on the tablist is a real, independent UX choice for a fixed
 * two-tab strip (wrapping past the last of exactly two tabs back to the
 * first saves no meaningful travel and reads as an accidental double-press
 * more often than a deliberate loop) — and, transparently, it is also what
 * makes a clean behavioural proof possible at all with only two tabs: with
 * the default `loop={true}`, "next" and "previous" from either end of a
 * two-item list both wrap to *the other* item, so no single keypress from an
 * endpoint can distinguish LTR from RTL. Worked through this by hand before
 * writing the test, rather than discovering the ambiguity after a flaky
 * assertion.
 */
export const DiagnosticsRail = React.forwardRef<HTMLElement, DiagnosticsRailProps>(
  function DiagnosticsRail(
    {
      trace,
      grounding,
      traceLabel = "Agent trace",
      groundingLabel = "Sources",
      "aria-label": ariaLabel = "Diagnostics",
      defaultTab = "trace",
      value,
      onValueChange,
      className,
    },
    ref,
  ) {
    return (
      <aside
        ref={ref}
        data-slot="diagnostics-rail"
        className={cn(
          "w-full shrink-0 border-t border-border lg:w-2/5 lg:border-t-0 lg:border-s",
          className,
        )}
        style={{ maxInlineSize: "26rem" }}
      >
        <TabsPrimitive.Root
          // No `dir` prop — see the module doc comment. Radix's own
          // `useDirection()` resolves this from `DirectionContext` alone.
          defaultValue={defaultTab}
          {...(value !== undefined ? { value } : {})}
          {...(onValueChange !== undefined
            ? { onValueChange: (next) => onValueChange(next as DiagnosticsRailTab) }
            : {})}
          activationMode="automatic"
          className="flex h-full flex-col"
        >
          <TabsPrimitive.List
            aria-label={ariaLabel}
            loop={false}
            className="flex items-center border-b border-border"
            style={{ gap: "var(--space-4)", paddingInline: "var(--space-4)" }}
          >
            <TabsPrimitive.Trigger
              value="trace"
              className={cn(
                "border-solid border-transparent text-sm font-medium text-muted-foreground",
                "data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:border-primary",
                "hover:text-foreground",
                FOCUS_VISIBLE_RING,
              )}
              style={{
                paddingBlock: "var(--space-2)",
                borderBlockEndWidth: "var(--subtab-underline-thickness)",
              }}
            >
              {traceLabel}
            </TabsPrimitive.Trigger>
            <TabsPrimitive.Trigger
              value="grounding"
              className={cn(
                "border-solid border-transparent text-sm font-medium text-muted-foreground",
                "data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:border-primary",
                "hover:text-foreground",
                FOCUS_VISIBLE_RING,
              )}
              style={{
                paddingBlock: "var(--space-2)",
                borderBlockEndWidth: "var(--subtab-underline-thickness)",
              }}
            >
              {groundingLabel}
            </TabsPrimitive.Trigger>
          </TabsPrimitive.List>
          <TabsPrimitive.Content
            value="trace"
            className="min-h-0 flex-1 overflow-y-auto"
            style={{ padding: "var(--space-4)" }}
          >
            {trace}
          </TabsPrimitive.Content>
          <TabsPrimitive.Content
            value="grounding"
            className="min-h-0 flex-1 overflow-y-auto"
            style={{ padding: "var(--space-4)" }}
          >
            {grounding}
          </TabsPrimitive.Content>
        </TabsPrimitive.Root>
      </aside>
    );
  },
);
