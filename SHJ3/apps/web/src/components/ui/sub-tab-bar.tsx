"use client";

import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { Badge } from "./badge";
import { useResolvedDir } from "./use-resolved-dir";
import { useUrlSyncedValue } from "./use-url-synced-value";

/** See button.tsx for the full rationale. */
const FOCUS_VISIBLE_RING =
  "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]";

export interface SubTabBarTab {
  value: string;
  label: React.ReactNode;
  /** Trailing count badge, rendered via the real `Badge` atom — `with-counts` variant only. */
  count?: number;
}

export interface SubTabBarProps {
  /**
   * Tabs to render, in order — only the ones the current role may view.
   * design-system.md §5.4's `disabled` state ("a tab whose data the role
   * cannot view") is realised as *hidden*, not a disabled visual, since "RBAC
   * hiding beats disabling here" — so there is deliberately no `disabled`
   * field on a tab; the caller omits it from this array instead.
   */
  tabs: readonly SubTabBarTab[];
  variant?: "primary" | "nested" | "with-counts";
  /** Accessible name for the tablist itself, e.g. "Agent registry sections". */
  "aria-label": string;
  /**
   * Query-string key this bar reads/writes so the active tab is
   * deep-linkable (§5.4, required by Phase F). Give bars that can appear
   * together on one page distinct keys — the `nested` variant inside a
   * wizard step, for instance, should not collide with its page's primary
   * bar. Pass `null` to disable URL sync entirely and run as a plain
   * controlled/uncontrolled Radix Tabs instance via `value`/`onValueChange`.
   */
  urlParam?: string | null;
  /** Fallback when the URL carries nothing for `urlParam` (or sync is off and no `value` is controlled). Defaults to the first tab. */
  defaultValue?: string;
  /** Fully controlled value — providing this takes over completely, see `urlParam`. */
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  /** `SubTabBarPanel` elements, one per tab value — see that component. */
  children?: React.ReactNode;
}

const TEXT_SIZE_BY_VARIANT: Record<NonNullable<SubTabBarProps["variant"]>, string> = {
  // "nested ... smaller type, --text-sm" (§5.4) — stated relative to the
  // other two, which therefore take the larger default tab size.
  primary: "text-base",
  "with-counts": "text-base",
  nested: "text-sm",
};

/**
 * Text tabs with a green underline on the active tab (design-system.md §5.4
 * — the wireframe's own named component, used by 11 of the 14 admin
 * screens). Built on Radix `Tabs`, which supplies `role="tablist"`, roving
 * tabindex, `aria-controls`/`aria-labelledby` pairing and **automatic
 * activation** (its own documented default — not overridden, just stated
 * explicitly below rather than left implicit) unmodified.
 *
 * ## The RTL arrow-key problem
 *
 * §5.4's own RTL note claims "`ArrowRight` moves to the *previous* tab under
 * `dir="rtl"` (Radix handles this, and there is a test asserting it)."
 * Verified against the installed packages rather than trusted (the same
 * discipline `tooltip.tsx` applied to an equivalent claim about `side`, and
 * this batch's brief applied to `Slider`): Radix's roving-focus group —
 * which is what actually reverses arrow-key direction — resolves direction
 * via `@radix-ui/react-direction`'s `useDirection(dir)`, which is exactly
 * `dir || <DirectionProvider context> || "ltr"`. This app renders no
 * `DirectionProvider` anywhere (§11.2), and nothing here passed a `dir` prop
 * either, so absent a fix `Tabs.Root` would silently resolve to `"ltr"`
 * forever regardless of the page's real direction — the claim in §5.4 does
 * **not** hold without this. Fixed by passing the ambient direction through
 * explicitly via `useResolvedDir()` — see that hook for the full mechanism —
 * exactly the pattern `tooltip.tsx` established for its own, differently-shaped
 * version of the same underlying gap. `sub-tab-bar.test.tsx` fires a real
 * `ArrowLeft` keydown under both directions and asserts which tab actually
 * receives focus, not merely that a prop was passed through.
 *
 * ## Deliberately not built
 *
 * The underline's *slide* transition and the ≤560px scroll fade mask (§5.4's
 * anatomy) are pure visual polish with no behavioural or a11y contract and no
 * test surface — deferred the same way `tooltip.tsx` deferred its own
 * enter/exit animation, for the same reason (no token/mechanism this batch's
 * scope requires exists for either yet). The underline itself is real: a
 * `--subtab-underline-thickness` block-end border on the active trigger,
 * which reverses correctly under RTL for free (the tab *order* reverses via
 * normal flex-row layout following `dir`; the underline is just whichever
 * trigger currently carries Radix's own `data-state="active"`, so there is no
 * separate RTL mechanism to get wrong here the way there was for `Switch`'s
 * transform-based thumb).
 */
export const SubTabBar = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Root>,
  SubTabBarProps
>(function SubTabBar(
  {
    tabs,
    variant = "primary",
    "aria-label": ariaLabel,
    urlParam = "tab",
    defaultValue,
    value,
    onValueChange,
    className,
    children,
  },
  ref,
) {
  const dir = useResolvedDir();
  const firstTab = tabs[0];
  const [resolvedValue, setValue] = useUrlSyncedValue({
    param: urlParam,
    value,
    defaultValue: defaultValue ?? firstTab?.value,
    onChange: onValueChange,
  });

  return (
    <TabsPrimitive.Root
      ref={ref}
      dir={dir}
      // Conditional spread, not `value={resolvedValue}` — see checkbox.tsx's
      // identical note: `exactOptionalPropertyTypes` rejects an explicit
      // `undefined` against Radix's own `value?: string`, and
      // `resolvedValue` is `string | undefined` whenever URL sync hasn't
      // resolved a value yet (nothing in the URL, no default, no tabs).
      {...(resolvedValue !== undefined ? { value: resolvedValue } : {})}
      onValueChange={setValue}
      activationMode="automatic"
      className={cn("w-full", className)}
    >
      <TabsPrimitive.List
        aria-label={ariaLabel}
        className="flex items-center overflow-x-auto"
        style={{ gap: "var(--subtab-gap)" }}
      >
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            className={cn(
              "inline-flex shrink-0 items-center whitespace-nowrap border-solid border-transparent font-medium text-muted-foreground",
              "data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:border-primary",
              "hover:bg-accent hover:text-accent-foreground",
              TEXT_SIZE_BY_VARIANT[variant],
              FOCUS_VISIBLE_RING,
            )}
            style={{
              paddingInline: "var(--space-2)",
              paddingBlock: "var(--space-2)",
              gap: "var(--space-1)",
              borderBlockEndWidth: "var(--subtab-underline-thickness)",
            }}
          >
            {tab.label}
            {variant === "with-counts" && tab.count !== undefined ? (
              <Badge variant="neutral" size="sm" label={String(tab.count)} />
            ) : null}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  );
});

/**
 * A `SubTabBar` panel. Thin, unmodified wrapper around `Tabs.Content` —
 * `tabindex`/focus behaviour on activation is Radix's own default, kept
 * as-is rather than guessed at and overridden (the same "adapt what needs
 * it, leave the rest" discipline `tooltip.tsx` applied to trigger wiring).
 */
export const SubTabBarPanel = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function SubTabBarPanel({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn("w-full", className)}
      style={{ paddingBlockStart: "var(--space-4)" }}
      {...props}
    />
  );
});
