"use client";

import * as React from "react";
import { Minus, Sparkles, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { ChatThread, type ChatThreadProps } from "@/components/patterns/chat-thread/chat-thread";
import { Composer, type ComposerProps } from "@/components/patterns/composer/composer";
import { WHATSAPP_CHROME_COLORS } from "./assistant-widget-shell-whatsapp-tokens";

export type AssistantWidgetRendering = "docked" | "expanded" | "whatsapp";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

/** ≤560px viewport — §4.9's own named `sm` breakpoint. */
const FULLSCREEN_BREAKPOINT_PX = 560;

/**
 * SSR-safe viewport check for the `fullscreen` rendering (design-system.md
 * §5.5 #50: *"≤560px viewport | Docked goes full-bleed."*), the same
 * isomorphic shape `use-resolved-dir.ts` and `flow-canvas`'s sibling
 * `use-is-below-breakpoint.ts` both already establish — kept as a small local
 * copy in this file rather than importing across organism directories (this
 * wave's own convention: each organism stays self-contained; the shared
 * surface is the documented *pattern*, not a new cross-organism dependency).
 *
 * **Why this can't be a `max-sm:` Tailwind class alone.** The docked/expanded
 * width is set via inline `style` (it has to be — see `DOCKED_MIN_INLINE_SIZE`'s
 * own doc comment on why these two literals are not Tailwind classes at all),
 * and an inline `style` always wins over every class, including a `max-sm:`
 * one, regardless of specificity tricks. So the fullscreen override has to
 * happen in the same place the width is *decided*, in JS, not just in the
 * class list.
 */
function useIsFullscreenViewport(): boolean {
  const [isFullscreen, setIsFullscreen] = React.useState(false);

  useIsomorphicLayoutEffect(() => {
    const query = window.matchMedia(`(max-width: ${FULLSCREEN_BREAKPOINT_PX - 1}px)`);
    const update = () => setIsFullscreen(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return isFullscreen;
}

/**
 * Structural geometric constants, not design tokens — see this file's own
 * module doc comment below for why. `rem`, not `px`: consistent with every
 * other genuinely-geometric, non-derived value already in this system
 * (`packages/tokens/src/components.ts`'s own `sidebarWidth: "16rem"`), and,
 * mechanically, outside `no-hardcoded-design-values.mjs`'s px/pt/em literal
 * ban (that gate's `raw-length-literal` rule matches only those three units).
 */
const DOCKED_MIN_INLINE_SIZE = "25rem"; // 400 CSS px at the standard 16 px root (design-system.md §5.5 #50)
const EXPANDED_MIN_INLINE_SIZE = "35rem"; // 560 CSS px at the standard 16 px root

export type AssistantWidgetShellProps = {
  rendering?: AssistantWidgetRendering;
  defaultRendering?: AssistantWidgetRendering;
  onRenderingChange?: (rendering: AssistantWidgetRendering) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** `offline`/`degraded` are independent of `rendering`/`open` (design-system.md §5.5 #50's own state list) — an in-flight thread stays usable either way, so this never gates rendering the thread itself. */
  offline?: boolean;
  degraded?: boolean;
  offlineMessage?: string;
  degradedMessage?: string;
  disclaimerText?: string;
  onDismissDisclaimer?: () => void;
  titleText?: string;
  locale?: string;
  minimiseLabel?: string;
  expandLabel?: string;
  closeLabel?: string;
  fabOpenLabel?: string;
  fabCloseLabel?: string;
  className?: string;
} & Pick<
  ChatThreadProps,
  | "turns"
  | "state"
  | "errorMessage"
  | "onRatingChange"
  | "onReadAloud"
  | "speakingTurnId"
  | "onRetryTurn"
  | "suggestions"
  | "onSuggestionSelect"
> &
  Pick<ComposerProps, "value" | "onValueChange" | "onSend" | "status" | "onMicToggle" | "onAttach">;

/**
 * A1's three renderings, one shell (design-system.md §5.5 #50: *"One
 * assistant renders correctly across surfaces."*). Docked (400px), Expanded
 * (560px), WhatsApp (full frame, structurally different — a business header,
 * opt-in notice, session marker, fixed non-themable colours).
 *
 * **The docked↔expanded transition never remounts.** `ChatThread` and
 * `Composer` are each written at exactly one, unconditional JSX call site in
 * this file's return — `rendering` only ever changes *which classes/styles*
 * that one call site's ancestor carries (`DOCKED_MIN_INLINE_SIZE` vs
 * `EXPANDED_MIN_INLINE_SIZE`), never which element *type* wraps it or
 * whether it is conditionally re-created. `assistant-widget-shell.test.tsx`
 * proves this directly — same DOM node identity, and a typed-but-unsent
 * composer draft survives the switch — rather than trusting the structure
 * alone.
 *
 * **Why this does not use real CSS `@container` queries despite setting
 * `container-type: inline-size`.** All three renderings are *driven* by the
 * `rendering` prop (a caller decision — the demo harness's `ToggleRow`, or
 * B10 tab 2's `defaultState` — never ambient available space this shell must
 * detect for itself), and `fullscreen` is a real *viewport* media condition
 * (`useIsFullscreenViewport`, ≤560px — a container condition would be the
 * wrong tool for it regardless, since this axis is about the browser
 * viewport, not this element's own resolved inline size). So nothing in this
 * component actually needs to *query* its own resolved size — every visual
 * difference between renderings is already known from a plain prop, which
 * `cva`/`cn()`-style conditional classes express exactly as well as a
 * container query would, with no new, unprecedented CSS-authoring pattern
 * introduced into a codebase that has used none so far. `container-type`/
 * `container-name` are still set, both because the anatomy explicitly names
 * this "a container query root" and because it costs nothing to leave the
 * door open for a future child that legitimately does need to query
 * available space.
 */
export const AssistantWidgetShell = React.forwardRef<HTMLDivElement, AssistantWidgetShellProps>(
  function AssistantWidgetShell(
    {
      rendering: controlledRendering,
      defaultRendering = "docked",
      onRenderingChange,
      open: controlledOpen,
      defaultOpen = false,
      onOpenChange,
      offline = false,
      degraded = false,
      offlineMessage = "Some services are slow right now — replies may take longer than usual.",
      degradedMessage = "Some services are slow right now — replies may take longer than usual.",
      disclaimerText,
      onDismissDisclaimer,
      titleText = "SHJ3 Assistant",
      locale,
      minimiseLabel = "Minimise",
      expandLabel = "Expand",
      closeLabel = "Close",
      fabOpenLabel = "Open SHJ3 Assistant",
      fabCloseLabel = "Close SHJ3 Assistant",
      className,
      // ChatThread passthrough
      turns,
      state,
      errorMessage,
      onRatingChange,
      onReadAloud,
      speakingTurnId,
      onRetryTurn,
      suggestions,
      onSuggestionSelect,
      // Composer passthrough
      value,
      onValueChange,
      onSend,
      status,
      onMicToggle,
      onAttach,
    },
    ref,
  ) {
    const [internalRendering, setInternalRendering] = React.useState(defaultRendering);
    const rendering = controlledRendering ?? internalRendering;
    const isWhatsapp = rendering === "whatsapp";
    const isFullscreen = useIsFullscreenViewport();

    const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
    const open = controlledOpen ?? internalOpen;

    const headingRef = React.useRef<HTMLHeadingElement>(null);
    const fabRef = React.useRef<HTMLButtonElement>(null);
    const wasOpenRef = React.useRef(open);

    const setOpen = React.useCallback(
      (next: boolean) => {
        setInternalOpen(next);
        onOpenChange?.(next);
      },
      [onOpenChange],
    );

    const setRendering = React.useCallback(
      (next: AssistantWidgetRendering) => {
        setInternalRendering(next);
        onRenderingChange?.(next);
      },
      [onRenderingChange],
    );

    // Opening moves focus to the shell's heading; closing returns it to the
    // FAB (§5.5 #50's own explicit rule) — driven by the *transition*, not
    // fired again on every unrelated re-render while already open/closed.
    React.useEffect(() => {
      if (open && !wasOpenRef.current) {
        headingRef.current?.focus();
      } else if (!open && wasOpenRef.current) {
        fabRef.current?.focus();
      }
      wasOpenRef.current = open;
    }, [open]);

    const handleShellKeyDown = (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };

    return (
      <div ref={ref} data-slot="assistant-widget-shell-root" className={className}>
        {open ? (
          // `Escape` minimises (§5.5 #50) — event *delegation* from whichever
          // focusable descendant currently holds focus, the same justified
          // pattern (and precedent) `graph-canvas.tsx`'s `DetailPanel` and
          // `node-inspector.tsx` already establish in this wave, not fake
          // interactivity on the dialog region itself.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
          <div
            data-slot="assistant-widget-shell"
            data-rendering={rendering}
            role="dialog"
            aria-modal="false"
            aria-label={titleText}
            onKeyDown={handleShellKeyDown}
            style={{
              containerType: "inline-size",
              containerName: "assistant-widget-shell",
              // Whatsapp is a structural "full frame" rendering (§5.5 #50) —
              // it fills whatever frame hosts it rather than taking one of
              // the two fixed chat-panel widths. `isFullscreen` (a real
              // viewport check, not the `rendering` prop) also collapses to
              // full width — deliberately decided *here*, alongside the
              // width itself, rather than left to a `max-sm:` class: this is
              // an inline `style`, which always outranks any class including
              // a responsive one, so the fullscreen override has to live in
              // the same place the width is computed (see
              // `useIsFullscreenViewport`'s own doc comment).
              inlineSize: isWhatsapp || isFullscreen ? "100%" : undefined,
              minInlineSize:
                isWhatsapp || isFullscreen
                  ? undefined
                  : rendering === "expanded"
                    ? EXPANDED_MIN_INLINE_SIZE
                    : DOCKED_MIN_INLINE_SIZE,
              backgroundColor: isWhatsapp
                ? WHATSAPP_CHROME_COLORS.wallpaperBackground
                : "var(--card)",
              boxShadow: rendering === "expanded" ? "var(--shadow-xl)" : "var(--shadow-lg)",
              borderRadius: isFullscreen
                ? "0"
                : rendering === "expanded"
                  ? "var(--radius-2xl)"
                  : "var(--radius-xl)",
              zIndex: "var(--z-modal)",
            }}
            className={cn(
              "fixed flex flex-col overflow-hidden",
              isFullscreen ? "inset-0" : "end-4 bottom-4",
            )}
          >
            <header
              className="flex shrink-0 items-center justify-between"
              style={{
                backgroundColor: isWhatsapp ? WHATSAPP_CHROME_COLORS.headerBackground : undefined,
                color: isWhatsapp ? WHATSAPP_CHROME_COLORS.headerForeground : undefined,
                padding: "var(--space-3)",
              }}
            >
              <div className="flex items-center" style={{ gap: "var(--space-2)" }}>
                {isWhatsapp ? null : (
                  <Icon icon={Sparkles} size={16} style={{ color: "var(--primary)" }} />
                )}
                <h2
                  ref={headingRef}
                  tabIndex={-1}
                  className={cn(
                    "font-semibold outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]",
                    rendering === "expanded" ? "text-lg" : "text-sm",
                  )}
                >
                  {titleText}
                </h2>
              </div>
              <div className="flex items-center" style={{ gap: "var(--space-1)" }}>
                {!isWhatsapp ? (
                  <IconButton
                    ariaLabel={rendering === "expanded" ? minimiseLabel : expandLabel}
                    variant="ghost"
                    size="sm"
                    onClick={() => setRendering(rendering === "expanded" ? "docked" : "expanded")}
                  >
                    <Icon icon={rendering === "expanded" ? Minus : Square} size={14} />
                  </IconButton>
                ) : null}
                <IconButton
                  ariaLabel={closeLabel}
                  variant="ghost"
                  size="sm"
                  onClick={() => setOpen(false)}
                >
                  <Icon icon={X} size={14} />
                </IconButton>
              </div>
            </header>

            {isWhatsapp ? (
              <div
                data-slot="assistant-widget-shell-whatsapp-notice"
                className="shrink-0 text-center text-2xs"
                style={{
                  backgroundColor: WHATSAPP_CHROME_COLORS.wallpaperBackground,
                  color: "var(--muted-foreground)",
                  padding: "var(--space-2)",
                }}
              >
                24-hour session window open
              </div>
            ) : null}

            {disclaimerText ? (
              <div
                data-slot="assistant-widget-shell-disclaimer"
                className="flex shrink-0 items-start justify-between text-xs"
                style={{
                  backgroundColor: isWhatsapp
                    ? WHATSAPP_CHROME_COLORS.wallpaperBackground
                    : "var(--chat-disclaimer)",
                  color: isWhatsapp
                    ? "var(--muted-foreground)"
                    : "var(--chat-disclaimer-foreground)",
                  padding: "var(--space-2)",
                  gap: "var(--space-2)",
                }}
              >
                <span dir="auto">{disclaimerText}</span>
                <IconButton
                  ariaLabel="Dismiss disclaimer"
                  variant="ghost"
                  size="sm"
                  onClick={onDismissDisclaimer}
                >
                  <Icon icon={X} size={14} />
                </IconButton>
              </div>
            ) : null}

            {offline || degraded ? (
              <div
                role="status"
                className="shrink-0 text-center text-xs text-warning-strong"
                style={{ backgroundColor: "var(--warning-subtle)", padding: "var(--space-2)" }}
              >
                {offline ? offlineMessage : degradedMessage}
              </div>
            ) : null}

            {/* Exactly one, unconditional call site — see this component's
                own doc comment on why that is what makes the docked↔expanded
                transition remount-safe. */}
            <ChatThread
              className="min-h-0 flex-1"
              turns={turns}
              variant={isWhatsapp ? "whatsapp" : "live"}
              {...(state !== undefined ? { state } : {})}
              {...(errorMessage !== undefined ? { errorMessage } : {})}
              {...(locale !== undefined ? { locale } : {})}
              {...(onRatingChange !== undefined ? { onRatingChange } : {})}
              {...(onReadAloud !== undefined ? { onReadAloud } : {})}
              {...(speakingTurnId !== undefined ? { speakingTurnId } : {})}
              {...(onRetryTurn !== undefined ? { onRetryTurn } : {})}
              {...(suggestions !== undefined ? { suggestions } : {})}
              {...(onSuggestionSelect !== undefined ? { onSuggestionSelect } : {})}
              {...(isWhatsapp
                ? {
                    bubbleColorOverrides: {
                      userBubble: WHATSAPP_CHROME_COLORS.outgoingBubble,
                      userBubbleForeground: WHATSAPP_CHROME_COLORS.outgoingBubbleForeground,
                      assistantBubble: WHATSAPP_CHROME_COLORS.incomingBubble,
                      assistantBubbleForeground: WHATSAPP_CHROME_COLORS.incomingBubbleForeground,
                    },
                  }
                : {})}
            />
            <div className="shrink-0" style={{ padding: "var(--space-2)" }}>
              <Composer
                variant={isWhatsapp ? "whatsapp" : "web"}
                value={value}
                onValueChange={onValueChange}
                onSend={onSend}
                {...(status !== undefined ? { status } : {})}
                {...(onMicToggle !== undefined ? { onMicToggle } : {})}
                {...(onAttach !== undefined ? { onAttach } : {})}
              />
            </div>
          </div>
        ) : null}

        {/* The FAB sits outside the panel proper (§5.5 #50's own anatomy) —
            always rendered, toggled visually rather than unmounted, so focus
            return on close always has a real target. */}
        <IconButton
          ref={fabRef}
          ariaLabel={open ? fabCloseLabel : fabOpenLabel}
          aria-expanded={open}
          variant="primary"
          size="md"
          onClick={() => setOpen(!open)}
          // Hidden while open *and* fullscreen — "the FAB is replaced by a
          // close button in the header" (§5.5 #50) — driven by the same
          // JS `isFullscreen` check the panel's own sizing uses, not a
          // `max-sm:` class, so both stay in agreement about what counts as
          // fullscreen (and so this is exercised the same way in tests,
          // which mock `matchMedia` rather than resizing a real viewport).
          className={cn("fixed rounded-full shadow-lg", open && isFullscreen && "hidden")}
          style={{
            insetInlineEnd: "var(--space-4)",
            insetBlockEnd: "var(--space-4)",
            zIndex: "var(--z-modal)",
            width: "var(--control-height-lg)",
            height: "var(--control-height-lg)",
          }}
        >
          <Icon icon={open ? X : Sparkles} size={20} />
        </IconButton>
      </div>
    );
  },
);
