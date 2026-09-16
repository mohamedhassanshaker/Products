/** `POST /api/public/v1/conversations/{id}/close` (api.md §4.2). */

import { requireOwnConversation, ConversationNotFoundError } from "./conversation-not-found.js";
import type { ConversationRepository } from "../ports/conversation-repository.js";
import type { EscalationRepository } from "../ports/escalation-repository.js";

/**
 * FR-CONV-14's outcome derivation, applied at the one real trigger this
 * module owns (an explicit close call): `Escalated` when an open handover
 * ticket exists, `Resolved` otherwise. The third documented outcome,
 * `Abandoned` ("a session expires with an unanswered assistant prompt
 * outstanding"), has no synchronous trigger — it is a retention-sweep-time
 * derivation over an already-expired session, which belongs to whatever
 * scheduled job owns the retention sweep (out of this module's scope; not a
 * gap this endpoint can close since it only ever runs for a *live* session).
 */
export class CloseConversation {
  constructor(
    private readonly deps: {
      readonly conversations: ConversationRepository;
      readonly escalations: EscalationRepository;
    },
  ) {}

  async execute(input: {
    readonly conversationId: string;
    readonly sessionSubjectId: string;
    readonly now: Date;
  }): Promise<{ readonly outcome: string }> {
    requireOwnConversation(input.sessionSubjectId, input.conversationId);

    const conversation = await this.deps.conversations.findById(input.conversationId);
    if (!conversation) throw new ConversationNotFoundError();

    const openTicket = await this.deps.escalations.findOpenForConversation(input.conversationId);
    const outcome = openTicket ? "Escalated" : "Resolved";
    await this.deps.conversations.close(input.conversationId, outcome, input.now);
    return { outcome };
  }
}
