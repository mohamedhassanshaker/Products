import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { BubbleChatIcon } from "@hugeicons/core-free-icons";
import { Button } from "@nextbot/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nextbot/ui/components/ui/tooltip";
import { useWidgetStore } from "../store.js";
import { WIDGET_WINDOW_ID } from "./WidgetWindow.js";

/** A.1.1 — Launcher Button (collapsed state). Renders even when `initError` is set
 * to "inactive" (disabled state, FR-OC-01) — a genuinely missing `tenantId`/
 * `channelId` never reaches this component at all (WidgetApp.tsx mounts nothing in
 * that case, per the loader's own fail-closed check). */
export function Launcher() {
  const { openWindow, unreadCount, initError, bootstrapping } = useWidgetStore();
  const [pulse, setPulse] = useState(true);
  const disabled = initError !== null;

  useEffect(() => {
    // One-time pulse, never looping (docs/design/UX_GUIDELINES.md §5.2.1).
    const t = setTimeout(() => setPulse(false), 1200);
    return () => clearTimeout(t);
  }, []);

  const prefersReducedMotion =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const label = disabled
    ? "Chat is temporarily unavailable."
    : unreadCount > 0
      ? `Open chat, ${unreadCount} unread message${unreadCount === 1 ? "" : "s"}`
      : "Chat with us";

  return (
    <div className="fixed bottom-0 end-0 p-2">
      <Tooltip>
        {/* Same "wrap the (possibly-disabled) control in a focusable span"
            pattern `LoginForm.tsx`'s SSO tooltip established (a disabled native
            `<button>` doesn't reliably fire hover/focus events for Base UI's
            Tooltip) — applied here unconditionally since the disabled-state
            tooltip copy ("Chat is temporarily unavailable.") is exactly the case
            that must still be reachable by keyboard/screen-reader users. */}
        <TooltipTrigger
          render={
            <span tabIndex={0} className="inline-block">
              <Button
                type="button"
                aria-label={label}
                // D9 (UX_GUIDELINES §5.5): standard disclosure-button semantics —
                // this button, rendered only in the collapsed state, is always
                // `aria-expanded="false"` when present; `aria-controls` makes the
                // trigger/content relationship programmatically explicit even
                // though the window it controls isn't in the DOM at the same time
                // as this button.
                aria-expanded={false}
                aria-controls={WIDGET_WINDOW_ID}
                onClick={disabled ? undefined : openWindow}
                disabled={disabled || bootstrapping}
                aria-disabled={disabled || bootstrapping}
                // Radius "None" is this preset's design-system default (see
                // `globals.css`'s token-contract comment), but `docs/design/
                // UX_GUIDELINES.md` §5.2.1 explicitly specifies a "circular/pill
                // floating action button" for the launcher — a firm UX
                // requirement that overrides the generic chrome-radius
                // preference for this one element.
                className={
                  "h-[60px] w-[60px] rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90" +
                  (pulse && !disabled && !prefersReducedMotion ? " animate-nextbot-pulse" : "")
                }
              >
                <HugeiconsIcon icon={BubbleChatIcon} size={28} strokeWidth={2} />
              </Button>
            </span>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      {unreadCount > 0 && (
        <div
          className="absolute top-0 end-0 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive text-xs text-white"
          aria-hidden="true"
        >
          {unreadCount}
        </div>
      )}
    </div>
  );
}
