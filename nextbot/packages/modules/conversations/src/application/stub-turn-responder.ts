import type { MessagePayload } from "@nextbot/contracts";
import { generateId } from "@nextbot/db";

/**
 * **Temporary stand-in for the real agent turn pipeline.** Phase 7's goal (per the
 * plan) is proving the message contract and widget session/API surface carry
 * messages end to end through Postgres "even before the agent runtime produces real
 * responses" — the actual `orchestration`/`agent-platform` turn pipeline that calls
 * an LLM and selects tools is Phase 10-12 (BL-05/BL-07) scope, not this phase's.
 *
 * This function is the smallest thing that makes Phase 8's widget UI end-to-end
 * demoable (send a message, see *a* reply) without pulling forward any of that later
 * scope: it acknowledges the customer's message with a canned, honestly-labeled reply
 * and never claims to have understood anything. It must be replaced wholesale by
 * `orchestration`'s turn pipeline in Phase 12 — flagged explicitly, not left as a
 * silent placeholder someone might mistake for real behavior.
 */
export function generateStubAiReply(customerPayload: MessagePayload): MessagePayload {
  const acknowledgement = "Thanks — I've received your message. (This is a placeholder reply; full AI understanding arrives in a later build.)";

  switch (customerPayload.contentType) {
    case "Form": {
      const fieldCount = Object.keys(customerPayload.values ?? {}).length;
      return {
        contentType: "Text",
        text: `Thanks — I've received the ${fieldCount} field(s) you submitted. (Placeholder reply.)`,
      };
    }
    case "QuickReply": {
      const chip = customerPayload.chips.find((c) => c.id === customerPayload.selectedChipId);
      return {
        contentType: "Text",
        text: chip ? `Got it — you selected "${chip.label}". (Placeholder reply.)` : acknowledgement,
      };
    }
    case "List": {
      const item = customerPayload.items.find((i) => i.id === customerPayload.selectedItemId);
      return {
        contentType: "Text",
        text: item ? `Got it — you selected "${item.label}". (Placeholder reply.)` : acknowledgement,
      };
    }
    default:
      return { contentType: "Text", text: acknowledgement };
  }
}

/** A placeholder `runId` correlating a turn's SSE events — real turns (Phase 12) will
 * be keyed by `agent_run.id` instead of a freshly-generated id with no backing row. */
export function generatePlaceholderRunId(): string {
  return generateId();
}
