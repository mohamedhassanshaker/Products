/** `GET /api/public/v1/conversations/{id}` (api.md §4.2) — rehydrate the thread on reload. */

import { requireOwnConversation, ConversationNotFoundError } from "./conversation-not-found.js";
import { clampLimit, encodeTurnsCursor, type TurnsCursor } from "../domain/turns-cursor.js";
import type {
  ConversationRepository,
  ConversationTurnRow,
} from "../ports/conversation-repository.js";
import type { EscalationRepository } from "../ports/escalation-repository.js";

export interface GetConversationResult {
  readonly conversationId: string;
  readonly outcome: string;
  readonly turns: readonly ConversationTurnRow[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly pendingSlot: { readonly name: string; readonly requiredAssurance: string } | null;
  readonly handoverActive: boolean;
}

export class GetConversation {
  constructor(
    private readonly deps: {
      readonly conversations: ConversationRepository;
      readonly escalations: EscalationRepository;
    },
  ) {}

  async execute(input: {
    readonly conversationId: string;
    readonly sessionSubjectId: string;
    readonly cursor: TurnsCursor | null;
    readonly limit: number | null;
  }): Promise<GetConversationResult> {
    requireOwnConversation(input.sessionSubjectId, input.conversationId);

    const conversation = await this.deps.conversations.findById(input.conversationId);
    if (!conversation) throw new ConversationNotFoundError();

    const limit = clampLimit(input.limit);
    const afterOrdinal = input.cursor?.afterOrdinal ?? 0;
    const fetched = await this.deps.conversations.listTurnsAfter(
      input.conversationId,
      afterOrdinal,
      limit,
    );
    const hasMore = fetched.length > limit;
    const turns = hasMore ? fetched.slice(0, limit) : fetched;
    const lastTurn = turns[turns.length - 1];
    const nextCursor =
      hasMore && lastTurn ? encodeTurnsCursor({ afterOrdinal: lastTurn.ordinal }) : null;

    const [slots, openTicket] = await Promise.all([
      this.deps.conversations.listPendingSlots(input.conversationId),
      this.deps.escalations.findOpenForConversation(input.conversationId),
    ]);
    const pendingSlot = slots[0] ?? null;

    return {
      conversationId: conversation.id,
      outcome: conversation.outcome,
      turns,
      nextCursor,
      hasMore,
      pendingSlot: pendingSlot
        ? { name: pendingSlot.name, requiredAssurance: pendingSlot.requiredAssurance }
        : null,
      handoverActive: openTicket !== null && openTicket.status === "Active",
    };
  }
}
