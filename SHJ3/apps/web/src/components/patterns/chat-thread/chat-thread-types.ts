import type { MessageRating } from "@/components/ui/message-meta-row";

export type ChatTurnRole = "user" | "assistant" | "system";

interface ChatTurnBase {
  id: string;
  timestamp: Date;
}

export interface UserChatTurn extends ChatTurnBase {
  role: "user";
  text: string;
}

export interface AssistantChatTurn extends ChatTurnBase {
  role: "assistant";
  /** The finalized text. While `streaming` is true this may be empty or stale — render `interimText` instead (see `chat-thread.tsx`'s streaming-discipline doc comment). */
  text: string;
  /** True while this turn is still being generated token-by-token. */
  streaming?: boolean;
  /** In-progress text, valid only while `streaming` is true. */
  interimText?: string;
  rating?: MessageRating;
  /** A turn that failed — retried on the turn itself, never the whole thread (§5.5 #48's own explicit rule). */
  failed?: boolean;
}

export interface SystemChatTurn extends ChatTurnBase {
  role: "system";
  note: string;
}

/** One turn in the thread. A discriminated union on `role` so an assistant-only field (e.g. `rating`) can never be attached to a user turn at the type level. */
export type ChatTurn = UserChatTurn | AssistantChatTurn | SystemChatTurn;

export type ChatThreadVariant = "live" | "transcript" | "whatsapp" | "handover";

/** Thread-level banner state (distinct from a single turn's own `streaming`/`failed`) — §5.5 #48's eight-state model. */
export type ChatThreadState = "idle" | "streaming" | "thinking" | "escalated" | "error" | "empty";

/** Fixed, non-themable bubble colours for `variant="whatsapp"` — supplied by `AssistantWidgetShell` (design-system.md §5.5 #50's own token block), never invented here. Omit to use the ordinary `--chat-*` tokens. */
export interface ChatBubbleColorOverrides {
  userBubble: string;
  userBubbleForeground: string;
  assistantBubble: string;
  assistantBubbleForeground: string;
}
