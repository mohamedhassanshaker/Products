import { DomainError, type MessagePayload } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import { insertMessage, publishConversationEvent } from "@nextbot/conversations";
import { findEscalationById } from "../infrastructure/escalation-repository.js";

export class EscalationNotInProgressError extends DomainError {
  readonly httpStatus = 409;
  readonly code = "ESCALATION_NOT_IN_PROGRESS";
  constructor() {
    super("This escalation is not currently in progress — take it over first.");
  }
}

/**
 * FR-ESC-02 — the human agent's own message, sent directly from the Live Takeover
 * Panel's conversation pane. Persisted with `sender: "HumanAgent"` (renders with a
 * distinct avatar/color from AI messages per A.2.11) and `senderUserId` so the
 * transcript records who actually sent it. Only callable while the escalation is
 * `InProgress` — an agent cannot send as a conversation they haven't (or no longer)
 * own.
 */
export async function sendHumanAgentMessage(
  ctx: TenantContext,
  escalationId: string,
  userId: string,
  payload: MessagePayload,
): Promise<void> {
  const escalation = await findEscalationById(ctx, escalationId);
  if (!escalation || escalation.status !== "InProgress") {
    throw new EscalationNotInProgressError();
  }

  const message = await insertMessage(ctx, {
    conversationId: escalation.conversationId,
    sender: "HumanAgent",
    senderUserId: userId,
    contentType: payload.contentType,
    payload: payload as unknown as Record<string, unknown>,
  });
  publishConversationEvent(escalation.conversationId, {
    event: "message",
    data: {
      message: {
        id: message.id,
        conversationId: message.conversationId,
        sequence: message.sequence,
        sender: message.sender,
        contentType: message.contentType,
        payload: message.payload,
        confidenceScore: message.confidenceScore,
        createdAt: message.createdAt.toISOString(),
      },
    },
  });
}
