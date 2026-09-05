import type { WidgetMessage } from "../../types.js";

const TICK_GLYPH: Record<NonNullable<WidgetMessage["tick"]>, { glyph: string; label: string }> = {
  sending: { glyph: "◔", label: "Sending" },
  sent: { glyph: "✓", label: "Sent" },
  failed: { glyph: "!", label: "Failed to send" },
  queued: { glyph: "⏱", label: "Queued — will send once you're back online" },
  // D11 (QA fix pass): distinct from both "queued" (still pending) and "sent" —
  // this message was evicted from the offline queue to make room for a newer one
  // and will never be sent unless the customer resends it.
  dropped: { glyph: "⊘", label: "Not sent — removed from the queue, please resend" },
};

/**
 * Target Architecture Blueprint §2.2's own explicit customer-widget in-scope note:
 * "the requirement that it render citations produced by the knowledge subsystem" —
 * the ONE piece of the widget this initiative is required to build (its visual
 * design otherwise stays out of scope). Follows this same file's existing
 * `TICK_GLYPH` convention (a small, self-contained rendering helper, no new
 * component library) rather than a heavier citation-card component, since a citation
 * here is just a labelled reference chip, not an interactive drill-down surface (that
 * richer view already exists in the Admin Console's Conversation Detail/Runtime
 * Traces, `apps/web/app/(admin)/conversations/[id]/ConversationDetail.tsx`).
 */
function CitationChips({ citations }: { citations: NonNullable<Extract<WidgetMessage["payload"], { contentType: "Text" }>["citations"]> }) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1" aria-label={`${citations.length} source${citations.length === 1 ? "" : "s"}`}>
      {citations.map((c, idx) => (
        <span
          key={`${c.chunkId}-${idx}`}
          className="rounded-none border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] text-gray-600"
          title={c.snippet}
        >
          {idx + 1}. {c.documentTitle || c.collectionName}
        </span>
      ))}
    </div>
  );
}

/** A.2.1 — Text Message Bubble. Three variants per sender (AI/Customer/System),
 * `docs/design/UX_GUIDELINES.md` §5.3.1. */
export function TextBubble({ message }: { message: WidgetMessage }) {
  const text = message.payload.contentType === "Text" ? message.payload.text : "";
  const citations = message.payload.contentType === "Text" ? message.payload.citations : undefined;

  if (message.sender === "System") {
    return (
      <p role="status" className="my-2 text-center text-xs text-gray-500">
        {text}
      </p>
    );
  }

  const isCustomer = message.sender === "Customer";
  // A.2.11: "Agent messages render with a different avatar/color from AI messages" —
  // FR-ESC-02's Live Takeover Panel messages (`sender: "HumanAgent"`) get their own
  // distinct color (teal) so a customer can visually tell a real person has joined,
  // never mistaking a human reply for the AI's.
  const isHumanAgent = message.sender === "HumanAgent";
  const tick = message.tick ? TICK_GLYPH[message.tick] : undefined;

  return (
    <div className={`my-1 flex w-full ${isCustomer ? "justify-end" : "justify-start"}`}>
      <div
        className={
          "max-w-[80%] rounded-none px-3 py-2 " +
          (isCustomer ? "bg-primary text-primary-foreground" : isHumanAgent ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-900")
        }
      >
        {isHumanAgent && <p className="mb-0.5 text-[10px] font-bold uppercase opacity-85">Agent</p>}
        <p className="text-sm whitespace-pre-wrap">{text}</p>
        {citations && citations.length > 0 && <CitationChips citations={citations} />}
        {tick && (
          <span aria-label={tick.label} className="ms-2 text-xs opacity-80">
            {tick.glyph}
          </span>
        )}
      </div>
    </div>
  );
}
