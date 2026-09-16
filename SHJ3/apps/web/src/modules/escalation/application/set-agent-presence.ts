import { requiresDrainingHeldTickets, type PresenceStatus } from "../domain/presence.js";
import type {
  AgentPresenceRepository,
  AgentPresenceRow,
} from "../ports/agent-presence-repository.js";
import type { TicketRepository } from "../ports/ticket-repository.js";

/**
 * api.md §6.8 `PUT /handover/presence` — "Going `offline` while holding tickets returns
 * them to the queue with their original priority and wait-time clock preserved — a
 * ticket must not be punished for an agent signing off."
 *
 * "Wait-time clock preserved" is what `TicketRepository.release()` already guarantees
 * on its own: it clears `assignedStaffUserId` and flips the status back to `Queued`,
 * but never touches `queuedAt` — a ticket's wait time (`now - queuedAt`, computed at
 * display time) keeps counting from when it was *first* queued, not from this release.
 * "Original priority preserved" is the same fact from a different column: `priority`
 * is never written by anything in this module except at ticket creation.
 */
export class SetAgentPresence {
  constructor(
    private readonly deps: {
      readonly presence: AgentPresenceRepository;
      readonly tickets: TicketRepository;
    },
  ) {}

  async execute(input: {
    readonly staffUserId: string;
    readonly status: PresenceStatus;
    readonly now: Date;
  }): Promise<AgentPresenceRow> {
    if (requiresDrainingHeldTickets(input.status)) {
      const held = await this.deps.tickets.listHeldBy(input.staffUserId);
      for (const ticket of held) {
        await this.deps.tickets.release(ticket.id, input.now);
        await this.deps.presence.adjustActiveCount(input.staffUserId, -1);
      }
    }
    await this.deps.presence.setStatus(input.staffUserId, input.status, input.now);
    return this.deps.presence.getOrCreate(input.staffUserId, input.now);
  }
}
