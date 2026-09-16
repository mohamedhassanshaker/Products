"use client";

/**
 * The real, interactive "brain" behind the widget — a client hook driving
 * the whole citizen-facing turn lifecycle against the real `/api/public/v1/*`
 * routes this module built. Consumed by `widget-app.tsx` (the SSR `/widget`
 * demo page's client half). The standalone embeddable bundle
 * (`apps/web/src/widget-embed/`) does **not** import this file — it is a
 * dependency-light, no-React bundle by design (see its own module comment)
 * and re-implements an equivalent, smaller state machine directly in plain
 * DOM/TS; this hook is the React-consuming counterpart for the SSR page and,
 * potentially, a future in-portal React mount point.
 *
 * ## Honest scope notes
 *
 *  - The diagnostics rail's trace/grounding data is built **only from the
 *    live SSE events of the turn currently streaming** (`route`,
 *    `tool_call_started`/`_finished`, `guardrail`, `retrieval`, `trace_update`).
 *    The real `shj3-ai` pipeline's own `_sse_events` (`conversation_router.py`)
 *    emits a *minimal* `done` payload (`{turnId, status}`), not api.md §5.2's
 *    illustrative full envelope — confirmed by reading the real, shipped
 *    implementation rather than trusting the doc's worked example (this
 *    project's own recorded discipline). So the rail reflects exactly what
 *    the real stream actually carries, live, per turn; it does not persist
 *    across a full page reload (that would need a trace-read endpoint this
 *    module did not build — named here rather than silently degraded).
 *  - TTS uses the browser's own `SpeechSynthesis`; mic uses the browser's own
 *    `SpeechRecognition` (`webkitSpeechRecognition` where that's the only
 *    exposed global) — both are this wave's documented, real stand-ins for
 *    the not-yet-built backend speech endpoints (see this module's own
 *    top-level brief).
 */

import * as React from "react";
import type { MessageRating } from "@/components/ui/message-meta-row";
import type { ChatThreadState, ChatTurn } from "@/components/patterns/chat-thread";
import type { TraceStep } from "@/components/patterns/diff-trace-viewer/diff-trace-viewer-types";
import { SseFrameParser } from "../../domain/sse-frame-parser.js";

export interface WidgetBootstrapData {
  readonly greetingText: string;
  readonly disclaimerText: string;
  readonly showDisclaimerDismiss: boolean;
  readonly composerPlaceholder: string;
  readonly chips: readonly { readonly id: string; readonly label: string }[];
}

interface HandoverState {
  readonly active: boolean;
  readonly queuePosition: number | null;
}

export interface UseWidgetConversationInput {
  readonly channelKey: string;
  readonly locale: string;
  /** Server-resolved first paint (the SSR page's own job) — skips one client round trip when present. */
  readonly initialBootstrap?: WidgetBootstrapData;
}

function newClientTurnId(): string {
  return `ct_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** Minimal fetch wrapper that throws a display-safe message on a non-2xx problem+json response — never surfaces raw response text, matching api.md §2.2's own "never leak vendor/internal detail" rule extended to this client. */
async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { ...init, credentials: "include" });
  if (!response.ok) {
    let detail = `Request failed (${response.status}).`;
    try {
      const problem = (await response.json()) as { detail?: string; code?: string };
      detail = problem.detail ?? problem.code ?? detail;
    } catch {
      // ignore — non-JSON error body
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export function useWidgetConversation(input: UseWidgetConversationInput) {
  const [bootstrap, setBootstrap] = React.useState<WidgetBootstrapData | null>(
    input.initialBootstrap ?? null,
  );
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [turns, setTurns] = React.useState<ChatTurn[]>([]);
  const [chatState, setChatState] = React.useState<ChatThreadState>("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | undefined>(undefined);
  const [disclaimerDismissed, setDisclaimerDismissed] = React.useState(false);
  const [traceSteps, setTraceSteps] = React.useState<readonly TraceStep[]>([]);
  const [groundingSteps, setGroundingSteps] = React.useState<readonly TraceStep[]>([]);
  const [handover, setHandover] = React.useState<HandoverState>({
    active: false,
    queuePosition: null,
  });
  const [speakingTurnId, setSpeakingTurnId] = React.useState<string | undefined>(undefined);

  // Bootstrap (skip if the SSR page already resolved it).
  React.useEffect(() => {
    if (bootstrap) return;
    let cancelled = false;
    fetchJson<WidgetBootstrapData>(
      `/api/public/v1/widget/bootstrap?channelKey=${encodeURIComponent(input.channelKey)}&locale=${input.locale}`,
    )
      .then((data) => {
        if (!cancelled) setBootstrap(data);
      })
      .catch((error: Error) => {
        if (!cancelled) setErrorMessage(error.message);
      });
    return () => {
      cancelled = true;
    };
    // Deliberately `[]`: `input.channelKey`/`input.locale` are fixed for this
    // hook's whole lifetime (the caller never remounts it with different
    // values), so this effect intentionally runs once on mount only.
  }, []);

  const open = React.useCallback(async () => {
    try {
      const result = await fetchJson<{
        conversationId: string;
        greeting: { content: string; disclaimerText: string };
        chips: readonly { id: string; label: string }[];
      }>("/api/public/v1/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelKey: input.channelKey, locale: input.locale }),
      });
      setConversationId(result.conversationId);
      setTurns([
        { id: "greeting", role: "assistant", text: result.greeting.content, timestamp: new Date() },
      ]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setChatState("error");
    }
  }, [input.channelKey, input.locale]);

  const sendTurn = React.useCallback(
    async (
      content: string,
      inputMode: "text" | "chip" | "voice" | "list_reply" = "text",
      chipId: string | null = null,
    ) => {
      if (!conversationId) return;
      setErrorMessage(undefined);
      setTraceSteps([]);
      setGroundingSteps([]);

      // A monotonic counter local to this one turn — not derived from
      // `traceSteps.length`/`groundingSteps.length`, which are stale reads
      // from the closure captured when `sendTurn` was created and would
      // produce colliding React keys across more than one step per turn.
      let stepCounter = 0;
      const appendTraceStep = (step: TraceStep) => setTraceSteps((prev) => [...prev, step]);
      const appendGroundingStep = (step: TraceStep) => setGroundingSteps((prev) => [...prev, step]);

      const userTurnId = newClientTurnId();
      setTurns((prev) => [
        ...prev,
        { id: userTurnId, role: "user", text: content, timestamp: new Date() },
      ]);
      setChatState("thinking");

      const assistantTurnPlaceholderId = `pending-${userTurnId}`;
      setTurns((prev) => [
        ...prev,
        {
          id: assistantTurnPlaceholderId,
          role: "assistant",
          text: "",
          interimText: "",
          streaming: true,
          timestamp: new Date(),
        },
      ]);

      let realTurnId = assistantTurnPlaceholderId;
      let firstTokenSeen = false;

      try {
        const response = await fetch(`/api/public/v1/conversations/${conversationId}/turns`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify({ content, inputMode, chipId, clientTurnId: userTurnId }),
        });
        if (!response.ok || !response.body) {
          throw new Error(`Turn request failed (${response.status}).`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = new SseFrameParser();
        let interim = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const frames = parser.push(decoder.decode(value, { stream: true }));
          for (const frame of frames) {
            let data: Record<string, unknown> = {};
            try {
              data = JSON.parse(frame.data) as Record<string, unknown>;
            } catch {
              continue;
            }

            switch (frame.event) {
              case "turn_started": {
                if (typeof data.turnId === "string") {
                  realTurnId = data.turnId;
                  setTurns((prev) =>
                    prev.map((turn) =>
                      turn.id === assistantTurnPlaceholderId ? { ...turn, id: realTurnId } : turn,
                    ),
                  );
                }
                break;
              }
              case "route": {
                const agentId = String(data.agentId ?? "unknown_agent");
                const confidence =
                  typeof data.confidence === "number" ? data.confidence : undefined;
                appendTraceStep({
                  id: `route-${stepCounter++}`,
                  primaryLine: `router → ${agentId}`,
                  ...(confidence !== undefined ? { confidence } : {}),
                });
                break;
              }
              case "guardrail": {
                appendTraceStep({
                  id: `guardrail-${stepCounter++}`,
                  primaryLine: `guardrail (${String(data.stage ?? "?")}) — ${String(data.status ?? data.decision ?? "?")}`,
                  status: data.status === "Ok" || data.decision === "pass" ? "success" : "warning",
                });
                break;
              }
              case "tool_call_started": {
                appendTraceStep({
                  id: `tool-${stepCounter++}`,
                  primaryLine: `tool ${String(data.label ?? data.toolName ?? "call")}`,
                  status: "pending",
                });
                break;
              }
              case "tool_call_finished": {
                appendTraceStep({
                  id: `tool-done-${stepCounter++}`,
                  primaryLine: `tool finished — ${String(data.outcome ?? "?")}`,
                  status: data.outcome === "Ok" || data.outcome === "ok" ? "success" : "warning",
                });
                break;
              }
              case "retrieval": {
                appendGroundingStep({
                  id: `retrieval-${stepCounter++}`,
                  primaryLine: String(data.label ?? "Retrieval performed"),
                });
                break;
              }
              case "flow_escape": {
                appendTraceStep({
                  id: `escape-${stepCounter++}`,
                  primaryLine: "flow escape triggered → context preserved",
                });
                break;
              }
              case "handover_triggered": {
                setHandover({ active: true, queuePosition: null });
                break;
              }
              case "token": {
                if (!firstTokenSeen) {
                  firstTokenSeen = true;
                  setChatState("streaming");
                }
                interim += String(data.text ?? "");
                setTurns((prev) =>
                  prev.map((turn) =>
                    turn.id === realTurnId ? { ...turn, interimText: interim } : turn,
                  ),
                );
                break;
              }
              case "error": {
                const detail =
                  typeof data.detail === "string" ? data.detail : "The assistant could not answer.";
                setTurns((prev) =>
                  prev.map((turn) =>
                    turn.id === realTurnId
                      ? {
                          ...turn,
                          streaming: false,
                          text: interim || detail,
                          failed: interim.length === 0,
                        }
                      : turn,
                  ),
                );
                setChatState("idle");
                break;
              }
              case "done": {
                setTurns((prev) =>
                  prev.map((turn) =>
                    turn.id === realTurnId ? { ...turn, streaming: false, text: interim } : turn,
                  ),
                );
                setChatState("idle");
                break;
              }
              default:
                break;
            }
          }
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        setTurns((prev) =>
          prev.map((turn) =>
            turn.id === realTurnId ? { ...turn, streaming: false, failed: true } : turn,
          ),
        );
        setChatState("error");
      }
    },
    [conversationId],
  );

  const setRating = React.useCallback(async (turnId: string, rating: MessageRating) => {
    setTurns((prev) =>
      prev.map((turn) =>
        turn.id === turnId && turn.role === "assistant" ? { ...turn, rating } : turn,
      ),
    );
    try {
      if (rating === null) {
        await fetch(`/api/public/v1/turns/${turnId}/feedback`, {
          method: "DELETE",
          credentials: "include",
        });
      } else {
        await fetch(`/api/public/v1/turns/${turnId}/feedback`, {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rating }),
        });
      }
    } catch {
      // Best-effort — the optimistic local rating stands even if the network call fails; a
      // real production build would reconcile on next rehydrate.
    }
  }, []);

  const readAloud = React.useCallback(
    (turnId: string, text: string) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = input.locale === "ar" ? "ar-AE" : "en-US";
      utterance.onstart = () => setSpeakingTurnId(turnId);
      utterance.onend = () => setSpeakingTurnId(undefined);
      utterance.onerror = () => setSpeakingTurnId(undefined);
      window.speechSynthesis.speak(utterance);
    },
    [input.locale],
  );

  const requestHandover = React.useCallback(async () => {
    if (!conversationId) return;
    try {
      const result = await fetchJson<{ queuePosition: number }>(
        `/api/public/v1/conversations/${conversationId}/handover`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      setHandover({ active: true, queuePosition: result.queuePosition });
      setChatState("escalated");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [conversationId]);

  return {
    bootstrap,
    conversationId,
    turns,
    chatState,
    errorMessage,
    disclaimerDismissed,
    dismissDisclaimer: () => setDisclaimerDismissed(true),
    traceSteps,
    groundingSteps,
    handover,
    speakingTurnId,
    open,
    sendTurn,
    setRating,
    readAloud,
    requestHandover,
  };
}
