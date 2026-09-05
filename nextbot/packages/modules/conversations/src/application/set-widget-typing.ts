import type { WidgetSessionClaims } from "./widget-session-token.js";

/**
 * `POST /api/v1/widget/typing` (LLD §5.3) — accepts the *customer's* typing state.
 * This phase deliberately does not publish anything back on the conversation's own
 * SSE `typing` event (that event's `actor: 'ai' | 'human'` shape represents the
 * AI/human-agent side typing *to* the customer, not the customer's own state relayed
 * to themselves) — there is no consumer for the customer's typing signal yet (a human
 * agent takeover panel, BL-09, is a later phase). The function still validates the
 * session (a bad/expired token must 401 the same as every other widget endpoint) and
 * exists as the real, callable seam that phase wires a live-agent-facing view into,
 * rather than that endpoint being entirely unimplemented.
 */
export function setWidgetTypingState(session: WidgetSessionClaims, _state: "start" | "stop"): void {
  void session;
  void _state;
}
