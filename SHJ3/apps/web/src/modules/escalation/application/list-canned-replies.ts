import type { CannedReplyRepository, CannedReplyRow } from "../ports/canned-reply-repository.js";
import type { TicketRepository } from "../ports/ticket-repository.js";
import { TicketNotFoundError } from "./get-ticket-detail.js";

/** api.md §6.8 `GET /handover/tickets/{id}/canned-replies` — "Topic-specific canned
 *  replies." A standalone use case (rather than folding this into `GetTicketDetail`
 *  alone) because the composer needs to re-fetch this independently of the rest of the
 *  ticket detail — e.g. after a locale switch — without re-fetching the whole
 *  transcript. */
export class ListCannedReplies {
  constructor(
    private readonly deps: {
      readonly tickets: TicketRepository;
      readonly cannedReplies: CannedReplyRepository;
    },
  ) {}

  async execute(ticketId: string, localeCode: string): Promise<readonly CannedReplyRow[]> {
    const ticket = await this.deps.tickets.findById(ticketId);
    if (!ticket) throw new TicketNotFoundError();
    return this.deps.cannedReplies.listForTopic(ticket.topicKey, localeCode);
  }
}
