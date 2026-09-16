"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SelectablePill } from "@/components/ui/selectable-pill";
import { MessageMetaRow, type MessageRating } from "@/components/ui/message-meta-row";
import type {
  AssistantChatTurn,
  ChatBubbleColorOverrides,
  ChatThreadState,
  ChatThreadVariant,
  ChatTurn,
} from "./chat-thread-types";

export type { ChatTurn, ChatThreadState, ChatThreadVariant, ChatBubbleColorOverrides };

function SystemNote({
  turn,
  locale,
}: {
  turn: Extract<ChatTurn, { role: "system" }>;
  // `| undefined` explicitly, not just `?:` — this component forwards its
  // caller's own already-optional `locale` value (icon.tsx's identical note
  // on this exact `exactOptionalPropertyTypes` shape).
  locale?: string | undefined;
}) {
  // The "centred rule" visual (design-system.md §5.5 #48) is this
  // component's own decorative flanking lines; the actual note text and
  // timestamp are the real `MessageMetaRow` `system` variant (its own
  // `role="note"` carries the semantics), not reimplemented here.
  return (
    <div
      data-slot="chat-thread-system-note"
      className="flex items-center justify-center text-2xs text-muted-foreground"
      style={{ gap: "var(--space-2)" }}
    >
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
      <MessageMetaRow
        variant="system"
        note={turn.note}
        timestamp={turn.timestamp}
        {...(locale !== undefined ? { locale } : {})}
      />
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}

interface BubbleTurnProps {
  turn: Extract<ChatTurn, { role: "user" | "assistant" }>;
  // `| undefined` explicitly throughout this block — this component forwards
  // its caller's own already-optional values for each of these (icon.tsx's
  // identical note on this exact `exactOptionalPropertyTypes` shape), rather
  // than owning any of them itself.
  locale?: string | undefined;
  colors?: ChatBubbleColorOverrides | undefined;
  onRatingChange?: ((rating: MessageRating) => void) | undefined;
  onReadAloud?: (() => void) | undefined;
  speaking?: boolean | undefined;
  youSaidLabel: string;
  assistantSaidLabel: string;
  streamingHiddenLabel: string;
  onRetry?: (() => void) | undefined;
  retryLabel: string;
  failedLabel: string;
}

function BubbleTurn({
  turn,
  locale,
  colors,
  onRatingChange,
  onReadAloud,
  speaking = false,
  youSaidLabel,
  assistantSaidLabel,
  streamingHiddenLabel,
  onRetry,
  retryLabel,
  failedLabel,
}: BubbleTurnProps) {
  const isUser = turn.role === "user";
  const assistantTurn = isUser ? undefined : (turn as AssistantChatTurn);
  const isStreaming = assistantTurn?.streaming ?? false;

  const bubbleStyle: React.CSSProperties = colors
    ? {
        backgroundColor: isUser ? colors.userBubble : colors.assistantBubble,
        color: isUser ? colors.userBubbleForeground : colors.assistantBubbleForeground,
      }
    : {
        backgroundColor: isUser ? "var(--chat-user-bubble)" : "var(--chat-assistant-bubble)",
        color: isUser
          ? "var(--chat-user-bubble-foreground)"
          : "var(--chat-assistant-bubble-foreground)",
      };

  return (
    <div
      data-slot="chat-thread-turn"
      data-role={turn.role}
      className={cn("flex flex-col", isUser ? "items-end" : "items-start")}
      style={{ gap: "var(--space-1)" }}
    >
      <div
        dir="auto"
        style={{
          ...bubbleStyle,
          borderRadius: "var(--chat-bubble-radius)",
          // The one squared corner — the bubble's own inline-end + block-end
          // corner for a user turn, inline-start + block-end for assistant
          // (design-system.md §5.5 #48) — expressed as the *logical* corner
          // longhand (§11.1's own table), so it is still the correct physical
          // corner once the page (and therefore the bubble's inline-end/
          // -start) mirrors under RTL, with no conditional logic here at all.
          ...(isUser ? { borderEndEndRadius: 0 } : { borderEndStartRadius: 0 }),
          maxInlineSize: "var(--chat-bubble-max-inline-size)",
          paddingInline: "var(--space-3)",
          paddingBlock: "var(--space-2)",
        }}
        className="text-sm"
      >
        {/* Alignment/tint are visual-only signals (§5.5 #48) — the real
            speaker identity is this visually-hidden prefix. */}
        <span className="sr-only">{isUser ? youSaidLabel : assistantSaidLabel}</span>
        {assistantTurn && isStreaming ? (
          <>
            {/* Streaming discipline — the load-bearing distinction from
                `DiffTraceViewer`'s own streaming rule, stated explicitly so a
                future reader does not "fix" one to match the other: that
                component announces every appended step (just never more than
                the latest one); this one announces *nothing* about an
                in-progress turn until it finalizes. The interim text is
                genuinely in the DOM (a screen reader landing here directly,
                or a sighted user, can still read it) — `aria-live="off"`
                only means the *ancestor* `role="log"`'s polite announcement
                machinery ignores mutations inside this subtree, not that the
                content is hidden. */}
            <span aria-live="off">{assistantTurn.interimText}</span>
            <span role="status" aria-live="polite" className="sr-only">
              {streamingHiddenLabel}
            </span>
          </>
        ) : (
          turn.text
        )}
      </div>
      {/* Two explicit branches, not one call with a computed `variant` —
          `MessageMetaRowProps` is a discriminated union requiring a *literal*
          `variant` to narrow which extra props are even valid, which a
          `isUser ? "user" : "assistant"` value can't satisfy at the type
          level (confirmed by `tsc`, not assumed). */}
      {isUser ? (
        <MessageMetaRow
          variant="user"
          timestamp={turn.timestamp}
          {...(locale !== undefined ? { locale } : {})}
        />
      ) : (
        <MessageMetaRow
          variant="assistant"
          timestamp={turn.timestamp}
          {...(locale !== undefined ? { locale } : {})}
          rating={assistantTurn?.rating ?? null}
          onRatingChange={(rating) => onRatingChange?.(rating)}
          onReadAloud={() => onReadAloud?.()}
          speaking={speaking}
        />
      )}
      {!isUser && assistantTurn?.failed ? (
        <div
          role="alert"
          className="flex items-center text-xs text-destructive-strong"
          style={{ gap: "var(--space-2)" }}
        >
          <span>{failedLabel}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export interface ChatThreadProps {
  turns: readonly ChatTurn[];
  variant?: ChatThreadVariant;
  state?: ChatThreadState;
  errorMessage?: string;
  locale?: string;
  onRatingChange?: (turnId: string, rating: MessageRating) => void;
  onReadAloud?: (turnId: string) => void;
  speakingTurnId?: string;
  onRetryTurn?: (turnId: string) => void;
  /** Rendered beneath the last assistant turn (§5.5 #48's anatomy). */
  suggestions?: readonly string[];
  onSuggestionSelect?: (suggestion: string) => void;
  disclaimerText?: string;
  onDismissDisclaimer?: () => void;
  /** `variant="whatsapp"` only, supplied by `AssistantWidgetShell` — see `ChatBubbleColorOverrides`'s own doc comment. */
  bubbleColorOverrides?: ChatBubbleColorOverrides;
  /** English defaults, overridable once this screen is wired to next-intl. */
  "aria-label"?: string;
  youSaidLabel?: string;
  assistantSaidLabel?: string;
  streamingHiddenLabel?: string;
  retryLabel?: string;
  failedLabel?: string;
  thinkingLabel?: string;
  escalatedLabel?: string;
  emptyLabel?: string;
  dismissDisclaimerLabel?: string;
  suggestionsGroupLabel?: string;
  className?: string;
}

/**
 * The assistant's inline transcript (design-system.md §5.5 #48 — A1, A2, A3,
 * B1 tab 2, B8's ticket transcript).
 *
 * `role="log"` + `aria-live="polite"` + `aria-relevant="additions"`: a new
 * turn is announced without re-reading the transcript. Two behaviours are
 * proven by `chat-thread.test.tsx`, not merely asserted in this comment:
 *
 * 1. **Streaming turns are silent until they finalize** — see `BubbleTurn`'s
 *    own doc comment for the exact mechanism and how it differs from
 *    `DiffTraceViewer`'s streaming rule.
 * 2. **A new turn moves scroll, never focus.** This component calls
 *    `scrollIntoView` on the newest turn when the turn count grows and calls
 *    `.focus()` on nothing, ever — an easy thing to get backwards (a naive
 *    "scroll to and focus the latest message" implementation is a real,
 *    common anti-pattern this test guards against).
 */
export const ChatThread = React.forwardRef<HTMLDivElement, ChatThreadProps>(function ChatThread(
  {
    turns,
    variant = "live",
    state = "idle",
    errorMessage,
    locale,
    onRatingChange,
    onReadAloud,
    speakingTurnId,
    onRetryTurn,
    suggestions,
    onSuggestionSelect,
    disclaimerText,
    onDismissDisclaimer,
    bubbleColorOverrides,
    "aria-label": ariaLabel = "Conversation transcript",
    youSaidLabel = "You said:",
    assistantSaidLabel = "SHJ3 Assistant said:",
    streamingHiddenLabel = "SHJ3 Assistant is typing a response",
    retryLabel = "Retry",
    failedLabel = "This message failed to send.",
    thinkingLabel = "Still thinking…",
    escalatedLabel = "Escalated — a live agent has joined",
    emptyLabel = "Start the conversation by sending a message.",
    dismissDisclaimerLabel = "Dismiss disclaimer",
    suggestionsGroupLabel = "Suggested replies",
    className,
  },
  forwardedRef,
) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const lastTurnRef = React.useRef<HTMLDivElement>(null);
  const previousTurnCount = React.useRef(turns.length);

  React.useImperativeHandle(forwardedRef, () => scrollRef.current as HTMLDivElement);

  React.useEffect(() => {
    if (turns.length > previousTurnCount.current) {
      // Scroll only — see this component's own doc comment. No `.focus()`
      // call exists anywhere in this effect or this file.
      lastTurnRef.current?.scrollIntoView({ block: "end" });
    }
    previousTurnCount.current = turns.length;
  }, [turns.length]);

  const lastAssistantIndex = React.useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i]?.role === "assistant") return i;
    }
    return -1;
  }, [turns]);

  return (
    <div
      ref={scrollRef}
      data-slot="chat-thread"
      data-variant={variant}
      data-state={state}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label={ariaLabel}
      className={cn("flex flex-col overflow-y-auto", className)}
      style={{ gap: "var(--space-3)", padding: "var(--space-3)" }}
    >
      {disclaimerText ? (
        <div
          data-slot="chat-thread-disclaimer"
          className="flex items-start justify-between text-xs"
          style={{
            backgroundColor: "var(--chat-disclaimer)",
            color: "var(--chat-disclaimer-foreground)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-2)",
            gap: "var(--space-2)",
          }}
        >
          <span dir="auto">{disclaimerText}</span>
          <IconButton
            ariaLabel={dismissDisclaimerLabel}
            variant="ghost"
            size="sm"
            onClick={onDismissDisclaimer}
          >
            <Icon icon={X} size={14} />
          </IconButton>
        </div>
      ) : null}

      {turns.length === 0 && state !== "error" ? (
        <p className="text-center text-sm text-muted-foreground">{emptyLabel}</p>
      ) : null}

      {turns.map((turn, index) => {
        const isLast = index === turns.length - 1;
        const content =
          turn.role === "system" ? (
            <SystemNote turn={turn} locale={locale} />
          ) : (
            <BubbleTurn
              turn={turn}
              locale={locale}
              colors={bubbleColorOverrides}
              onRatingChange={
                turn.role === "assistant"
                  ? (rating) => onRatingChange?.(turn.id, rating)
                  : undefined
              }
              onReadAloud={turn.role === "assistant" ? () => onReadAloud?.(turn.id) : undefined}
              speaking={turn.role === "assistant" && speakingTurnId === turn.id}
              youSaidLabel={youSaidLabel}
              assistantSaidLabel={assistantSaidLabel}
              streamingHiddenLabel={streamingHiddenLabel}
              onRetry={turn.role === "assistant" ? () => onRetryTurn?.(turn.id) : undefined}
              retryLabel={retryLabel}
              failedLabel={failedLabel}
            />
          );

        return (
          <div key={turn.id} ref={isLast ? lastTurnRef : undefined}>
            {content}
            {index === lastAssistantIndex && suggestions && suggestions.length > 0 ? (
              <div
                className="mt-2 flex flex-wrap"
                style={{ gap: "var(--space-2)" }}
                role="group"
                aria-label={suggestionsGroupLabel}
              >
                {suggestions.map((suggestion) => (
                  <SelectablePill
                    key={suggestion}
                    variant="single"
                    name="chat-thread-suggestion"
                    value={suggestion}
                    checked={false}
                    onCheckedChange={() => onSuggestionSelect?.(suggestion)}
                  >
                    {suggestion}
                  </SelectablePill>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      {state === "thinking" ? (
        <div
          className="flex items-center text-xs text-chat-typing"
          style={{ gap: "var(--space-2)" }}
        >
          <Spinner size="xs" />
          <span>{thinkingLabel}</span>
        </div>
      ) : null}
      {state === "escalated" ? (
        <div
          role="status"
          className="text-center text-xs text-success-strong"
          style={{
            backgroundColor: "var(--success-subtle)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-2)",
          }}
        >
          {escalatedLabel}
        </div>
      ) : null}
      {state === "error" ? (
        <div role="alert" className="text-center text-xs text-destructive-strong">
          {errorMessage ?? "Something went wrong."}
        </div>
      ) : null}
    </div>
  );
});
