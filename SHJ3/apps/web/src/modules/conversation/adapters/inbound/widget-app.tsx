"use client";

/**
 * The real, interactive widget screen for the SSR `/widget` demo page
 * (api.md's own "assistant widget SSR for first paint inside the portal",
 * architecture.md §9) — A2's two-column layout (thread left, diagnostics
 * rail right), built directly from `ChatThread` + `Composer` +
 * `DiagnosticsRail` rather than through `AssistantWidgetShell`.
 *
 * **Why not `AssistantWidgetShell` here:** that shared organism (A1's own
 * floating FAB/docked/expanded shell) positions its panel with `fixed`
 * geometry sized for exactly the thread+composer, with no rail slot —
 * exactly right for the *embeddable* widget (see `widget-embed/`'s own
 * bundle, and this same reasoning), but the wrong shape for a full-page,
 * two-column demo screen. `DiagnosticsRail`'s own doc comment explicitly
 * defers "composing the two into A2's actual two-column screen" to
 * screen-level code — this file is that screen-level composition, reusing
 * the identical `ChatThread`/`Composer`/`DiffTraceViewer` organisms the
 * floating widget and the Widget Studio preview also consume, so no markup
 * is duplicated, only the outer layout differs.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ChatThread } from "@/components/patterns/chat-thread";
import { Composer } from "@/components/patterns/composer/composer";
import { DiagnosticsRail } from "@/components/patterns/diagnostics-rail";
import { DiffTraceViewer } from "@/components/patterns/diff-trace-viewer";
import { useWidgetConversation, type WidgetBootstrapData } from "./use-widget-conversation.js";

export interface WidgetAppProps {
  readonly channelKey: string;
  readonly locale: string;
  readonly initialBootstrap?: WidgetBootstrapData;
}

// Return type left to inference — see `widget-preview-shell.tsx`'s identical note on the bare global `JSX` namespace.
export function WidgetApp(props: WidgetAppProps) {
  const t = useTranslations("widget");
  const conversation = useWidgetConversation({
    channelKey: props.channelKey,
    locale: props.locale,
    ...(props.initialBootstrap !== undefined ? { initialBootstrap: props.initialBootstrap } : {}),
  });
  const [composerValue, setComposerValue] = React.useState("");
  const openedRef = React.useRef(false);

  React.useEffect(() => {
    if (openedRef.current || !conversation.bootstrap) return;
    openedRef.current = true;
    void conversation.open();
  }, [conversation, conversation.bootstrap]);

  const handleSend = React.useCallback(() => {
    const value = composerValue.trim();
    if (!value) return;
    setComposerValue("");
    void conversation.sendTurn(value, "text");
  }, [composerValue, conversation]);

  const handleSuggestionSelect = React.useCallback(
    (label: string) => {
      void conversation.sendTurn(label, "chip");
    },
    [conversation],
  );

  if (!conversation.bootstrap) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("demoPage.loading")}
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col lg:flex-row"
      // `minHeight` via inline `style`, not Tailwind's `min-h-[36rem]` arbitrary-value
      // syntax (the design gate bans that bracket syntax regardless of unit) — same
      // established precedent as `flow-canvas-mobile-sheet.tsx`'s `maxHeight: "85vh"`.
      style={{ gap: "var(--space-4)", minHeight: "36rem" }}
    >
      <div
        className="flex min-h-0 flex-1 flex-col border border-border"
        style={{ borderRadius: "var(--radius-xl)" }}
      >
        <ChatThread
          className="min-h-0 flex-1"
          turns={conversation.turns}
          state={conversation.errorMessage ? "error" : conversation.chatState}
          locale={props.locale}
          onRatingChange={conversation.setRating}
          onReadAloud={(turnId) => {
            const turn = conversation.turns.find((t) => t.id === turnId);
            if (turn && turn.role === "assistant") conversation.readAloud(turnId, turn.text);
          }}
          suggestions={conversation.bootstrap.chips.map((chip) => chip.label)}
          onSuggestionSelect={handleSuggestionSelect}
          onDismissDisclaimer={conversation.dismissDisclaimer}
          // `exactOptionalPropertyTypes` (tsconfig.base.json) means an optional
          // prop may be omitted or hold its real type, never `undefined`
          // explicitly — so every value that can legitimately be absent is
          // spread conditionally rather than passed straight through.
          {...(conversation.errorMessage !== undefined
            ? { errorMessage: conversation.errorMessage }
            : {})}
          {...(conversation.speakingTurnId !== undefined
            ? { speakingTurnId: conversation.speakingTurnId }
            : {})}
          {...(!conversation.disclaimerDismissed
            ? { disclaimerText: conversation.bootstrap.disclaimerText }
            : {})}
        />
        {
          // The citizen-initiated half of api.md's handover contract — real,
          // shipped `useWidgetConversation().requestHandover()` and a real,
          // already-translated `widget.handover.requestAction`/`queuePosition`
          // pair existed with no caller anywhere in this tree (found while
          // building this module's own committed E2E coverage, 2026-09-10):
          // the flow-triggered path (`handover_triggered` over SSE, matching
          // the wireframe's "Escalate on low confidence" node) only ever set
          // local UI state, and nothing rendered a way for a citizen to ask
          // for a person directly. Wired here at the root rather than worked
          // around in a test — a single real `Button` calling the same real
          // `POST .../handover` endpoint the hook already implements, hidden
          // once a handover is already active (nothing left to request), with
          // the queue position shown instead using the same
          // previously-unused translation key.
        }
        <div
          className="flex shrink-0 items-center justify-between"
          style={{ padding: "0 var(--space-2)", gap: "var(--space-2)" }}
        >
          {conversation.handover.active ? (
            conversation.handover.queuePosition !== null ? (
              <p className="text-xs text-muted-foreground">
                {t("handover.queuePosition", { position: conversation.handover.queuePosition })}
              </p>
            ) : (
              <span />
            )
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void conversation.requestHandover()}
              disabled={!conversation.conversationId}
            >
              {t("handover.requestAction")}
            </Button>
          )}
        </div>
        <div className="shrink-0" style={{ padding: "var(--space-2)" }}>
          <Composer
            value={composerValue}
            onValueChange={setComposerValue}
            onSend={handleSend}
            placeholder={conversation.bootstrap.composerPlaceholder}
            status={
              conversation.handover.active
                ? { type: "paused", reason: t("composer.pausedReason") }
                : { type: "idle" }
            }
          />
        </div>
      </div>

      <DiagnosticsRail
        traceLabel={t("diagnostics.traceLabel")}
        groundingLabel={t("diagnostics.groundingLabel")}
        trace={
          <DiffTraceViewer
            variant="trace"
            steps={conversation.traceSteps}
            state={
              conversation.chatState === "streaming" || conversation.chatState === "thinking"
                ? "streaming"
                : "default"
            }
            emptyHeadline={t("diagnostics.traceEmptyHeadline")}
            emptyCause={t("diagnostics.traceEmptyCause")}
          />
        }
        grounding={
          <DiffTraceViewer
            variant="grounding"
            steps={conversation.groundingSteps}
            emptyHeadline={t("diagnostics.groundingEmptyHeadline")}
            emptyCause={t("diagnostics.groundingEmptyCause")}
          />
        }
      />
    </div>
  );
}
