/**
 * A.2.11 Human Handoff Notification — the "wait indicator" element (animated
 * dots/position-in-queue, per the screen inventory) shown while a real `escalation`
 * row is `Waiting` for a human agent to claim it. The "I'm connecting you…"/"Agent
 * [Name] has joined"/"Returning to AI assistant" text itself renders as an ordinary
 * System message bubble (see `TextBubble.tsx`) — this banner is only the persistent,
 * live-updating wait state that a one-off system message can't represent well.
 */
export function EscalationWaitBanner({ queueName, positionEstimate }: { queueName: string; positionEstimate?: number }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-orange-50 px-3 py-1.5 text-xs text-orange-800">
      <span aria-hidden="true">⏳</span>
      <span>
        Waiting for {queueName}
        {typeof positionEstimate === "number" && positionEstimate > 0 ? ` — position ${positionEstimate}` : "…"}
      </span>
    </div>
  );
}
