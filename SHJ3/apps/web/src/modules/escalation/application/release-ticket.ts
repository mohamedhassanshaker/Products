import { assertHeldByAgent } from "../domain/ticket-lifecycle.js";
import type { AgentPresenceRepository } from "../ports/agent-presence-repository.js";
import type { TicketRepository } from "../ports/ticket-repository.js";
import { TicketNotFoundError } from "./get-ticket-detail.js";

/** api.md §6.8 `POST /handover/tickets/{id}/release` — "Return to the queue with a
 *  reason." `reason` is accepted for the audit trail (this use case's own caller writes
 *  it, matching every other audited action in this codebase); it is not persisted on
 *  the ticket row itself, since `EscalationTickets` has no free-text release-reason
 *  column. */
export class ReleaseTicket {
  constructor(
    private readonly deps: {
      readonly tickets: TicketRepository;
      readonly presence: AgentPresenceRepository;
    },
  ) {}

  async execute(input: {
    readonly ticketId: string;
    readonly staffUserId: string;
    readonly now: Date;
  }) {
    const ticket = await this.deps.tickets.findById(input.ticketId);
    if (!ticket) throw new TicketNotFoundError();
    assertHeldByAgent(ticket.status, ticket.assignedStaffUserId, input.staffUserId);

    await this.deps.tickets.release(input.ticketId, input.now);
    await this.deps.presence.adjustActiveCount(input.staffUserId, -1);
  }
}
