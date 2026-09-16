"use client";

/**
 * A pure, presentational, **no-network** render of the widget's visual shell
 * — for the Widget Studio's own live preview (backoffice side, a parallel
 * agent) and this module's SSR'd `/widget` demo page's first paint. Takes no
 * live data and makes no network calls; it reuses the exact same shared
 * organisms (`AssistantWidgetShell`, which itself composes `ChatThread` +
 * `Composer`) the real, interactive widget consumes, so a change to either
 * shared component's visuals is reflected here automatically — this file
 * never duplicates their markup.
 *
 * Exported at exactly this path because the parallel backoffice/Widget-Studio
 * agent is told to import this precise module and prop shape — see this
 * module's own top-level brief for the contract. Do not rename the file, the
 * default export, or any prop without checking whether that agent's
 * `widget-studio` screen also needs updating.
 */

import * as React from "react";
import { AssistantWidgetShell } from "@/components/patterns/assistant-widget-shell";
import type { ChatTurn } from "@/components/patterns/chat-thread";

export interface WidgetPreviewShellProps {
  /** A resolved CSS color, e.g. `"#1F6F5C"` — a design-token *key* (`WidgetConfig.accentTokenKey`, api.md §7.1) is resolved to a value by the caller before this component ever sees it; this component itself has no theming/token-resolution dependency (design-system.md §9's own "tokens resolve at runtime" rule lives one layer up, not duplicated here). */
  readonly accentColor: string;
  readonly launcherPosition: "BottomRight" | "BottomLeft";
  readonly defaultState: "Docked" | "Expanded";
  readonly disclaimerText: string;
  readonly greetingText: string;
  readonly composerPlaceholder: string;
  readonly suggestionChips: readonly { readonly id: string; readonly label: string }[];
}

/** A fixed, deterministic timestamp — a live preview must never depend on `Date.now()`, which would make two renders of the same props visually differ and would break any snapshot test taken of this component. */
const PREVIEW_TIMESTAMP = new Date("2026-01-01T09:00:00.000Z");

// Return type left to inference rather than spelled as `JSX.Element` — the
// bare global `JSX` namespace does not resolve under this project's current
// `@types/react` (React 19) without `React.JSX.Element`; the *props* shape
// specified for this component is unaffected, only the explicit annotation.
export default function WidgetPreviewShell(props: WidgetPreviewShellProps) {
  const turns: readonly ChatTurn[] = [
    {
      id: "preview-greeting",
      role: "assistant",
      text: props.greetingText,
      timestamp: PREVIEW_TIMESTAMP,
    },
  ];

  return (
    <div
      data-slot="widget-preview-shell"
      // Scopes the accent colour to this preview subtree only — the shared
      // organisms below read `var(--primary)` directly (`assistant-widget-
      // shell.tsx`'s own header icon) or via Tailwind's `bg-primary`/
      // `text-primary` utilities (which this project's token bridge resolves
      // from the same custom property), so overriding it here repaints the
      // preview live with zero network call and zero mutation of the real,
      // globally-resolved theme.
      // `minHeight` via inline `style`, not Tailwind's `min-h-[28rem]` arbitrary-value
      // syntax (the design gate bans that bracket syntax regardless of unit) — same
      // established precedent as `flow-canvas-mobile-sheet.tsx`'s `maxHeight: "85vh"`.
      style={{ "--primary": props.accentColor, minHeight: "28rem" } as React.CSSProperties}
      className="relative isolate h-full w-full"
    >
      <AssistantWidgetShell
        open
        rendering={props.defaultState === "Expanded" ? "expanded" : "docked"}
        disclaimerText={props.disclaimerText}
        // No-op: a preview never actually dismisses anything (there is
        // nothing to persist), but the banner still needs the dismiss
        // control wired so its own affordance previews correctly.
        onDismissDisclaimer={() => {}}
        turns={turns}
        suggestions={props.suggestionChips.map((chip) => chip.label)}
        onSuggestionSelect={() => {}}
        value=""
        onValueChange={() => {}}
        onSend={() => {}}
      />
    </div>
  );
}

// `props.launcherPosition` is accepted (matching the contract every consumer
// of this component's prop shape is told to target) but not yet visually
// reflected: `AssistantWidgetShell` (the shared organism this component
// composes, owned outside this module's scope) always anchors its FAB/panel
// to the inline-end corner with no left/right toggle of its own. Flipping it
// via `dir="rtl"` would be wrong — that mirrors the whole subtree's text and
// layout, not just the launcher's corner. Documented here as a known,
// honest gap for whoever next extends `AssistantWidgetShell` with a real
// `launcherPosition` prop, rather than worked around with a CSS trick that
// would silently corrupt this preview's text direction.
