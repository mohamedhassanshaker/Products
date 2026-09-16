import { assertHeldByAgent } from "../domain/ticket-lifecycle.js";
import type {
  ConversationRepository,
  ConversationTurnRow,
} from "../../conversation/ports/conversation-repository.js";
import type { TicketRepository } from "../ports/ticket-repository.js";
import { TicketNotFoundError } from "./get-ticket-detail.js";

/**
 * api.md §6.8 `POST /handover/tickets/{id}/messages` — "Send an agent message to the
 * citizen."
 *
 * **Deliberately narrower than the full spec, named plainly.** The real endpoint routes
 * every outbound send through `ChannelTransport` so the WhatsApp 24-hour session window
 * is checked even for an agent's own message ("An agent cannot bypass a platform rule
 * by typing faster") and requires an `Idempotency-Key`. Neither is wired here: this
 * method appends the `ConversationTurns` row directly (`ConversationRepository.
 * appendHumanAgentTurn`, added alongside this module) so the citizen-facing widget/SSR
 * demo page picks the reply up on its own next poll/reconnect — correct and real for
 * the web-widget channel this wave's live proof exercises, but a WhatsApp ticket's
 * outbound send would need the same session-window/idempotency discipline `channels`
 * module's own `SendCampaignNow`/webhook paths already have, which is real, separable
 * follow-up work behind this same method's signature rather than a silently-dropped
 * requirement.
 */
export class SendAgentMessage {
  constructor(
    private readonly deps: {
      readonly tickets: TicketRepository;
      readonly conversations: ConversationRepository;
    },
  ) {}

  async execute(input: {
    readonly ticketId: string;
    readonly staffUserId: string;
    readonly body: string;
    readonly now: Date;
  }): Promise<ConversationTurnRow> {
    const ticket = await this.deps.tickets.findById(input.ticketId);
    if (!ticket) throw new TicketNotFoundError();
    assertHeldByAgent(ticket.status, ticket.assignedStaffUserId, input.staffUserId);

    const turn = await this.deps.conversations.appendHumanAgentTurn({
      conversationId: ticket.conversationId,
      contentMasked: input.body,
      contentFormat: "Text",
      now: input.now,
    });

    if (ticket.status === "Assigned") {
      await this.deps.tickets.markActive(input.ticketId, input.now);
    }

    return turn;
  }
}
