/**
 * `AgentPresence` — B8's "Agent status" toggle (`● Available` / `● Busy` / `● Offline`)
 * plus the capacity guard that decides whether a claim is allowed at all.
 *
 * `CK_AgentPresence_capacity CHECK (activeTicketCount <= maxConcurrentTickets AND
 * activeTicketCount >= 0 AND maxConcurrentTickets > 0)` and
 * `CK_AgentPresence_offlineHasNoTickets CHECK (status <> 'Offline' OR
 * activeTicketCount = 0)` (both read directly from `prisma/sql/001_constraints.sql`
 * §2.9, not assumed) are the two real invariants this file's pure functions exist to
 * keep the application layer from violating.
 */

export const PRESENCE_STATUSES = ["Available", "Busy", "Offline"] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export interface PresenceSnapshot {
  readonly status: PresenceStatus;
  readonly activeTicketCount: number;
  readonly maxConcurrentTickets: number;
}

/**
 * May this agent claim one more ticket right now?
 *
 * `Offline` never can (api.md §6.8: "Claiming while offline -> `409
 * handover.agent_offline`"), and `CK_AgentPresence_capacity` is the reason `Busy`/
 * `Available` still cap out — a status of `Busy` is informational to *other* agents
 * ("this person is heads-down"), not itself a claim gate; the real gate is capacity.
 */
export function canClaimAnother(presence: PresenceSnapshot): boolean {
  if (presence.status === "Offline") return false;
  return presence.activeTicketCount < presence.maxConcurrentTickets;
}

/**
 * Going `Offline` must never leave `activeTicketCount > 0`
 * (`CK_AgentPresence_offlineHasNoTickets`) — every ticket this agent holds has to be
 * requeued in the same transaction that flips the status, "so a ticket must not be
 * punished for an agent signing off" (api.md §6.8's own wording for exactly this rule).
 */
export function requiresDrainingHeldTickets(nextStatus: PresenceStatus): boolean {
  return nextStatus === "Offline";
}
