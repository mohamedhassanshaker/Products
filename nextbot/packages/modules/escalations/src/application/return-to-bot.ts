import type { TenantContext } from "@nextbot/db";
import { insertMessage, publishConversationEvent, updateConversationStatus } from "@nextbot/conversations";
import { claimEscalationTransition, type EscalationRow } from "../infrastructure/escalation-repository.js";
import { EscalationAlreadyClaimedError } from "./claim-escalation.js";

/** FR-ESC-04's exact required copy. */
export const RETURN_TO_BOT_TEXT = "Your issue has been resolved. Returning to AI assistant.";

/**
 * FR-ESC-04 — a human agent explicitly hands the conversation back to the AI. Sets
 * `escalation.status = ReturnedToBot`, `conversation.status = Active`, and posts the
 * exact system message. **Context preservation, disclosed**: this system has no
 * literal ADK session checkpoint to resume (the same already-disclosed Phase 12/14
 * limitation — goal/tool-selection is a single stateless `generateStructured` call
 * per turn, not a long-running stateful graph session) — "resumes with the
 * conversation's accumulated context intact, not reset to a fresh session" is
 * satisfied by the turn pipeline's own designed behavior: every customer message is
 * already answered against the *conversation's* full persisted transcript/goal
 * state (`conversation.recognized_goal`, `message` history), which is untouched by
 * this transition — there is no "fresh session" code path to fall into in the first
 * place, so there is nothing to explicitly resume. Flagged for architect attention if
 * a real stateful multi-turn GraphRuntime session ever lands (same flag Phase 14's
 * report already raised for Tier-2/3 resume).
 */
export async function returnToBot(
  ctx: TenantContext,
  escalationId: string,
  userId: string,
  csat?: { csatScore?: number; csatComment?: string },
): Promise<EscalationRow> {
  const { claimed, row } = await claimEscalationTransition(ctx, escalationId, ["InProgress"], "ReturnedToBot", {
    assignedAgentId: userId,
    csatScore: csat?.csatScore ?? null,
    csatComment: csat?.csatComment ?? null,
  });
  if (!claimed || !row) {
    throw new EscalationAlreadyClaimedError();
  }

  await updateConversationStatus(ctx, row.conversationId, "Active");

  const systemMessage = await insertMessage(ctx, {
    conversationId: row.conversationId,
    sender: "System",
    contentType: "Text",
    payload: { contentType: "Text", text: RETURN_TO_BOT_TEXT },
  });
  publishConversationEvent(row.conversationId, {
    event: "message",
    data: {
      message: {
        id: systemMessage.id,
        conversationId: systemMessage.conversationId,
        sequence: systemMessage.sequence,
        sender: systemMessage.sender,
        contentType: systemMessage.contentType,
        payload: systemMessage.payload,
        confidenceScore: systemMessage.confidenceScore,
        createdAt: systemMessage.createdAt.toISOString(),
      },
    },
  });
  publishConversationEvent(row.conversationId, { event: "conversation", data: { status: "Active" } });

  return row;
}

/**
 * B.5.2's "Resolve & Close" — distinct from return-to-bot: ends the conversation
 * entirely (no AI resumption) rather than handing it back to the bot.
 *
 * Phase 13 (BL-45, FR-ESC-05) addition: optionally captures CSAT ("at the close of a
 * takeover") — `csat.csatScore`/`csatComment`, stamping `csat_captured_at` only when a
 * score is actually supplied. Never blocks the transition: an agent who skips the
 * CSAT prompt still closes the escalation normally (`csat` is optional throughout).
 */
export async function resolveEscalation(
  ctx: TenantContext,
  escalationId: string,
  userId: string,
  csat?: { csatScore?: number; csatComment?: string },
): Promise<EscalationRow> {
  const { claimed, row } = await claimEscalationTransition(ctx, escalationId, ["InProgress"], "Resolved", {
    assignedAgentId: userId,
    csatScore: csat?.csatScore ?? null,
    csatComment: csat?.csatComment ?? null,
  });
  if (!claimed || !row) {
    throw new EscalationAlreadyClaimedError();
  }
  await updateConversationStatus(ctx, row.conversationId, "Resolved");
  publishConversationEvent(row.conversationId, { event: "conversation", data: { status: "Resolved" } });
  return row;
}
