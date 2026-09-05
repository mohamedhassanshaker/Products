import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { GlobalIcon, MinusSignIcon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@nextbot/ui/components/ui/button";
import { useWidgetStore } from "../store.js";
import { resolveDirection } from "../direction.js";
import { WelcomeScreen } from "./WelcomeScreen.js";
import { MessageList } from "./messages/MessageList.js";
import { InputArea } from "./InputArea.js";
import { OfflineBanner } from "./OfflineBanner.js";
import { EscalationWaitBanner } from "./EscalationWaitBanner.js";
import { LanguageModal } from "./LanguageModal.js";

/** `id` the launcher's `aria-controls` (see `Launcher.tsx`) points at, and the
 * selector this component's own focus-on-open effect uses to find the message
 * input — kept as one constant so the two stay in sync. */
export const WIDGET_WINDOW_ID = "nextbot-widget-window";

/** A.1.2 — Widget Window (expanded state): header, conversation area, input area,
 * quick-action bar, powered-by footer. `docs/design/UX_GUIDELINES.md` §5.2.2. */
export function WidgetWindow() {
  const { config, screen, messages, aiTyping, isOnline, hidePoweredBy, language, channelTheme, escalationWait, minimizeWindow, openLanguageModal } =
    useWidgetStore();
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasConversation = messages.length > 0;
  const dir = resolveDirection(config?.direction, language);

  function handleEndChatClick() {
    if (hasConversation) {
      setConfirmingEnd(true);
    } else {
      minimizeWindow();
    }
  }

  // D9 (UX_GUIDELINES §5.5): on open, focus moves programmatically to the first
  // interactive element inside the window (the message input) rather than being
  // left wherever the host page's own focus happened to be — this component only
  // mounts while the window is actually open, so a mount-only effect is exactly
  // "on open". Queries by the input's own accessible name rather than threading a
  // ref through `InputArea` (a small, deliberate coupling — `InputArea.tsx`'s
  // `aria-label="Message"` is itself part of this component's public a11y
  // contract, not an incidental implementation detail likely to drift silently).
  useEffect(() => {
    containerRef.current?.querySelector<HTMLInputElement>('input[aria-label="Message"]')?.focus();
  }, []);

  // D9: Escape minimizes the widget back to the launcher, in both desktop and
  // mobile modes (UX_GUIDELINES §5.5's deliberate, uniform "Escape dismisses the
  // floating thing" convention) — handled at the window level via bubble-phase
  // `onKeyDown` so it fires regardless of which child currently has focus.
  function handleWindowKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      minimizeWindow();
    }
  }

  return (
    <div
      ref={containerRef}
      id={WIDGET_WINDOW_ID}
      // Radius "None" per the shared preset — the window's soft Chakra-era
      // `borderRadius="lg"` corners are dropped for consistency with the Admin
      // Console's design-system baseline (the launcher, above, is the one
      // deliberate exception per its own UX-mandated circular shape).
      className="flex h-[560px] max-h-[90vh] w-[380px] max-w-[95vw] flex-col overflow-hidden rounded-none bg-background text-foreground shadow-2xl"
      dir={dir}
      role="complementary"
      aria-label="Chat support"
      onKeyDown={handleWindowKeyDown}
    >
      {/* Axe-core scan finding (this dispatch): a semantic `<header>` element
          carries an implicit "banner" landmark role — nested inside this
          component's own top-level "complementary" landmark, that tripped
          axe's `landmark-banner-is-top-level` rule. This is chrome local to
          the widget window, not the page's actual banner, so a plain `<div>`
          (no implicit landmark) is correct here, not a semantic `<header>`. */}
      <div className="flex items-center justify-between bg-primary px-3 py-2 text-primary-foreground">
        {/* Axe-core scan finding (this dispatch, `page-has-heading-one`): the
            widget had no level-one heading anywhere in its own document.
            `WelcomeScreen`'s "Welcome" text is already an `<h2>` — this
            visually-hidden `<h1>` gives the document a real, accessible-name-
            matching top-level heading without changing the visible title
            styling (`aria-label="Chat support"` on the landmark already
            conveys the same name to assistive tech; this closes the gap for
            tools that specifically require a heading element). */}
        <h1 className="sr-only">Chat support</h1>
        <span className="text-sm font-bold">{config?.theme?.headerTitle ?? channelTheme?.headerTitle ?? "Support"}</span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            aria-label="Choose language"
            variant="ghost"
            size="icon-xs"
            className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            onClick={openLanguageModal}
          >
            <HugeiconsIcon icon={GlobalIcon} size={16} strokeWidth={2} aria-hidden="true" />
          </Button>
          <Button
            type="button"
            aria-label="Minimize chat"
            variant="ghost"
            size="icon-xs"
            className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            onClick={minimizeWindow}
          >
            <HugeiconsIcon icon={MinusSignIcon} size={16} strokeWidth={2} aria-hidden="true" />
          </Button>
          <Button
            type="button"
            aria-label="End conversation"
            variant="ghost"
            size="icon-xs"
            className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            onClick={handleEndChatClick}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={2} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {confirmingEnd && (
        <div className="flex items-center justify-between bg-muted px-3 py-2">
          <span className="text-xs">End this conversation?</span>
          <div className="flex items-center gap-1">
            <Button type="button" size="xs" variant="outline" onClick={() => setConfirmingEnd(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="xs"
              variant="destructive"
              onClick={() => {
                setConfirmingEnd(false);
                minimizeWindow();
              }}
            >
              End
            </Button>
          </div>
        </div>
      )}

      {!isOnline && <OfflineBanner />}
      {escalationWait && <EscalationWaitBanner queueName={escalationWait.queueName} positionEstimate={escalationWait.positionEstimate} />}

      {/* Axe-core scan finding, investigated and NOT fixed the obvious way
          (documented, not silently worked around): a `<main>` landmark was
          tried here to close the "landmark-one-main" finding, but axe then
          flagged `landmark-main-is-top-level` instead ("Main landmark should
          not be contained in another landmark") — worse, since this whole
          document is intentionally a single top-level "complementary"
          landmark per `docs/design/UX_GUIDELINES.md` §5.5 ("one top-level
          landmark wrapping the whole widget"), not a conventional full page
          with its own separate main region. Axe's "every document needs
          exactly one top-level main" heuristic assumes a full page; it
          doesn't cleanly fit a deliberately single-landmark embeddable
          micro-surface. Left as a plain `<div>` (no competing landmark
          semantics) — the moderate "landmark-one-main" finding is a known,
          accepted axe/design-intent mismatch here, not a defect fixed by
          adding a second, nested landmark. Flagged for nexus-qa rather than
          silently suppressed. */}
      <div className="flex min-h-0 flex-1 flex-col">
        {screen === "welcome" ? <WelcomeScreen config={config} /> : <MessageList messages={messages} aiTyping={aiTyping} />}
      </div>

      <InputArea />

      {/* A.1.2: "Powered by NextBot" footer, removable via white-label config
          (FR-ADM-07) — driven by the session bootstrap's `hidePoweredBy` flag, not
          a hardcoded element. */}
      {!hidePoweredBy && (
        // D10 (QA fix pass, carried forward): text-gray-600 clears WCAG AA
        // contrast at this font size on a white background (axe-core
        // "color-contrast" — text-gray-400/500 both failed it).
        <p className="py-1 text-center text-[10px] text-gray-600">Powered by NextBot</p>
      )}

      <LanguageModal />
    </div>
  );
}
