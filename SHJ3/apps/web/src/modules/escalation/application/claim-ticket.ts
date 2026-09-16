import { AgentAtCapacityError, AgentOfflineError } from "../domain/ticket-lifecycle.js";
import { canClaimAnother } from "../domain/presence.js";
import type { AgentPresenceRepository } from "../ports/agent-presence-repository.js";
import type { TicketRepository } from "../ports/ticket-repository.js";
import { TicketNotFoundError } from "./get-ticket-detail.js";
import { TicketAlreadyClaimedError } from "../domain/ticket-lifecycle.js";

/**
 * api.md §6.8 `POST /handover/tickets/{id}/claim`. "Claim. Atomic — the second
 * claimant gets `409 handover.ticket_already_claimed`. Claiming while `offline` ->
 * `409 handover.agent_offline`. On success the transcript, identity state and pending
 * slot are all attached: escalation is not a restart."
 *
 * The presence/capacity checks happen *before* the conditional claim, but the claim
 * itself is still the real atomicity guarantee (`TicketRepository.claim()`'s own doc
 * comment) — two agents both passing their own presence check and racing the same
 * `Queued` ticket is exactly the case the conditional `UPDATE ... WHERE status =
 * 'Queued'` resolves, not this ordering.
 */
export class ClaimTicket {
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
    const presence = await this.deps.presence.getOrCreate(input.staffUserId, input.now);
    if (presence.status === "Offline") throw new AgentOfflineError();
    if (!canClaimAnother(presence)) throw new AgentAtCapacityError();

    const claimed = await this.deps.tickets.claim(input.ticketId, input.staffUserId, input.now);
    if (!claimed) {
      const ticket = await this.deps.tickets.findById(input.ticketId);
      if (!ticket) throw new TicketNotFoundError();
      throw new TicketAlreadyClaimedError();
    }

    await this.deps.presence.adjustActiveCount(input.staffUserId, 1);
    const ticket = await this.deps.tickets.findById(input.ticketId);
    if (!ticket) throw new TicketNotFoundError();
    return ticket;
  }
}
