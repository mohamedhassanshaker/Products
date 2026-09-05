import type { ErrorPayload } from "@nextbot/contracts";

/**
 * FR-AI-05 — the three fixed fallback-copy classes. Never a generic error string:
 * the widget's `ErrorBubble` renders distinct copy per `reason` (Phase 8), and each
 * class here is paired with a correlatable `domain_event` (see
 * `application/turn-pipeline.ts`) so the failure is auditable, not just user-visible.
 */
export function backendTimeoutFallback(): ErrorPayload {
  return {
    contentType: "Error",
    reason: "BackendTimeout",
    text: "I'm having trouble reaching the system right now. Please try again in a moment, or I can connect you to an agent.",
  };
}

export function goalNotUnderstoodFallback(chips?: Array<{ id: string; label: string }>): ErrorPayload {
  return {
    contentType: "Error",
    reason: "GoalNotUnderstood",
    text: "I'm not sure I understood that. Could you rephrase, or pick one of these?",
    chips,
  };
}

export function toolCallFailureFallback(): ErrorPayload {
  return {
    contentType: "Error",
    reason: "ToolCallFailure",
    text: "Something went wrong while processing your request. I've logged this — would you like to try again or speak with an agent?",
  };
}

/**
 * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-06, LLD §14.4.4 step 6) — the
 * FOURTH fallback class: the bounded retrieval agent's `refuseWhenUngrounded` runtime
 * check fired (`retrieval-executor.ts`'s `outcome === 'Refused'`). Distinct copy from
 * every other fallback — "I don't have a sourced answer" is a deliberately different
 * admission than "something went wrong"/"I didn't understand," matching Blueprint
 * §7.5's own framing ("an agent that says it does not know is worth more than one
 * that fills the gap").
 */
export function knowledgeNotGroundedFallback(): ErrorPayload {
  return {
    contentType: "Error",
    reason: "KnowledgeNotGrounded",
    text: "I don't have a sourced answer for that — let me get a colleague to help.",
  };
}

/**
 * A.2.11 (Human Handoff Notification) — the exact required system-message copy for
 * the moment a conversation escalates and a real `escalation` row is being created
 * (Phase 16, BL-09, FR-ESC-01/FR-AI-05). Distinct from `toolCallFailureFallback()`:
 * this is not an error, it's a neutral state transition, so it is returned as a plain
 * `Text` payload (not `Error`) — matching how the widget's `TextBubble` already
 * renders a `System`-sender message distinctly, and how the real transition system
 * messages (`HUMAN_HANDOFF_CONNECTING_TEXT` etc., `@nextbot/escalations`) are worded
 * identically so the AI's own turn-pipeline reply and the escalation record's own
 * system message never visibly disagree.
 */
export function humanHandoffFallback(): { contentType: "Text"; text: string } {
  return { contentType: "Text", text: "I'm connecting you with a support agent. Please hold on…" };
}
