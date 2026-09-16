import {
  assertHeldByAgent,
  outcomeToStatus,
  type TicketOutcome,
} from "../domain/ticket-lifecycle.js";
import type { AgentPresenceRepository } from "../ports/agent-presence-repository.js";
import type { TicketRepository } from "../ports/ticket-repository.js";
import { TicketNotFoundError } from "./get-ticket-detail.js";

/** api.md §6.8 `POST /handover/tickets/{id}/resolve` — `{outcome:"resolved"|"abandoned",
 *  note}`. "Feeds B1 tab 2's outcome column." `note` is accepted for the audit entry
 *  this use case's caller writes; `EscalationTickets` carries no free-text resolution-
 *  note column of its own, the same reasoning `ReleaseTicket`'s own doc comment gives
 *  for `reason`. */
export class ResolveTicket {
  constructor(
    private readonly deps: {
      readonly tickets: TicketRepository;
      readonly presence: AgentPresenceRepository;
    },
  ) {}

  async execute(input: {
    readonly ticketId: string;
    readonly staffUserId: string;
    readonly outcome: TicketOutcome;
    readonly now: Date;
  }) {
    const ticket = await this.deps.tickets.findById(input.ticketId);
    if (!ticket) throw new TicketNotFoundError();
    assertHeldByAgent(ticket.status, ticket.assignedStaffUserId, input.staffUserId);

    await this.deps.tickets.resolve(input.ticketId, outcomeToStatus(input.outcome), input.now);
    await this.deps.presence.adjustActiveCount(input.staffUserId, -1);
  }
}
