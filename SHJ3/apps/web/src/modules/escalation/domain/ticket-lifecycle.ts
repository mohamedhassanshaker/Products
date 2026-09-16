/**
 * `EscalationTickets.status` state machine — `Queued -> Assigned -> Active -> {Resolved,
 * Abandoned}`, with `Assigned`/`Active` able to fall back to `Queued` (release, or an
 * agent going offline while holding tickets).
 *
 * ## `CK_EscalationTickets_assignedPaired` drives every transition here
 *
 * `prisma/sql/001_constraints.sql` §2.9:
 * `CHECK (status IN ('Assigned','Active') = (assignedStaffUserId IS NOT NULL))`.
 * Read directly rather than assumed (this project's own standing discipline —
 * `tasks/lessons.md`'s "grep the real CK_* constraint before guessing"), and it has a
 * consequence non-obvious from the wireframe alone: **resolving or abandoning a ticket
 * clears `assignedStaffUserId` back to null**, because neither `Resolved` nor
 * `Abandoned` is in the paired set. There is no `resolvedByStaffUserId` column — "who
 * closed this ticket" is not this table's job to remember; `AuditLogEntries` (governance,
 * B14) is where that belongs, and this module writes one there on resolve.
 *
 * This file is pure domain logic — no I/O, no Prisma import — so the whole state
 * machine is unit-testable without a database, matching every other `domain/` module in
 * this codebase.
 */

export const TICKET_STATUSES = ["Queued", "Assigned", "Active", "Resolved", "Abandoned"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** The two statuses `CK_EscalationTickets_assignedPaired` requires `assignedStaffUserId` for. */
const ASSIGNED_STATUSES: readonly string[] = ["Assigned", "Active"];

export function requiresAssignedStaff(status: string): boolean {
  return ASSIGNED_STATUSES.includes(status);
}

export class TicketNotClaimableError extends Error {
  readonly code = "handover.ticket_not_claimable";
  constructor(readonly currentStatus: TicketStatus) {
    super(`Ticket cannot be claimed from status "${currentStatus}".`);
    this.name = "TicketNotClaimableError";
  }
}

/** api.md §6.8: "the second claimant gets `409 handover.ticket_already_claimed`." */
export class TicketAlreadyClaimedError extends Error {
  readonly code = "handover.ticket_already_claimed";
  constructor() {
    super("This ticket has already been claimed by another agent.");
    this.name = "TicketAlreadyClaimedError";
  }
}

/** api.md §6.8: "Claiming while `offline` -> `409 handover.agent_offline`." */
export class AgentOfflineError extends Error {
  readonly code = "handover.agent_offline";
  constructor() {
    super("An offline agent cannot claim a ticket.");
    this.name = "AgentOfflineError";
  }
}

/** `CK_AgentPresence_capacity`: `activeTicketCount <= maxConcurrentTickets`. */
export class AgentAtCapacityError extends Error {
  readonly code = "handover.agent_at_capacity";
  constructor() {
    super("This agent is already at their concurrent-ticket limit.");
    this.name = "AgentAtCapacityError";
  }
}

export class TicketNotAssignedToAgentError extends Error {
  readonly code = "handover.ticket_not_assigned_to_agent";
  constructor() {
    super("This ticket is not currently assigned to the acting agent.");
    this.name = "TicketNotAssignedToAgentError";
  }
}

/** Only `Queued` tickets may be claimed — an already-`Assigned`/`Active` one is exactly
 *  the race api.md §6.8 names (`409 handover.ticket_already_claimed`).
 *
 *  Takes `status` as a plain `string`, not `TicketStatus`, matching every port in this
 *  codebase's own convention of typing a DB-backed enum column as `string` with a doc
 *  comment naming its real values (`EscalationTicketSummary.status`'s own comment) — a
 *  literal union at the port boundary would need a runtime narrow at every read
 *  anyway, since Prisma itself returns `string` for a `@db.VarChar` column. */
export function assertClaimable(status: string): void {
  if (status !== "Queued") {
    if (status === "Assigned" || status === "Active") throw new TicketAlreadyClaimedError();
    throw new TicketNotClaimableError(status as TicketStatus);
  }
}

/** Release/resolve/return-to-bot all require the ticket to currently be held (`Assigned`
 *  or `Active`) by the acting agent — never someone else's ticket. */
export function assertHeldByAgent(
  status: string,
  assignedStaffUserId: string | null,
  actingStaffUserId: string,
): void {
  if (!requiresAssignedStaff(status) || assignedStaffUserId !== actingStaffUserId) {
    throw new TicketNotAssignedToAgentError();
  }
}

export const TICKET_OUTCOMES = ["resolved", "abandoned"] as const;
export type TicketOutcome = (typeof TICKET_OUTCOMES)[number];

export function outcomeToStatus(outcome: TicketOutcome): "Resolved" | "Abandoned" {
  return outcome === "resolved" ? "Resolved" : "Abandoned";
}
